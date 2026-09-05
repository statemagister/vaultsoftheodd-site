#!/usr/bin/env python3
"""Stage A antecedent scan — produces the full 485-row reconciliation candidate set.

    python3 scripts/gygax-v2-stagea-antecedent-scan.py <v2.sqlite> <source-bundle-dir> <out.json>

READ-ONLY. Touches nothing in the corpus; emits a candidate file for upstream review.

For every ATTRIBUTED prompt context in ENWorld Parts I, II and VIII, this traces the
prompt's wording back to the post that carries it as that post's OWN text, and reports
whether the recovered antecedent byline agrees with the attribution the corpus currently
holds (which Stage A derived from the vBulletin quote label, not from the antecedent).

It decides nothing. Agreement is evidence, not confirmation; disagreement is a candidate,
not a correction; and a handle string matching or not matching another establishes no
personal identity.

TWO ARTEFACTS THIS DESIGN EXISTS TO AVOID — both were produced before it, and both were
caught by the controls rather than by reading the output:

  1. Taking the earliest post whose body contains the wording finds the QUOTING post too,
     because the quoted text sits inside its quote box. Whenever the original was absent
     from the same document the scan silently fell back to Gygax's own post, reporting 124
     "disagreements" that nearly all named Col_Pladoh as the antecedent of a participant's
     prompt. Hence own_text(): the wording must not follow an "Originally posted by"
     marker inside the candidate post.
  2. Joining discovery_text on unit_id alone cross-multiplies against the 82 Stage A units
     carrying more than one prompt, pairing every speaker with every prompt on its unit —
     645 rows for 485 attributions. Hence the join also matches the discovery locator's
     own "quoted prompt N — <name>" fragment.

CONTROLS, enforced at run time; the scan refuses to write output if either fails:

  A. The Part I `coz` prompt must resolve to an antecedent byline `coz` on page 36. That
     case was settled by hand from the rendering.
  B. Col_Pladoh must account for under 5% of recovered antecedents. Gygax is the speaker
     being quoted FROM, so he should almost never be a prompt's antecedent.

KNOWN LIMITS, which are boundaries rather than defects:
  - the antecedent is the EARLIEST post carrying the wording as own text; a participant
    quoting another participant could mislead;
  - antecedents are searched only WITHIN the same Part document, so a prompt quoting
    across a part boundary is reported unrecoverable rather than traced;
  - the controls are necessary, not sufficient.
"""
import sys, json, re, sqlite3, hashlib, unicodedata, collections

try:
    import pymupdf
except ImportError:
    sys.exit('pymupdf is required: pip install pymupdf')

if len(sys.argv) != 4:
    sys.exit(__doc__.strip().split('\n')[2].strip())
DB_PATH, BUNDLE, OUT = sys.argv[1:4]

SRC = {'Part I': 'enweggqa01.pdf', 'Part II': 'enweggqa02.pdf', 'Part VIII': 'enweggqa08.pdf'}
HDR = re.compile(r'^(\S.*?)\s{2,}((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s*\d{1,2}\w*\s+\w+,\s*\d{4},\s*\d{1,2}:\d{2}\s*[AP]M)\s*$')
LBL = re.compile(r'^\s*Originally posted by\s+(.+?)\s*$', re.I)
INLINE_LBL = re.compile(r'Originally posted by', re.I)
PROBE_LEN = 110


def norm(s):
    s = unicodedata.normalize('NFKC', s or '')
    for a, b in [('’', "'"), ('‘', "'"), ('“', '"'), ('”', '"'),
                 ('–', '-'), ('—', '-')]:
        s = s.replace(a, b)
    return re.sub(r'\s+', ' ', s).strip()


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


# ---- index every post in each source: byline, timestamp, page, own body ----------------
docs, pdf_hashes = {}, {}
import os
for part, fn in SRC.items():
    path = os.path.join(BUNDLE, fn)
    if not os.path.exists(path):
        path = os.path.join(BUNDLE, 'source', fn)
    pdf_hashes[fn] = sha(path)
    d = pymupdf.open(path)
    lines = []
    for i in range(d.page_count):
        for ln in d[i].get_text(sort=True).split('\n'):
            lines.append((i + 1, ln))
    posts = []
    for idx, (pg, ln) in enumerate(lines):
        m = HDR.match(ln.strip())
        if m:
            posts.append({'byline': m.group(1).strip(), 'ts': norm(m.group(2)),
                          'page': pg, 'start': idx})
    for j, p in enumerate(posts):
        end = posts[j + 1]['start'] if j + 1 < len(posts) else len(lines)
        p['body'] = norm(' '.join(l for _, l in lines[p['start'] + 1:end]))
    docs[part] = posts
    print('%-10s %3d pages · %d posts indexed' % (part, d.page_count, len(posts)))


