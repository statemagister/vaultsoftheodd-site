// Gygax ENWorld Q&A research corpus — client search.
// Password → PBKDF2-SHA-256(600k) → AES-256-GCM decrypt → gzip inflate →
// SQLite (sql via @sqlite.org/sqlite-wasm) in memory → FTS5 search.
// The passphrase is never stored or transmitted. The decrypted database lives
// only in memory for the session; nothing is written to persistent storage.
import sqlite3InitModule from './sqlite3.mjs';

const $ = (id) => document.getElementById(id);
const ASSET = './gygax_enworld.enc';
const HEADER_LEN = 40; // magic4 + version1 + kdf1 + cipher1 + comp1 + iter4 + salt16 + iv12
const MARK_OPEN = '', MARK_CLOSE = '';

let DB = null;       // sqlite-wasm DB handle (in-memory)
let SQLITE = null;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function fetchAsset() {
  const r = await fetch(ASSET, { cache: 'no-store' });
  if (!r.ok) throw new Error('MISSING');
  return new Uint8Array(await r.arrayBuffer());
}

function parseContainer(buf) {
  if (buf.length < HEADER_LEN || String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'GXE1')
    throw new Error('BADASSET');
  const dv = new DataView(buf.buffer, buf.byteOffset);
  return {
    version: buf[4], kdf: buf[5], cipher: buf[6], comp: buf[7],
    iterations: dv.getUint32(8, true),
    salt: buf.slice(12, 28), iv: buf.slice(28, 40), ct: buf.slice(40),
  };
}

async function decryptCorpus(passphrase, c) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: c.salt, iterations: c.iterations, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv }, key, c.ct));
  } catch (e) {
    throw new Error('WRONGPASS'); // GCM auth tag failed: wrong passphrase or corrupted asset
  }
  if (c.comp === 1) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([plain]).stream().pipeThrough(ds);
    plain = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return plain;
}

async function openDatabase(bytes) {
  const sqlite3 = SQLITE || (SQLITE = await sqlite3InitModule());
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  const db = new sqlite3.oo1.DB();
  db.checkRc(sqlite3.capi.sqlite3_deserialize(
    db.pointer, 'main', p, bytes.length, bytes.length,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE));
  return db;
}

// ---- UI wiring ----
$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('gate-msg');
  const pw = $('pw').value;
  if (!pw) { msg.textContent = 'Enter the passphrase.'; msg.className = 'msg err'; return; }
  $('unlock').disabled = true; msg.className = 'msg'; msg.textContent = 'Decrypting corpus in your browser…';
  try {
    const container = parseContainer(await fetchAsset());
    const dbBytes = await decryptCorpus(pw, container);
    DB = await openDatabase(dbBytes);
    // wipe the input value (best effort; JS strings are immutable and cannot be zeroed)
    $('pw').value = '';
    onUnlocked();
  } catch (err) {
    $('unlock').disabled = false;
    msg.className = 'msg err';
    if (err.message === 'WRONGPASS') msg.textContent = 'Wrong passphrase, or the corpus asset is corrupted.';
    else if (err.message === 'MISSING') msg.textContent = 'Corpus asset not found. Run the build script to produce gygax_enworld.enc.';
    else if (err.message === 'BADASSET') msg.textContent = 'Unrecognised corpus asset format.';
    else msg.textContent = 'Could not open the corpus: ' + err.message;
  }
});

function onUnlocked() {
  $('gate').classList.add('hidden');
  $('app').classList.remove('hidden');
  populateParts();
  renderCoverage();
  const st = DB.selectObject('SELECT (SELECT count(*) FROM documents) d, (SELECT count(*) FROM chunks) c');
  $('corpus-status').textContent = `Corpus loaded in memory: ${st.d} source records, ${st.c} searchable chunks.`;
  $('q').focus();
  $('q').addEventListener('input', debounce(runSearch, 180));
  $('part').addEventListener('change', runSearch);
  $('auth').addEventListener('change', runSearch);
}

function populateParts() {
  const sel = $('part');
  const rows = [];
  DB.exec({ sql: 'SELECT DISTINCT thread_part FROM documents WHERE thread_part IS NOT NULL ORDER BY CAST(thread_part AS INTEGER)', rowMode: 'array', callback: (r) => rows.push(r[0]) });
  for (const p of rows) { const o = document.createElement('option'); o.value = p; o.textContent = 'Part ' + p; sel.appendChild(o); }
}

const AUTH = {
  3: { cls: 'a3', label: 'Authority 3 · direct PDF text' },
  2: { cls: 'a2', label: 'Authority 2 · manual transcription' },
  1: { cls: 'a1', label: 'Authority 1 · unverified OCR' },
};

