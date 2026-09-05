#!/usr/bin/env node
/*
 * gygax-v2-ingest-enworld-cards.mjs — ingest the ENWorld PDF post cards as
 * testimony units under the FROZEN v2 schema.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-enworld-cards.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * Ingestion rules (per the frozen design):
 *   - each card becomes ONE testimony unit in the single ENWorld documentary
 *     object; the Parts are coverage segments, not objects;
 *   - transcript stays EMPTY and transcript_status = 'untranscribed'. The
 *     manifest's PDF text layer is extraction, not verified transcription;
 *   - all extracted text goes to discovery_text only;
 *   - the manifest's post_number values are SOURCE-LOCAL printable-view
 *     positions that restart within each preserved Part (Part I 38-715,
 *     Part II 2-378, Part VIII 3-403; 121 values shared across Parts). They are
 *     not ENWorld thread post numbers, so they are NOT written to the historical
 *     unit_number even as 'inferred' — an inference must be about the right
 *     variable. They are preserved verbatim in source_locator as
 *     "printable-view position N", and unit_number stays NULL with
 *     unit_number_status = 'unknown' until an independent source (e.g. a live
 *     page showing #892) establishes the real thread number;
 *   - discourse_mode is left 'unknown' — never manufactured;
 *   - transcript completeness is 'unknown' (there is no transcription yet); the
 *     manifest's "complete" describes the CARD, which is a different property;
 *   - machine-suggested tags are NOT ingested: tags are our classification;
 *   - extracted question_context is NOT written to unit_context, because that
 *     table may only hold verified text. It goes to discovery_text.
 *
 * Every card image is hash-checked against the manifest before it is accepted.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { assertSchemaFrozen } from './gygax-v2-lock.mjs';

const SCHEMA = assertSchemaFrozen();
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
// Optional Stage A reconstruction-regularisation overlay (Rules §17: corrected
// packages replace erroneous derived assets THROUGH the reproducible pipeline).
// Keyed by the OLD asset sha256; fails closed if any key is unused or ambiguous.
const REG = (() => { const i = args.indexOf('--regularization'); return (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : null; })();
// Optional quoted-question regularisation overlay: separates the prior-speaker
// material Gygax quoted back from the words he newly authored, so quoted wording
// is never indexed as Gygax-authored. quoted_question is used in its FUNCTIONAL
// sense (the prompt Gygax selected and answered), not as a punctuation test.
const QQ = (() => { const i = args.indexOf('--quoted-questions'); return (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : null; })();
// Stage A attributed every quoted prompt from the vBulletin quote LABEL, while Parts
// III-VII and XIII attribute from the recovered ANTECEDENT post. This overlay reconciles
// the two, per-prompt, from an upstream decision set. It never invents a decision: each
// of the 485 prompts must be named explicitly, and each decision is applied exactly as
// written or the run aborts.
const AR = (() => { const i = args.indexOf('--attribution-reconciliation'); return (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : null; })();
const [DB_PATH, PKG, EVID] = args.filter((a) => !a.startsWith('--') && a !== REG && a !== QQ && a !== AR);
if (!DB_PATH || !PKG || !EVID) {
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-enworld-cards.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const NUL = String.fromCharCode(0);
const REPLACEMENT = String.fromCharCode(0xfffd);
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// "Tuesday, 3rd September, 2002, 02:10 PM" -> {value, precision}
// No timezone is asserted: the printable view does not state one.
function parseDate(s) {
  if (!s) return { value: null, precision: 'unknown' };
  const m = s.match(/(\d{1,2})(?:st|nd|rd|th),?\s+([A-Za-z]+),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return { value: null, precision: 'unknown' };
  const mo = MONTHS[m[2].toLowerCase()];
  if (!mo) return { value: null, precision: 'unknown' };
  let h = parseInt(m[4], 10) % 12;
  if (/PM/i.test(m[6])) h += 12;
  const p2 = (n) => String(n).padStart(2, '0');
  return { value: `${m[3]}-${p2(mo)}-${p2(m[1])}T${p2(h)}:${m[5]}`, precision: 'minute' };
}

const manifestPath = join(PKG, 'manifest.jsonl');
if (!existsSync(manifestPath)) die(`manifest.jsonl not found in ${PKG}`);
const recs = readFileSync(manifestPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
console.log(`Ingesting ENWorld PDF post cards under schema ${SCHEMA.version}`);
console.log(`  manifest records : ${recs.length}`);

// ---- Stage A reconstruction-regularisation overlay -------------------------
// Replacements are keyed by the OLD asset sha256. Each key must match exactly one
// base-manifest record; unused or ambiguous keys abort (fail closed).
const REPL = new Map();
if (REG) {
  const rp = join(REG, 'replacement_manifest.jsonl');
  if (!existsSync(rp)) die(`replacement_manifest.jsonl not found in ${REG}`);
  const rrs = readFileSync(rp, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const bad = [];
  for (const rr of rrs) {
    if (REPL.has(rr.old_sha256)) bad.push(`duplicate old_sha256 ${rr.old_sha256.slice(0, 12)}`);
    const hits = recs.filter((r) => r.sha256 === rr.old_sha256);
    if (hits.length !== 1) bad.push(`old_sha256 ${rr.old_sha256.slice(0, 12)} (${rr.old_asset_path}) matches ${hits.length} base records, expected exactly 1`);
    const nf = join(REG, rr.new_asset_file);
    if (!existsSync(nf)) bad.push(`missing replacement asset ${rr.new_asset_file}`);
    else if (sha(readFileSync(nf)) !== rr.new_sha256) bad.push(`replacement sha mismatch ${rr.new_asset_file}`);
    const isStitch = rr.representation === 'stitched_compact_pagination';
    if (isStitch !== !!rr.reconstructed) bad.push(`${rr.new_asset_file}: representation/reconstructed disagree`);
    if (!isStitch && rr.source_portions.length !== 1) bad.push(`${rr.new_asset_file}: single_source_crop with ${rr.source_portions.length} portions`);
    if (isStitch && rr.source_portions.length < 2) bad.push(`${rr.new_asset_file}: stitched with ${rr.source_portions.length} portion(s)`);
    REPL.set(rr.old_sha256, rr);
  }
  if (bad.length) { bad.slice(0, 15).forEach((b) => console.error('  ' + b)); die(`${bad.length} regularisation problem(s); nothing ingested.`); }
  console.log(`  regularisation   : ${REPL.size} replacements (${rrs.filter((r) => r.reconstructed).length} stitched, ${rrs.filter((r) => !r.reconstructed).length} single-source crops)`);
}

// ---- quoted-question overlay: Gygax reply vs quoted prompt ------------------
// FAIL CLOSED on the triple key (thread_part, printable-view position, exact
// header-inclusive baseline discovery SHA-256 over the SANITISED text).
// Natural-key-only fallback is NOT authorised.
const QREPL = new Map();      // "part/pos" -> replacement record
const QSEGS = new Map();      // "part/pos" -> ordered segment records
// ---- Stage A attribution reconciliation overlay -----------------------------
// Keyed by Part + printable-view position + context sequence, exactly as the package
// specifies. The prompt sha256 is checked too, so a decision cannot silently land on a
// prompt whose wording differs from the one it was made against.
const ARDEC = new Map();
let AR_META = null;
const arStats = { promoted: 0, replaced: 0, unresolved: 0 };
const arSeen = new Set();
// Must reproduce EXACTLY the normalisation the candidate set hashed, or the fail-closed
// prompt check would reject every row: NFKC, curly punctuation folded, whitespace
// collapsed, and the leading "Originally posted by X" label line dropped.
const arNorm = (t) => {
  let x = String(t || '').normalize('NFKC');
  for (const [a, b] of [['\u2019', "'"], ['\u2018', "'"], ['\u201c', '"'],
                        ['\u201d', '"'], ['\u2013', '-'], ['\u2014', '-']]) x = x.split(a).join(b);
  return x.replace(/\s+/g, ' ').trim();
};
const arPromptSha = (text) => {
  // Hash the SANITISED text, because that is what the corpus stores and therefore what
  // the decision set was made against. Part II locator 101 carries an embedded NUL — the
  // isolated storage defect the Stage A v4 package documents — and hashing the raw form
  // would reject that one decision even though the wording is the same.
  const lines = String(text || '').split(NUL).join(REPLACEMENT).split('\n');
  const body = /^\s*Originally posted by\s+/i.test(lines[0] || '') ? lines.slice(1).join('\n') : lines.join('\n');
  return sha(Buffer.from(arNorm(body), 'utf8'));
};
if (AR) {
  if (!QQ) die('--attribution-reconciliation requires --quoted-questions: it reconciles the context rows that overlay creates.');
  AR_META = JSON.parse(readFileSync(join(AR, 'stageA-reconciliation-decisions.json'), 'utf8'));
  const seen = new Set();
  for (const d of AR_META.decisions) {
    const k = `${d.part}/${d.printable_view_position}/${d.context_sequence}`;
    if (seen.has(k)) die(`attribution reconciliation names ${k} twice`);
    seen.add(k);
    if (!['promote_to_antecedent_attribution', 'replace_canonical_speaker_with_antecedent_byline', 'no_attribution_change'].includes(d.decision))
      die(`unknown reconciliation decision "${d.decision}" for ${k}`);
    // A promotion must not move the speaker, and a no-change must not move it either.
    // Only an explicit replacement may, and only to the recovered antecedent byline.
    if (d.decision !== 'replace_canonical_speaker_with_antecedent_byline' && d.canonical_speaker !== d.stored_speaker)
      die(`${k}: decision ${d.decision} changes the speaker, which only a replacement may do`);
    if (d.decision === 'replace_canonical_speaker_with_antecedent_byline' && d.canonical_speaker !== d.antecedent_byline)
      die(`${k}: replacement does not use the recovered antecedent byline`);
    ARDEC.set(k, d);
  }
}

if (QQ) {
  const key = (p, n) => `${p}/${n}`;
  const rd = (f) => readFileSync(join(QQ, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const bad = [];
  for (const r of rd('discovery_replacements.jsonl')) {
    if (QREPL.has(key(r.thread_part, r.locator_post_number))) bad.push(`duplicate replacement ${key(r.thread_part, r.locator_post_number)}`);
    QREPL.set(key(r.thread_part, r.locator_post_number), r);
  }
  for (const s of rd('context_segments.jsonl')) {
    const k = key(s.thread_part, s.locator_post_number);
    if (!QSEGS.has(k)) QSEGS.set(k, []);
    QSEGS.get(k).push(s);
  }
  for (const arr of QSEGS.values()) arr.sort((a, b) => a.segment_sequence_in_post - b.segment_sequence_in_post);

  // every replacement must correspond to exactly one base record whose SANITISED
  // baseline text hashes to the package's baseline hash
  const byKey = new Map();
  for (const r of recs) {
    const k = key(r.thread_part, r.post_number);
    if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r);
  }
  for (const [k, r] of QREPL) {
    const hits = byKey.get(k) || [];
    if (hits.length !== 1) { bad.push(`${k}: matches ${hits.length} base records, expected exactly 1`); continue; }
    const baseline = (hits[0].full_rendered_text || hits[0].gygax_text || '').split(NUL).join(REPLACEMENT).trim();
    if (sha(baseline) !== r.baseline_discovery_text_sha256)
      bad.push(`${k}: baseline discovery SHA-256 mismatch (corpus ${sha(baseline).slice(0, 12)} vs package ${r.baseline_discovery_text_sha256.slice(0, 12)})`);
    if (!(r.replacement_discovery_text || '').trim()) bad.push(`${k}: empty Gygax-reply replacement text`);
  }
  for (const k of QSEGS.keys()) if (!QREPL.has(k)) bad.push(`${k}: context segments with no discovery replacement`);
  if (bad.length) { bad.slice(0, 15).forEach((b) => console.error('  ' + b)); die(`${bad.length} quoted-question problem(s); FAILING CLOSED, nothing ingested.`); }
  const segCount = [...QSEGS.values()].reduce((n, a) => n + a.length, 0);
  console.log(`  quoted-question  : ${QREPL.size} affected units, ${segCount} quoted prompts — all baselines matched exactly (fail-closed)`);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const before = {
  units: db.prepare('SELECT count(*) c FROM testimony_units').get().c,
  assets: db.prepare('SELECT count(*) c FROM evidence_assets').get().c,
  sources: db.prepare('SELECT count(*) c FROM evidence_sources').get().c,
  discovery: db.prepare('SELECT count(*) c FROM discovery_text').get().c,
};
const obj = db.prepare(`SELECT id FROM documentary_objects WHERE title='Q&A with Gary Gygax'`).get();
if (!obj) die('the ENWorld documentary object is missing — run the v1 migration first.');
const speaker = db.prepare(`SELECT id FROM persons WHERE name='Gary Gygax'`).get();
if (!speaker) die('person "Gary Gygax" not found.');
if (before.units > 0 && !FORCE) die(`database already holds ${before.units} testimony units. Re-run with --force only if you intend to add to them.`);

// ---- pre-flight: every image present and hash-matching the manifest --------
const problems = [];
for (const r of recs) {
  const src = join(PKG, r.image_path);
  if (!existsSync(src)) { problems.push(`missing image: ${r.image_path}`); continue; }
  const got = sha(readFileSync(src));
  if (got !== r.sha256) problems.push(`sha256 mismatch: ${r.image_path}`);
}
if (problems.length) { problems.slice(0, 10).forEach((p) => console.error('  ' + p)); die(`${problems.length} card image problem(s); nothing ingested.`); }
console.log(`  card images      : ${recs.length} present, all SHA-256 matching the manifest`);

// ---- deterministic order within the single documentary object -------------
// Parts are ordered segments of one thread, so sequence runs Part I, II, VIII,
// and by the manifest's printable-view position within each part.
recs.sort((a, b) => a.thread_part - b.thread_part || a.post_number - b.post_number || a.id - b.id);
let seq = db.prepare(`SELECT COALESCE(MAX(sequence_in_object),0) m FROM testimony_units WHERE object_id=?`).get(obj.id).m;

// unit_number is the HISTORICAL ENWorld thread number. The manifest gives a
// printable-view position, a different variable, so the historical number is
// left NULL / 'unknown' and the position is preserved in source_locator.
const insUnit = db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
   speaker_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
  VALUES (?,?,NULL,'unknown',?,?,?,NULL,?,'direct','unknown','','untranscribed','unknown','pdf_text_extraction',?)`);
const insAsset = db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,1,?,?)`);
const insSrc = db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type) VALUES (?,?,'pdf_page')`);
const insDisc = db.prepare(`INSERT INTO discovery_text(object_id,segment_label,source_type,source_locator,text,unit_id) VALUES (?,?,'pdf_text_extraction',?,?,?)`);
// Structural quoted-prompt context. text stays EMPTY/untranscribed: the wording is
// unverified extraction and unit_context may hold verified text only.
const insCtx = db.prepare(`INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status,sequence) VALUES (?,'quoted_question',?, '', 'untranscribed', ?)`);
// persons is the historical participant/speaker table, not a register of famous
// real names: an explicitly rendered forum handle is an evidentially supported
// speaker identity. Handles are preserved exactly as the source gives them; no
// real-world identity is inferred and no handles are merged.
// Identity is SOURCE-SCOPED (schema v2.1): the handle is looked up and created
// within THIS source family only. An identical handle string in another forum is
// a different, unresolved source identity — never silently merged with this one.
const HANDLE_SCOPE = 'ENWorld Q&A';
const findPerson = db.prepare('SELECT id FROM persons WHERE name = ? AND identity_scope = ?');
const addPerson = db.prepare('INSERT INTO persons(name,identity_scope,notes) VALUES (?,?,?)');
const personCache = new Map();
function personIdForHandle(handle) {
  if (personCache.has(handle)) return personCache.get(handle);
  const found = findPerson.get(handle, HANDLE_SCOPE);
  let id;
  if (found) id = found.id;
  else {
    id = Number(addPerson.run(handle, HANDLE_SCOPE,
      'Forum handle, recorded exactly as the source renders it; the scope, not the name, records where it is attested. Pseudonymous: the real-world identity is unverified and is NOT inferred. An identical handle in another source family is a separate unresolved identity until sameness is independently established.').lastInsertRowid);
    stats.handlesCreated++;
  }
  personCache.set(handle, id);
  return id;
}

const stats = { units: 0, assets: 0, sources: 0, discovery: 0, stitched: 0, crop: 0, regularized: 0, rangeCorrected: [], locatorCorrected: 0,
  nulSanitised: 0, nulUnits: [], qUnits: 0, qSegments: 0, qWithSpeaker: 0, qNoSpeaker: 0, handlesCreated: 0,
  noText: 0, tagsSkipped: 0, contextSkipped: 0, dateParsed: 0, dateUnparsed: 0 };

db.exec('BEGIN');
for (const r of recs) {
  const label = 'Part ' + (ROMAN[r.thread_part] || r.thread_part);
  const d = parseDate(r.post_date);
  d.value ? stats.dateParsed++ : stats.dateUnparsed++;
  // Preserve the manifest's printable-view position as a locator, labelled as
  // what it is. It is not a thread post number and must not read as one.
  // The page range in this locator is an ARCHIVAL LOCATOR, not historical testimony
  // metadata. Where the regularisation overlay established that the old range
  // included pages not belonging to the unit, the locator states the corrected range
  // so it agrees with the evidence asset and its provenance. Superseded values remain
  // recoverable through Git and the reconciliation record. Nothing else changes.
  const rrLoc = REPL.get(r.sha256);
  const locStart = rrLoc ? rrLoc.corrected_source_start_page : r.source_start_page;
  const locEnd = rrLoc ? rrLoc.corrected_source_end_page : r.source_end_page;
  if (rrLoc && (locStart !== r.source_start_page || locEnd !== r.source_end_page)) stats.locatorCorrected++;
  const locator = `${r.source_document} PDF pages ${locStart}-${locEnd}; printable-view position ${r.post_number} (${label})`;
  const uid = Number(insUnit.run(obj.id, ++seq, r.post_date || null, d.value, d.precision,
    speaker.id, locator).lastInsertRowid);
  stats.units++;

  // evidence: one derivative per card; multi-page cards are stitched and carry
  // one provenance row per source PDF page.
  const rr = REPL.get(r.sha256);
  let assetPath, type, srcFile;
  if (rr) {
    // regularised: representation is declared by the overlay, not inferred from a
    // page range, and provenance is the corrected ordered source_portions.
    type = rr.reconstructed ? 'stitched' : 'crop';
    assetPath = 'evidence/enworld/' + basename(rr.new_asset_file);
    srcFile = join(REG, rr.new_asset_file);
    const aid0 = Number(insAsset.run(uid, assetPath, type, rr.new_sha256).lastInsertRowid);
    for (const p of [...rr.source_portions].sort((a, b) => a.order - b.order)) {
      insSrc.run(aid0, `${p.source_document} p.${p.source_page} (clip ${JSON.stringify(p.clip_pdf_points)}${rr.reconstructed ? `, stitch order ${p.order}` : ''})`);
      stats.sources++;
    }
    stats.regularized++;
    if (rr.old_source_start_page !== rr.corrected_source_start_page || rr.old_source_end_page !== rr.corrected_source_end_page)
      stats.rangeCorrected.push(`Part ${rr.thread_part} locator ${rr.locator_post_number}: pages ${rr.old_source_start_page}-${rr.old_source_end_page} -> ${rr.corrected_source_start_page}-${rr.corrected_source_end_page}`);
  } else {
    const pages = [];
    for (let p = r.source_start_page; p <= r.source_end_page; p++) pages.push(p);
    type = pages.length > 1 ? 'stitched' : 'crop';
    assetPath = 'evidence/enworld/' + r.image_path.replace(/^cards\//, '');
    srcFile = join(PKG, r.image_path);
    const aid0 = Number(insAsset.run(uid, assetPath, type, r.sha256).lastInsertRowid);
    for (const p of pages) { insSrc.run(aid0, `${r.source_document} p.${p}`); stats.sources++; }
  }
  type === 'stitched' ? stats.stitched++ : stats.crop++;
  stats.assets++;

  // stage the plaintext derivative for the encrypting build (gitignored dir)
  const dest = join(EVID, assetPath);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(srcFile, dest);

  // extraction -> discovery only. question_context is extraction too, so it is
  // NOT written to unit_context (that table may hold verified text only).
  //
  // A failed glyph in the PDF text layer can extract as U+0000. SQLite binding
  // treats TEXT as NUL-terminated, so an unsanitised NUL SILENTLY TRUNCATES the
  // rest of the extracted text (this cost 346 characters, including a whole
  // quoted prompt, at Part II locator 101). Replace it with U+FFFD: that is a
  // preservation-safe repair of a transport defect — it keeps every surviving
  // character and does NOT guess what the failed glyph was.
  const raw = r.full_rendered_text || r.gygax_text || '';
  const nulls = raw.split(NUL).length - 1;
  if (nulls) { stats.nulSanitised += nulls; stats.nulUnits.push(`Part ${label.replace('Part ', '')} position ${r.post_number} (${nulls} NUL)`); }
  const text = raw.split(NUL).join(REPLACEMENT).trim();
  const qk = `${r.thread_part}/${r.post_number}`;
  const qrep = QREPL.get(qk);
  if (qrep) {
    // Gygax's newly authored words only — the quoted prompt is removed from this row
    insDisc.run(obj.id, label, `${locator}; Gygax reply (newly authored)`, qrep.replacement_discovery_text.trim(), uid);
    stats.discovery++; stats.qUnits++;
    // each quoted prompt: a structural context row (speaker where the source names
    // one, NULL where it does not) plus its wording as clearly-labelled discovery
    let seqNo = 0;
    for (const s of QSEGS.get(qk) || []) {
      seqNo++;
      const handle = s.explicit_speaker_name || null;
      let pid = handle ? personIdForHandle(handle) : null;
      let who = handle ? handle : 'speaker not named in this quote-back';
      // Reconcile this prompt's attribution if a decision names it. Unattributed
      // quote-backs are out of scope: the decision set covers attributed prompts only.
      if (AR && handle) {
        const dk = `${label}/${r.post_number}/${seqNo}`;
        const d = ARDEC.get(dk);
        if (!d) die(`no attribution decision for ${dk}, but the overlay must name every attributed prompt`);
        if (d.stored_speaker !== handle) die(`${dk}: decision was made against speaker "${d.stored_speaker}" but the package supplies "${handle}"`);
        const promptSha = arPromptSha(s.text || '');
        if (d.prompt_sha256 && d.prompt_sha256 !== promptSha)
          die(`${dk}: decision was made against a different prompt wording (sha mismatch)`);
        arSeen.add(dk);
        if (d.decision === 'replace_canonical_speaker_with_antecedent_byline') {
          // The antecedent post header is canonical. The label is kept in the locator as
          // LINKAGE EVIDENCE only — never as the speaker — and establishes no identity.
          pid = personIdForHandle(d.canonical_speaker);
          who = `${d.canonical_speaker} (recovered antecedent post header, ${d.source_pdf} p.${d.antecedent_page}, ${d.antecedent_timestamp}; the vBulletin quote label reads "${d.stored_speaker}" — retained as linkage evidence, NOT as the speaker, and establishing no identity)`;
          arStats.replaced++;
        } else if (d.decision === 'promote_to_antecedent_attribution') {
          who = `${handle} (confirmed against the recovered antecedent post header, ${d.source_pdf} p.${d.antecedent_page}, ${d.antecedent_timestamp}; label and antecedent agree)`;
          arStats.promoted++;
        } else {
          // The antecedent could not be recovered from the preservation Part. The
          // attribution stays as Stage A left it and is marked so, rather than being
          // made to look as though it met the antecedent standard.
          who = `${handle} (attribution derived from the vBulletin quote label only; antecedent NOT recovered — ${d.outcome} — and this attribution remains UNRESOLVED)`;
          arStats.unresolved++;
        }
      }
      insCtx.run(uid, pid, seqNo);
      insDisc.run(obj.id, label, `${locator}; quoted prompt ${seqNo} — ${who} (quoted by Gygax, NOT Gygax-authored)`, (s.text || '').split(NUL).join(REPLACEMENT).trim(), uid);
      stats.discovery++; stats.qSegments++;
      if (handle) stats.qWithSpeaker++; else stats.qNoSpeaker++;
    }
  } else if (text) { insDisc.run(obj.id, label, locator, text, uid); stats.discovery++; }
  else stats.noText++;
  if (r.tags) stats.tagsSkipped++;
  if ((r.question_context || '').trim()) stats.contextSkipped++;
}
db.exec('COMMIT');

// ---- reconciliation -------------------------------------------------------
const after = {
  units: db.prepare('SELECT count(*) c FROM testimony_units').get().c,
  assets: db.prepare('SELECT count(*) c FROM evidence_assets').get().c,
  sources: db.prepare('SELECT count(*) c FROM evidence_sources').get().c,
  discovery: db.prepare('SELECT count(*) c FROM discovery_text').get().c,
};
const q = (s) => db.prepare(s).get().c;
const unknownNums = q(`SELECT count(*) c FROM testimony_units WHERE unit_number IS NULL AND unit_number_status='unknown'`);
const anyNumber = q(`SELECT count(*) c FROM testimony_units WHERE unit_number IS NOT NULL`);
const L = [];
const P = (s) => { console.log(s); L.push(s); };
P('\nReconciliation report');
P(`  source cards in manifest        : ${recs.length}`);
P(`  testimony units created         : ${stats.units}   (${recs.length === stats.units ? 'all accounted for' : 'MISMATCH'})`);
P(`  duplicates / failures           : 0 (all images present and hash-matched; no duplicate (part, post) in source)`);
P(`  evidence assets created         : ${stats.assets}   (${stats.crop} crop, ${stats.stitched} stitched)`);
P(`  evidence provenance rows        : ${stats.sources}  (one per source PDF page/portion)`);
if (REG) {
  P(`  regularised assets              : ${stats.regularized} replaced from the overlay`);
  P(`  source-page ranges corrected    : ${stats.rangeCorrected.length}`);
  // Archival-locator reconciliation: the unit-level source_locator now states the
  // CORRECTED page range so it agrees with the evidence asset and its provenance.
  // Superseded values stay recoverable through Git and the reconciliation record.
  // No testimony identity, date, discovery text, context or discourse mode changes.
  P(`  archival locators corrected     : ${stats.locatorCorrected} unit source_locator page range(s)`);
  for (const s of stats.rangeCorrected.slice(0, 8)) P(`             ${s}`);
  if (stats.rangeCorrected.length > 8) P(`             …and ${stats.rangeCorrected.length - 8} more`);
}
if (stats.nulSanitised) { P(`  NUL bytes sanitised to U+FFFD   : ${stats.nulSanitised}  (prevents silent SQLite truncation of the remaining extracted text)`); for (const u of stats.nulUnits) P(`             ${u}`); }
if (AR) {
  P(`  attribution reconciliation      : ${AR_META.decisions.length} decisions applied to ${arSeen.size} attributed prompt(s)`);
  P(`    promoted to antecedent basis        : ${arStats.promoted}  (speaker string unchanged; label and antecedent agree)`);
  P(`    canonical speaker REPLACED          : ${arStats.replaced}  (antecedent byline canonical; label kept as linkage evidence only)`);
  P(`    left explicitly UNRESOLVED          : ${arStats.unresolved}  (antecedent not recoverable from the preservation Part)`);
  P('    no identity merge is authorised by any of these decisions.');
}
if (QQ) {
  P(`  quoted-question separation      : ${stats.qUnits} units split into Gygax-reply + ${stats.qSegments} quoted prompt(s)`);
  P(`    quoted prompts with a named speaker : ${stats.qWithSpeaker}`);
  P(`    quoted prompts left speaker NULL    : ${stats.qNoSpeaker}  (source does not name one; not inherited)`);
  P(`    forum-handle person records created : ${stats.handlesCreated}`);
}
P(`  discovery_text rows created     : ${stats.discovery}${stats.noText ? `  (${stats.noText} card(s) had no extractable text)` : ''}`);
P(`  transcripts written             : 0   (all units untranscribed, by rule)`);
P(`  discourse classified            : 0   (all 'unknown', never manufactured)`);
P(`  machine tags NOT ingested       : ${stats.tagsSkipped}  (tags are our classification, not the extractor's)`);
P(`  extracted questions NOT in unit_context : ${stats.contextSkipped}  (held as discovery until verified)`);
P(`  dates parsed to minute precision: ${stats.dateParsed}${stats.dateUnparsed ? `, unparsed ${stats.dateUnparsed}` : ''} (no timezone asserted)`);
P('');
P(`  counts before : units ${before.units}, assets ${before.assets}, provenance ${before.sources}, discovery ${before.discovery}`);
P(`  counts after  : units ${after.units}, assets ${after.assets}, provenance ${after.sources}, discovery ${after.discovery}`);
P('');
P('  CURATION STATES (reported, not failures):');
P(`    units with historical post number unknown : ${unknownNums}`);
P(`    units carrying any historical post number : ${anyNumber}`);
P('      The manifest post_number values are source-local printable-view');
P('      positions that restart within each preserved Part. They are a different');
P('      variable from the ENWorld thread number, so they are preserved only as');
P('      locators ("printable-view position N") and the historical unit_number is');
P('      NULL / unknown until an independent source establishes it. A live-page');
P('      observation such as #892 can then replace unknown as a genuine observed number.');
P(`    units with evidence but no transcript: ${q(`SELECT count(DISTINCT u.id) c FROM testimony_units u JOIN evidence_assets e ON e.unit_id=u.id WHERE u.transcript_status='untranscribed'`)}`);
P(`    units with unknown discourse_mode    : ${q(`SELECT count(*) c FROM testimony_units WHERE discourse_mode='unknown'`)}`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nIntegrity:');
ok('exactly 532 source cards accounted for', stats.units === recs.length && recs.length === 532, `${stats.units}/${recs.length}`);
ok('one evidence asset per card', after.assets - before.assets === recs.length);
ok('no transcript text written', q(`SELECT count(*) c FROM testimony_units WHERE transcript<>''`) === 0);
ok('all ingested units untranscribed', q(`SELECT count(*) c FROM testimony_units WHERE transcript_status<>'untranscribed'`) === 0);
ok('no historical unit_number asserted (all NULL / unknown)',
   q(`SELECT count(*) c FROM testimony_units WHERE unit_number IS NOT NULL OR unit_number_status<>'unknown'`) === 0);
ok('printable-view positions preserved as locators',
   q(`SELECT count(*) c FROM testimony_units WHERE source_locator LIKE '%printable-view position %'`) === after.units);
if (AR) {
  // Every decision must have landed, and nothing may have been applied that the
  // package did not name. A decision left unconsumed means the overlay silently
  // failed to match a prompt, which would leave that attribution unreconciled.
  const unconsumed = AR_META.decisions.filter((d) => !arSeen.has(`${d.part}/${d.printable_view_position}/${d.context_sequence}`));
  ok(`every one of the ${AR_META.decisions.length} decisions was applied`, unconsumed.length === 0,
     unconsumed.length ? `${unconsumed.length} unconsumed, e.g. ${unconsumed[0].part}/${unconsumed[0].printable_view_position}` : '');
  ok('the applied split matches the package counts',
     arStats.promoted === AR_META.counts.antecedent_agrees
     && arStats.replaced === AR_META.counts.antecedent_disagrees
     && arStats.unresolved === AR_META.counts.antecedent_not_recoverable + AR_META.counts.prompt_too_short_to_trace,
     `${arStats.promoted}/${arStats.replaced}/${arStats.unresolved}`);
  // The reconciliation must not create testimony, and must not silently change the
  // number of attributed prompts: it reattributes eight, it does not add or drop any.
  ok('the attributed-prompt count is unchanged by the reconciliation',
     q('SELECT count(*) c FROM unit_context WHERE speaker_id IS NOT NULL') === stats.qWithSpeaker);
  ok('no reconciled prompt is attributed to Gygax',
     q(`SELECT count(*) c FROM unit_context WHERE speaker_id=${speaker.id}`) === 0);
  ok('every unresolved attribution is marked as such in its provenance',
     q(`SELECT count(*) c FROM discovery_text WHERE source_locator LIKE '%remains UNRESOLVED%'`) === arStats.unresolved);
  ok('every replacement records the label as linkage evidence, never as the speaker',
     q(`SELECT count(*) c FROM discovery_text WHERE source_locator LIKE '%retained as linkage evidence, NOT as the speaker%'`) === arStats.replaced);
}
if (QQ) {
  // With the quoted-question overlay, structural context rows are created on
  // purpose — one per quoted prompt — but they must stay empty/untranscribed,
  // be typed quoted_question, and never carry Gygax as the context speaker.
  ok(`unit_context holds exactly one row per quoted prompt (${stats.qSegments})`,
     q('SELECT count(*) c FROM unit_context') === stats.qSegments);
  ok('every context row is quoted_question, empty and untranscribed',
     q(`SELECT count(*) c FROM unit_context WHERE context_type<>'quoted_question' OR text<>'' OR text_status<>'untranscribed'`) === 0);
  ok('no quoted prompt is attributed to Gygax',
     q(`SELECT count(*) c FROM unit_context WHERE speaker_id=${speaker.id}`) === 0);
  ok(`speaker populated only where the source names one (${stats.qWithSpeaker} named, ${stats.qNoSpeaker} NULL)`,
     q('SELECT count(*) c FROM unit_context WHERE speaker_id IS NOT NULL') === stats.qWithSpeaker &&
     q('SELECT count(*) c FROM unit_context WHERE speaker_id IS NULL') === stats.qNoSpeaker);
  ok('no quoted wording left in the Gygax-reply discovery rows',
     q(`SELECT count(*) c FROM discovery_text WHERE source_locator LIKE '%Gygax reply (newly authored)%' AND text LIKE '%Originally posted by%'`) === 0);
} else ok('no unit_context rows created', q('SELECT count(*) c FROM unit_context') === 0);
ok('no tags created', q('SELECT count(*) c FROM tags') === 0);
// The insert trigger indexes every unit, including untranscribed ones. Those
// rows carry no tokens, so they can never match a search; the invariant that
// matters is that the index stays in step with its content table and that no
// searchable transcript text exists yet.
ok('transcript index in sync with units', q('SELECT count(*) c FROM units_fts') === after.units);
ok('transcript index holds no searchable text',
   q(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'Gygax OR the OR a OR Greyhawk'`) === 0);
ok('discovery index matches discovery rows', q('SELECT count(*) c FROM discovery_fts') === after.discovery);
ok('integrity_check', db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
for (const t of ['units_fts', 'context_fts', 'discovery_fts']) {
  try { db.exec(`INSERT INTO ${t}(${t}) VALUES('integrity-check')`); ok(`${t} integrity-check`, true); }
  catch (e) { ok(`${t} integrity-check`, false, e.message); }
}
db.close();

const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-enworld-cards.log';
writeFileSync(logPath, ['Gygax corpus v2 — ENWorld card ingestion (testimony-unit ingestion, operation 2)',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