def own_text(post, probe):
    """True when the wording is the post's OWN text rather than something it quotes."""
    i = post['body'].find(probe)
    return i >= 0 and not INLINE_LBL.search(post['body'][:i])


# ---- every ATTRIBUTED Stage A prompt, paired with its own discovery row ----------------
db = sqlite3.connect('file:%s?mode=ro' % DB_PATH, uri=True)
rows = db.execute("""
    SELECT u.source_locator, uc.sequence, p.name, d.text
    FROM unit_context uc
    JOIN testimony_units u ON u.id = uc.unit_id
    JOIN persons p ON p.id = uc.speaker_id
    JOIN discovery_text d ON d.unit_id = u.id
         AND d.source_locator LIKE '%NOT Gygax-authored%'
         AND d.source_locator LIKE '%quoted prompt ' || uc.sequence || ' — ' || p.name || ' (%'
    WHERE u.object_id = 1
      AND (u.source_locator LIKE '%(Part I)%' OR u.source_locator LIKE '%(Part II)%'
           OR u.source_locator LIKE '%(Part VIII)%')
    ORDER BY u.sequence_in_object, uc.sequence""").fetchall()
print('\nattributed Stage A prompts paired: %d' % len(rows))

out, stats, control = [], collections.Counter(), None
for loc, seq, speaker, text in rows:
    part = (re.search(r'\((Part [IVX]+)\)', loc) or [None, None])[1]
    pos = (re.search(r'position (\d+)', loc) or [None, None])[1]
    first = text.split('\n')[0].strip()
    m = LBL.match(first)
    label = m.group(1).strip() if m else None
    core = norm('\n'.join(text.split('\n')[1:])) if m else norm(text)
    rec = {'part': part, 'source_pdf': SRC.get(part), 'unit_source_locator': loc,
           'printable_view_position': int(pos) if pos else None, 'context_sequence': seq,
           'stored_speaker': speaker, 'recorded_quote_label': label,
           'prompt_excerpt': core[:PROBE_LEN],
           'prompt_sha256': hashlib.sha256(core.encode()).hexdigest()}
    if part not in docs:
        rec['outcome'] = 'unknown_part'
    elif len(core) < 40:
        rec['outcome'] = 'prompt_too_short_to_trace'
    else:
        hits = [p for p in docs[part] if own_text(p, core[:PROBE_LEN])]
        if not hits:
            rec['outcome'] = 'antecedent_not_recoverable'
        else:
            a = hits[0]
            rec.update({'antecedent_byline': a['byline'], 'antecedent_page': a['page'],
                        'antecedent_timestamp': a['ts'],
                        'outcome': 'antecedent_agrees' if a['byline'] == speaker
                                   else 'antecedent_disagrees'})
            if a['byline'] == 'Col_Pladoh':
                stats['gygax_as_antecedent'] += 1
            if 'position 141 (Part I)' in loc:
                control = (speaker, a['byline'], a['page'])
    stats[rec['outcome']] += 1
    out.append(rec)

rec_n = stats['antecedent_agrees'] + stats['antecedent_disagrees']
share = 100.0 * stats['gygax_as_antecedent'] / rec_n if rec_n else 0.0
a_ok = control == ('coz', 'coz', 36)
b_ok = share < 5.0
print('\ncontrol A  coz prompt -> %s : %s' % (control, 'PASS' if a_ok else 'FAIL'))
print('control B  Col_Pladoh as antecedent %d/%d (%.1f%%) : %s'
      % (stats['gygax_as_antecedent'], rec_n, share, 'PASS' if b_ok else 'FAIL'))
if not (a_ok and b_ok):
    sys.exit('\nCONTROL FAILED — no output written; results would be unreliable.')

for k, v in stats.most_common():
    print('   %-32s %d' % (k, v))

payload = {
    'generated_for': 'EN World Stage A attribution reconciliation (Parts I, II, VIII)',
    'status': 'CANDIDATE SET FOR UPSTREAM REVIEW — nothing here is a correction',
    'method': ('antecedent = earliest post in the same Part document carrying the prompt '
               'wording as its own text, i.e. not after an "Originally posted by" marker'),
    'controls': {'coz_resolves_to_own_byline_p36': a_ok,
                 'gygax_as_antecedent_share_percent': round(share, 2)},
    'source_pdf_sha256': pdf_hashes,
    'corpus_attributed_prompts': len(rows),
    'counts': dict(stats),
    'limits': [
        'antecedent is the EARLIEST own-text post; a participant quoting another participant could mislead',
        'antecedents searched only within the same Part document; cross-part quoting reports as unrecoverable',
        'agreement is evidence, not confirmation; disagreement is a candidate, not a correction',
        'no personal identity follows from any handle string matching or failing to match another',
    ],
    'rows': out,
}
json.dump(payload, open(OUT, 'w'), indent=1, ensure_ascii=False)
print('\nwritten %s (%d rows)' % (OUT, len(out)))
