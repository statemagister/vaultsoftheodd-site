// Gygax commentary & testimony corpus (v2) — client renderer.
//
// passphrase -> PBKDF2-SHA-256(600k) -> AES-256-GCM -> gzip inflate ->
// SQLite (sqlite-wasm) in memory -> FTS5 across three separate indexes.
//
// The derived key is kept in memory for the session and reused to decrypt
// individual evidence assets on demand. Every decrypted asset is SHA-256
// verified against its database record BEFORE display, so an authentic but
// misfiled asset can never be shown against the wrong record.
import sqlite3InitModule from './sqlite3.mjs';

const $ = (id) => document.getElementById(id);
// Absolute: fetch() resolves against the document URL (/research/gygax-v2/),
// not this module's location, so a relative path would look in the wrong place.
const V2 = '/research/gygax/v2/';
const HDR = 41;                       // magic4 ver1 kind1 kdf1 cipher1 comp1 iter4 salt16 iv12
const AAD_DB = 'gygax-v2:db';
const aadAsset = (p) => 'gygax-v2:asset:' + p;
const OPEN = '', CLOSE = '';

let DB = null, SQLITE = null, KEY = null;
const objectUrls = [];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hl = (s) => esc(s).split(OPEN).join('<mark>').split(CLOSE).join('</mark>');
const sha256Hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

function parseContainer(buf) {
  if (buf.length < HDR || String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'GXE1') throw new Error('BADASSET');
  const dv = new DataView(buf.buffer, buf.byteOffset);
  return { version: buf[4], kind: buf[5], comp: buf[8], iterations: dv.getUint32(9, true),
           salt: buf.slice(13, 29), iv: buf.slice(29, 41), ct: buf.slice(41) };
}
async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function decrypt(key, c, aad) {
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: c.iv, additionalData: new TextEncoder().encode(aad) }, key, c.ct));
}

// ------------------------------------------------------------------ unlock
$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('gate-msg'), pw = $('pw').value;
  if (!pw) { msg.textContent = 'Enter the passphrase.'; msg.className = 'msg err'; return; }
  $('unlock').disabled = true; msg.className = 'msg'; msg.textContent = 'Decrypting corpus in your browser…';
  try {
    const r = await fetch(V2 + 'corpus.enc', { cache: 'no-store' });
    if (!r.ok) throw new Error('MISSING');
    const c = parseContainer(new Uint8Array(await r.arrayBuffer()));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    KEY = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: c.salt, iterations: c.iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let plain;
    try { plain = await decrypt(KEY, c, AAD_DB); } catch { throw new Error('WRONGPASS'); }
    if (c.comp === 1) plain = await gunzip(plain);
    const sqlite3 = SQLITE || (SQLITE = await sqlite3InitModule());
    const p = sqlite3.wasm.allocFromTypedArray(plain);
    DB = new sqlite3.oo1.DB();
    DB.checkRc(sqlite3.capi.sqlite3_deserialize(DB.pointer, 'main', p, plain.length, plain.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE));
    $('pw').value = '';
    onUnlocked();
  } catch (err) {
    $('unlock').disabled = false; KEY = null; msg.className = 'msg err';
    msg.textContent = err.message === 'WRONGPASS' ? 'Wrong passphrase, or the corpus asset is corrupted.'
      : err.message === 'MISSING' ? 'Corpus asset not found. Run the v2 build to produce v2/corpus.enc.'
      : err.message === 'BADASSET' ? 'Unrecognised corpus asset format.'
      : 'Could not open the corpus: ' + err.message;
  }
});