function runSearch() {
  const q = $('q').value.trim();
  const part = $('part').value;
  const minAuth = parseInt($('auth').value, 10) || 1;
  const smsg = $('search-msg'); smsg.textContent = ''; smsg.className = 'msg';
  const results = $('results'); const rescount = $('rescount');
  if (!q) { results.innerHTML = ''; rescount.textContent = ''; return; }

  const RENDER_LIMIT = 300;
  let where = 'WHERE chunks_fts MATCH $q AND d.authority >= $minauth';
  const bind = { $q: q, $minauth: minAuth };
  if (part) { where += ' AND d.thread_part = $part'; bind.$part = part; }
  const from = 'FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN documents d ON d.id = c.document_id';

  let total, rows = [];
  try {
    total = DB.selectValue(`SELECT count(*) ${from} ${where}`, bind);
    DB.exec({
      sql: `SELECT c.source_locator sl, c.post_number pn, c.post_date pd, c.author au,
              c.verification_status vs, c.completeness cp,
              d.thread_part tp, d.source_type sty, d.source_file sf, d.authority auth,
              snippet(chunks_fts, 0, '${MARK_OPEN}', '${MARK_CLOSE}', ' … ', 24) snip, bm25(chunks_fts) rank
            ${from} ${where} ORDER BY d.authority DESC, rank LIMIT ${RENDER_LIMIT}`,
      bind, rowMode: 'object', callback: (r) => rows.push(r),
    });
  } catch (err) {
    results.innerHTML = ''; rescount.textContent = ''; delete rescount.dataset.total;
    smsg.className = 'msg err';
    smsg.textContent = 'Search not understood. Try a word, a "quoted phrase", AND / OR / NOT, or a prefix such as Grey*.';
    return;
  }

  rescount.dataset.total = String(total); // deterministic true count (regression hook)
  if (!total) { renderNoMatch(q); rescount.textContent = ''; return; }
  rescount.textContent = total > RENDER_LIMIT
    ? `Showing the first ${RENDER_LIMIT} of ${total} matching passages in the recovered corpus (refine your search to narrow).`
    : `${total} matching passage${total === 1 ? '' : 's'} in the recovered corpus.`;
  results.innerHTML = rows.map(renderRow).join('');
}

function snippetHtml(snip) {
  // Escape HTML first (sentinels are control chars and survive escaping), then
  // swap the balanced sentinels for <mark>…</mark>.
  return esc(snip).split(MARK_OPEN).join('<mark>').split(MARK_CLOSE).join('</mark>');
}

function renderRow(r) {
  const a = AUTH[r.auth] || { cls: 'a1', label: 'Authority ' + r.auth };
  const meta = [];
  meta.push(`<span><b>Part ${esc(r.tp)}</b></span>`);
  if (r.pn) meta.push(`<span>post ${esc(r.pn)}</span>`);
  if (r.pd) meta.push(`<span>${esc(r.pd)}</span>`);
  if (r.au) meta.push(`<span>${esc(r.au)}</span>`);
  if (r.sf) meta.push(`<span>${esc(r.sf)}${r.sl ? ' · ' + esc(r.sl) : ''}</span>`);
  if (r.vs) meta.push(`<span>${esc(r.vs)}</span>`);
  if (r.cp) meta.push(`<span>${esc(r.cp)}</span>`);
  const warn = r.auth === 1
    ? `<div class="ocrwarn">Unverified OCR (authority 1). Check the original screenshot before quoting this passage.</div>` : '';
  return `<div class="res">
    <div class="meta"><span class="badge ${a.cls}">${esc(a.label)}</span>${meta.join('')}</div>
    <div class="snip">${snippetHtml(r.snip)}</div>${warn}
  </div>`;
}

function renderNoMatch(q) {
  $('results').innerHTML = `<div class="nomatch">
    <h3>No matches in the recovered corpus</h3>
    <p>The term ${esc(JSON.stringify(q))} was not found in the corpus as recovered so far. This is <b>not</b> evidence that Gygax never said it.</p>
    <p>Parts IV–VII and XIII are absent, Part III is partial, and Part X has known archival loss. <a href="#" id="opencov">Open corpus coverage</a> before treating an absence as meaningful.</p>
  </div>`;
  const link = $('opencov');
  if (link) link.addEventListener('click', (e) => { e.preventDefault(); const cp = $('coverage-panel'); cp.open = true; cp.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

function renderCoverage() {
  const rows = [];
  DB.exec({ sql: 'SELECT thread_part tp, coverage_status cs, detail dt, known_loss kl FROM coverage ORDER BY CAST(thread_part AS INTEGER)', rowMode: 'object', callback: (r) => rows.push(r) });
  const body = rows.map((r) => `<tr>
    <td>${esc(r.tp)}</td>
    <td>${esc(r.cs)}</td>
    <td class="${r.kl ? 'loss' : ''}">${r.kl ? 'known loss' : '—'}</td>
    <td>${esc(r.dt)}</td></tr>`).join('');
  $('coverage-table').innerHTML = `<table><thead><tr><th>Part</th><th>Status</th><th>Archival loss</th><th>Detail</th></tr></thead><tbody>${body}</tbody></table>`;
  const s = DB.selectObject("SELECT (SELECT count(*) FROM documents) d, (SELECT count(*) FROM chunks) c, (SELECT sum(length(text)) FROM chunks) chars");
  $('coverage-stats').textContent = `${s.d} source records · ${s.c} searchable chunks · ${Number(s.chars).toLocaleString()} characters of searchable text.`;
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