function onUnlocked() {
  $('gate').classList.add('hidden'); $('app').classList.remove('hidden');
  const sel = $('speaker');
  DB.exec({ sql: `SELECT p.id,p.name FROM persons p WHERE EXISTS(SELECT 1 FROM testimony_units u WHERE u.speaker_id=p.id) ORDER BY p.name`,
    rowMode: 'object', callback: (r) => { const o = document.createElement('option'); o.value = r.id; o.textContent = r.name; sel.appendChild(o); } });
  const fsel = $('family');
  DB.exec({ sql: `SELECT DISTINCT f.id,f.name FROM source_families f
      JOIN documentary_objects o ON o.family_id=f.id
      JOIN testimony_units u ON u.object_id=o.id ORDER BY f.name`,
    rowMode: 'object', callback: (r) => { const o = document.createElement('option'); o.value = r.id; o.textContent = r.name; fsel.appendChild(o); } });
  const s = DB.selectObject(`SELECT (SELECT count(*) FROM testimony_units) u,
    (SELECT count(*) FROM testimony_units WHERE transcript_status='verified') v,
    (SELECT count(*) FROM evidence_assets) a, (SELECT count(*) FROM discovery_text) d`);
  $('corpus-status').textContent =
    `${s.u} testimony units (${s.v} with verified transcription) · ${s.a} evidence assets · ${s.d} discovery-text records.`;
  renderCoverage();
  $('q').focus();
  for (const id of ['q', 'scope', 'family', 'speaker', 'tstatus'])
    $(id).addEventListener(id === 'q' ? 'input' : 'change', debounce(runSearch, 180));
}

// ------------------------------------------------------------------ search
const REL_LABEL = {
  direct: 'direct', direct_quotation_by_intermediary: 'direct quotation by intermediary',
  attributed_report: 'attributed report', attributed_paraphrase: 'attributed paraphrase',
  eyewitness_account: 'eyewitness account', secondary_interpretation: 'secondary interpretation',
  editorial_or_authorial_inference: 'editorial or authorial inference',
  unattributed_institutional_statement: 'unattributed institutional statement',
  discovery_only: 'discovery only',
};
const ASSET_LABEL = { crop: 'Derivative crop', stitched: 'Stitched derivative', page: 'PDF reproduction', scan: 'Scan' };
const MODE_LABEL = { commentary: 'Commentary', retrospective_commentary: 'Retrospective commentary',
  in_world: 'In-world', rules_or_game_text: 'Rules / game text', unknown: 'Discourse unclassified' };

function filterSql(bind) {
  let s = '';
  if ($('scope').value === 'direct') s += ` AND u.evidence_relationship='direct'`;
  if ($('family').value) { s += ' AND u.object_id IN (SELECT id FROM documentary_objects WHERE family_id=$fam)'; bind.$fam = parseInt($('family').value, 10); }
  if ($('speaker').value) { s += ' AND u.speaker_id=$sp'; bind.$sp = parseInt($('speaker').value, 10); }
  if ($('tstatus').value) { s += ' AND u.transcript_status=$ts'; bind.$ts = $('tstatus').value; }
  return s;
}

function runSearch() {
  const q = $('q').value.trim();
  const msg = $('search-msg'); msg.textContent = ''; msg.className = 'msg';
  const out = $('results');
  for (const u of objectUrls.splice(0)) URL.revokeObjectURL(u);

  const hits = new Map();           // unitId -> {text, tags:[], context:[]}
  const need = (id) => hits.get(id) || (hits.set(id, { text: null, tags: [], context: [], rank: 99 }), hits.get(id));
  let discovery = [];

  // Browse mode: with no query but an active filter, list the matching records.
  // This is how "what we hold but have not yet verified" stays visible, since an
  // untranscribed unit has no verified text and so matches no search dimension.
  const filtering = $('scope').value === 'direct' || $('family').value || $('speaker').value || $('tstatus').value;
  if (!q) {
    if (!filtering) { out.innerHTML = ''; return; }
    const b = {}; const f = filterSql(b);
    DB.exec({ sql: `SELECT u.id FROM testimony_units u WHERE 1=1 ${f}
        ORDER BY u.object_id, u.sequence_in_object LIMIT 200`,
      bind: b, rowMode: 'object', callback: (r) => { need(r.id).browse = true; } });
    if (!hits.size) { renderNoMatch('(filter)'); return; }
    const list = [...hits.entries()];
    out.innerHTML = `<div class="dim"><p class="dimhead"><b>Browsing by filter</b> — ${list.length} record${list.length === 1 ? '' : 's'}; no search term applied</p>`
      + list.map(([id, h]) => renderUnit(id, h, '')).join('') + '</div>';
    wireCards();
    return;
  }

  try {
    // 1. verified transcript
    let b = { $q: q }; let f = filterSql(b);
    DB.exec({ sql: `SELECT u.id, bm25(units_fts) rank,
        snippet(units_fts,0,'${OPEN}','${CLOSE}',' … ',26) snip
        FROM units_fts JOIN testimony_units u ON u.id=units_fts.rowid
        WHERE units_fts MATCH $q ${f} ORDER BY rank LIMIT 200`,
      bind: b, rowMode: 'object', callback: (r) => { const h = need(r.id); h.text = r.snip; h.rank = r.rank; } });
    // 2. topic tag — EXACT match on the controlled vocabulary
    b = { $q: q }; f = filterSql(b);
    DB.exec({ sql: `SELECT u.id, t.name FROM unit_tags ut JOIN tags t ON t.id=ut.tag_id
        JOIN testimony_units u ON u.id=ut.unit_id
        WHERE lower(t.name)=lower($q) ${f} LIMIT 200`,
      bind: b, rowMode: 'object', callback: (r) => need(r.id).tags.push(r.name) });
    // 3. question / context
    b = { $q: q }; f = filterSql(b);
    DB.exec({ sql: `SELECT u.id, c.context_type,
        snippet(context_fts,0,'${OPEN}','${CLOSE}',' … ',20) snip
        FROM context_fts JOIN unit_context c ON c.id=context_fts.rowid
        JOIN testimony_units u ON u.id=c.unit_id
        WHERE context_fts MATCH $q ${f} LIMIT 200`,
      bind: b, rowMode: 'object', callback: (r) => need(r.id).context.push(r) });
    // 4. discovery text (not units). When a unit-scope filter is active, restrict
    // discovery to rows attributable to a matching unit — so "direct only" (or a
    // speaker/family filter) does not surface, say, an eyewitness's words. With no
    // filter, all discovery is shown, including v1 unit-less discovery.
    if (filtering) {
      const db4 = { $q: q }; const f4 = filterSql(db4);
      DB.exec({ sql: `SELECT d.segment_label, d.source_locator, d.source_type,
          snippet(discovery_fts,0,'${OPEN}','${CLOSE}',' … ',24) snip
          FROM discovery_fts JOIN discovery_text d ON d.id=discovery_fts.rowid
          JOIN testimony_units u ON u.id=d.unit_id
          WHERE discovery_fts MATCH $q ${f4} LIMIT 50`,
        rowMode: 'object', bind: db4, callback: (r) => discovery.push(r) });
    } else {
      DB.exec({ sql: `SELECT d.segment_label, d.source_locator, d.source_type,
          snippet(discovery_fts,0,'${OPEN}','${CLOSE}',' … ',24) snip
          FROM discovery_fts JOIN discovery_text d ON d.id=discovery_fts.rowid
          WHERE discovery_fts MATCH $q LIMIT 50`,
        rowMode: 'object', bind: { $q: q }, callback: (r) => discovery.push(r) });
    }
  } catch (err) {
    out.innerHTML = ''; msg.className = 'msg err';
    msg.textContent = 'Search not understood. Try a word, a "quoted phrase", AND / OR / NOT, or a prefix such as Grey*.';
    return;
  }

  if (!hits.size && !discovery.length) { renderNoMatch(q); return; }

  const ordered = [...hits.entries()].sort((a, b) =>
    (a[1].text ? 0 : 1) - (b[1].text ? 0 : 1) || a[1].rank - b[1].rank);

  let html = '';
  if (ordered.length) {
    html += `<div class="dim"><p class="dimhead"><b>Testimony</b> — ${ordered.length} record${ordered.length === 1 ? '' : 's'}; each states why it matched</p>`;
    html += ordered.map(([id, h]) => renderUnit(id, h, q)).join('');
    html += '</div>';
  }
  if (discovery.length) {
    html += `<div class="dim"><p class="dimhead"><b>Discovery text</b> — unverified extraction, a finding aid only. Not quotable; verify against the source before use.</p>`;
    html += discovery.map((d) => `<div class="res">
        <div class="where">${esc(d.segment_label || '')}${d.source_locator ? ' · ' + esc(d.source_locator) : ''} · ${esc(d.source_type || '')}</div>
        <div class="snip">${hl(d.snip)}</div>
        <div class="warnbox">Unverified extraction — not a transcription. Check the source before quoting.</div>
      </div>`).join('');
    html += '</div>';
  }
  out.innerHTML = html;
  wireCards();
}

function renderUnit(id, h, q) {
  const u = DB.selectObject(`SELECT u.*, p.name speaker, s.name subject, o.title obj_title, f.name family
    FROM testimony_units u LEFT JOIN persons p ON p.id=u.speaker_id LEFT JOIN persons s ON s.id=u.subject_person_id
    JOIN documentary_objects o ON o.id=u.object_id JOIN source_families f ON f.id=o.family_id WHERE u.id=${id}`);
  const tags = []; DB.exec({ sql: `SELECT t.name FROM unit_tags ut JOIN tags t ON t.id=ut.tag_id WHERE ut.unit_id=${id} ORDER BY t.name`, rowMode: 'array', callback: (r) => tags.push(r[0]) });
  const ctx = []; DB.exec({ sql: `SELECT c.context_type, c.text, p.name who FROM unit_context c LEFT JOIN persons p ON p.id=c.speaker_id
    WHERE c.unit_id=${id} AND c.text_status='verified' ORDER BY c.sequence`, rowMode: 'object', callback: (r) => ctx.push(r) });
  const assets = []; DB.exec({ sql: `SELECT * FROM evidence_assets WHERE unit_id=${id} ORDER BY display_order`, rowMode: 'object', callback: (r) => assets.push(r) });
  const rel = []; DB.exec({ sql: `SELECT r.relation_type, r.assessment, r.note, v.id oid,
      v.unit_number n, v.unit_number_status ns, pp.name who, o2.title obj
      FROM testimony_relations r JOIN testimony_units v ON v.id = CASE WHEN r.from_unit_id=${id} THEN r.to_unit_id ELSE r.from_unit_id END
      LEFT JOIN persons pp ON pp.id=v.speaker_id JOIN documentary_objects o2 ON o2.id=v.object_id
      WHERE r.from_unit_id=${id} OR r.to_unit_id=${id}`, rowMode: 'object', callback: (r) => rel.push(r) });

  const num = u.unit_number == null ? '' :
    ` · #${u.unit_number}${u.unit_number_status === 'observed' || u.unit_number_status === 'independently_confirmed' ? '' : ` <span class="axis a-warn">${esc(u.unit_number_status)}</span>`}`;
  const tzSuffix = u.date_timezone && !(u.date_display || '').includes(u.date_timezone) ? ' ' + esc(u.date_timezone) : '';
  const date = u.date_display ? ` · ${esc(u.date_display)}${tzSuffix}` +
    (u.date_precision && u.date_precision !== 'minute' && u.date_precision !== 'day' ? ` <span class="axis a-info">${esc(u.date_precision)} precision</span>` : '') : '';

  const verified = u.transcript_status === 'verified';
  const axes = [
    `<span class="axis ${verified ? 'a-ok' : 'a-warn'}">Transcript: ${verified ? 'Verified · ' + esc(u.completeness) : 'Untranscribed'}</span>`,
    assets.length ? `<span class="axis a-info">Evidence: ${esc(ASSET_LABEL[assets[0].asset_type] || assets[0].asset_type)}${assets.length > 1 ? ` (${assets.length} pages)` : ''}</span>` : `<span class="axis a-warn">Evidence: none</span>`,
    `<span class="axis a-violet">${esc(MODE_LABEL[u.discourse_mode] || u.discourse_mode)}</span>`,
  ].join('');

  // Query is highlighted ONLY where it genuinely matched the transcript.
  const body = h.text ? hl(h.text)
    : verified ? esc(u.transcript.slice(0, 260)) + (u.transcript.length > 260 ? ' …' : '')
    : '<i>No verified transcription yet.</i>';

  const why = [];
  if (h.browse) why.push('listed by filter (no search term)');
  if (h.text) why.push('verified transcript');
  if (h.tags.length) why.push(`topic tag ${h.tags.map((t) => `"${esc(t)}"`).join(', ')} (our classification, not necessarily the words used)`);
  if (h.context.length) why.push('question / context, not the answer');

  return `<div class="res" data-unit="${id}">
    <p class="who">${esc(u.speaker || 'Unattributed')} · ${esc(REL_LABEL[u.evidence_relationship] || u.evidence_relationship)}${u.subject ? ` <span class="axis a-info">subject: ${esc(u.subject)}</span>` : ''}</p>
    <p class="where">${esc(u.family)} · ${esc(u.obj_title)}${num}${date}</p>
    <div class="axes">${axes}</div>
    ${u.source_locator ? `<p class="prov">Source locator: ${esc(u.source_locator)}</p>` : ''}
    ${ctx.map((c) => `<div class="ctx"><b>${esc(c.context_type.replace(/_/g, ' '))}${c.who ? ' — ' + esc(c.who) : ''}:</b> ${esc(c.text)}</div>`).join('')}
    <div class="snip">${body}</div>
    ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag${h.tags.includes(t) ? ' hit' : ''}">${esc(t)}</span>`).join('')}</div>` : ''}
    <p class="why">matched: ${why.join(' + ') || 'record'}</p>
    ${!verified ? '<div class="warnbox">Not yet verified against the evidence — do not quote.</div>' : ''}
    ${rel.length ? `<p class="prov"><b>Related testimony:</b> ${rel.map((r) => `${esc(r.who || 'unattributed')}${r.n ? ' #' + r.n : ''} — ${esc(r.relation_type.replace(/_/g, ' '))}, <i>${esc(r.assessment.replace(/_/g, ' '))}</i>`).join('; ')}</p>` : ''}
    <div class="acts">
      ${verified ? `<button class="ghost" data-act="full">Complete transcript</button>` : ''}
      ${assets.length ? `<button class="ghost" data-act="src">View source</button>` : ''}
      ${assets.length ? `<button class="ghost" data-act="prov">Original capture</button>` : ''}
    </div>
    <div class="full hidden" data-full>${esc(u.transcript)}</div>
    <div class="shots hidden" data-shots></div>
    <p class="prov hidden" data-prov></p>
  </div>`;
}

function wireCards() {
  for (const card of document.querySelectorAll('.res[data-unit]')) {
    const id = card.dataset.unit;
    card.querySelector('[data-act="full"]')?.addEventListener('click', () => card.querySelector('[data-full]').classList.toggle('hidden'));
    card.querySelector('[data-act="prov"]')?.addEventListener('click', () => {
      const el = card.querySelector('[data-prov]');
      if (!el.dataset.done) {
        const rows = [];
        DB.exec({ sql: `SELECT e.asset_path, s.original_locator, s.original_type, s.capture_date_display
          FROM evidence_assets e JOIN evidence_sources s ON s.asset_id=e.id WHERE e.unit_id=${id} ORDER BY e.display_order`,
          rowMode: 'object', callback: (r) => rows.push(r) });
        el.innerHTML = '<b>Original capture (held offline; identified, not displayed):</b><br>' +
          rows.map((r) => `${esc(r.original_locator)}${r.original_type ? ' · ' + esc(r.original_type) : ''}${r.capture_date_display ? ' · captured ' + esc(r.capture_date_display) : ''}`).join('<br>');
        el.dataset.done = '1';
      }
      el.classList.toggle('hidden');
    });
    card.querySelector('[data-act="src"]')?.addEventListener('click', () => showEvidence(card, id));
  }
}

// ------------------------------------------------- evidence, integrity-bound
async function showEvidence(card, unitId) {
  const box = card.querySelector('[data-shots]');
  if (box.dataset.done) { box.classList.toggle('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = '<p class="hint">Decrypting evidence…</p>';
  const assets = [];
  DB.exec({ sql: `SELECT asset_path, sha256, asset_type, display_order FROM evidence_assets WHERE unit_id=${unitId} ORDER BY display_order`,
    rowMode: 'object', callback: (r) => assets.push(r) });
  const parts = [];
  for (const a of assets) {
    try {
      const r = await fetch(V2 + a.asset_path + '.enc', { cache: 'no-store' });
      if (!r.ok) throw new Error('not found');
      const c = parseContainer(new Uint8Array(await r.arrayBuffer()));
      // AAD binds the ciphertext to this logical path; a misfiled asset fails here.
      const bytes = await decrypt(KEY, c, aadAsset(a.asset_path));
      // And the plaintext hash binds it to THIS database record.
      const got = await sha256Hex(bytes);
      if (got !== a.sha256) {
        parts.push(`<div class="warnbox">Evidence integrity failure for ${esc(a.asset_path)} — the decrypted image does not match the hash recorded for this record. It has not been displayed.</div>`);
        continue;
      }
      const ext = a.asset_path.split('.').pop().toLowerCase();
      const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      objectUrls.push(url);
      parts.push(`<figure><img src="${url}" alt="Evidence ${a.display_order} for this record">
        <figcaption>${esc(ASSET_LABEL[a.asset_type] || a.asset_type)} ${assets.length > 1 ? `· page ${a.display_order} of ${assets.length}` : ''} · integrity verified (SHA-256)</figcaption></figure>`);
    } catch (e) {
      parts.push(`<div class="warnbox">Could not open evidence ${esc(a.asset_path)}: ${esc(e.message)}. It has not been displayed.</div>`);
    }
  }
  box.innerHTML = parts.join('');
  box.dataset.done = '1';
}

// ------------------------------------------------------------------ chrome
function renderNoMatch(q) {
  $('results').innerHTML = `<div class="nomatch">
    <h3>No matches in the recovered corpus</h3>
    <p>${esc(JSON.stringify(q))} was not found in the verified transcripts, the topic tags, the recorded questions, or the discovery text as recovered so far. This is <b>not</b> evidence that it was never said.</p>
    <p><a href="#" id="opencov">Open corpus coverage</a> before treating an absence as meaningful.</p></div>`;
  $('opencov')?.addEventListener('click', (e) => { e.preventDefault(); const c = $('coverage-panel'); c.open = true; c.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

function renderCoverage() {
  const rows = [];
  // Object titles can legitimately collide across families ("Q&A with Gary
  // Gygax" exists on both ENWorld and Dragonsfoot), so qualify by family.
  DB.exec({ sql: `SELECT (f.name || ' · ' || o.title) obj, c.segment_label, c.coverage_status, c.known_loss, c.detail,
      c.number_from, c.number_to FROM coverage c JOIN documentary_objects o ON o.id=c.object_id
      JOIN source_families f ON f.id=o.family_id
      ORDER BY f.name, o.title, c.sort_order, c.segment_label`, rowMode: 'object', callback: (r) => rows.push(r) });
  $('coverage-table').innerHTML = `<table><thead><tr><th>Object</th><th>Segment</th><th>Status</th><th>Loss</th><th>Detail</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r.obj)}</td><td>${esc(r.segment_label)}${r.number_from ? ` (#${r.number_from}–${r.number_to || '?'})` : ''}</td>
      <td>${esc(r.coverage_status)}</td><td class="${r.known_loss ? 'loss' : ''}">${r.known_loss ? 'known loss' : '—'}</td>
      <td>${esc(r.detail || '')}</td></tr>`).join('')}</tbody></table>`;
  const s = DB.selectObject(`SELECT (SELECT count(*) FROM documentary_objects) o,
    (SELECT count(*) FROM coverage) c, (SELECT count(*) FROM testimony_units WHERE transcript_status='verified') v,
    (SELECT count(*) FROM testimony_units WHERE transcript_status='untranscribed') n`);
  $('coverage-stats').textContent =
    `${s.o} documentary object(s) · ${s.c} coverage segment(s) · ${s.v} verified unit(s) · ${s.n} held but unverified.`;
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
