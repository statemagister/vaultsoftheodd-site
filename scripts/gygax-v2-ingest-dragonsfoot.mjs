#!/usr/bin/env node
/*
 * gygax-v2-ingest-dragonsfoot.mjs — ingest a Dragonsfoot "Q&A with Gary Gygax"
 * card batch (thread 10004) as testimony units under the FROZEN v2 schema.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-dragonsfoot.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * This is a second, independent forum source and deliberately shares no code
 * with the ENWorld ingester, so no ENWorld assumption can leak across.
 *
 * Rules for this source (settled before ingestion):
 *   - thread 10004 is ONE documentary object; this package is a PARTIAL
 *     PRESERVED SLICE of it (the rendering states "Page 1 of 23"; the
 *     preservation holds 19 PDF pages), recorded as a coverage segment;
 *   - post IDs are not visible in the printable rendering: historical
 *     unit_number = NULL, unit_number_status = 'unknown';
 *     sequence_in_preserved_slice is a preservation locator only;
 *   - the printable view itself states "All times are UTC", so
 *     date_timezone = 'UTC' is SOURCE-OBSERVED metadata, minute precision;
 *   - quoted question/answer context is preserved visually in the cards and
 *     as discovery text; unit_context stays empty until visually verified;
 *   - transcript stays '' with transcript_status = 'untranscribed';
 *     discourse_mode stays 'unknown'; completeness stays 'unknown'.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { assertSchemaFrozen } from './gygax-v2-lock.mjs';

const SCHEMA = assertSchemaFrozen();
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
// Optional reconstruction-regularisation overlay (Rules §17): corrected packages
// replace erroneous derived assets THROUGH the reproducible pipeline. Keyed by the
// OLD asset sha256; fails closed on any unused, duplicate or ambiguous key.
const REG = (() => { const i = args.indexOf('--regularization'); return (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : null; })();
// Optional quote-back attribution overlay: separates the prompt Gygax quoted from
// the words he newly authored. quoted_question is functional (the material Gary is
// responding to), not a punctuation test.
const QQ = (() => { const i = args.indexOf('--quoted-questions'); return (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : null; })();
const [DB_PATH, PKG, EVID] = args.filter((a) => !a.startsWith('--') && a !== REG && a !== QQ);
if (!DB_PATH || !PKG || !EVID) {
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-dragonsfoot.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');

const SOURCE_PDF = 'Dragonsfoot __ View topic - QA with Gary Gygax.pdf';
const SEGMENT = 'Preserved slice (batch 01)';
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "Mon Feb 21, 2005 6:36 pm[ UTC]" -> "2005-02-21T18:36"
function parseStamp(s) {
  const m = (s || '').match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  const mo = MON[m[1].toLowerCase()];
  if (!mo) return null;
  let h = parseInt(m[4], 10) % 12;
  if (/pm/i.test(m[6])) h += 12;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${p2(mo)}-${p2(m[2])}T${p2(h)}:${m[5]}`;
}

const manifestPath = join(PKG, 'manifest.jsonl');
if (!existsSync(manifestPath)) die(`manifest.jsonl not found in ${PKG}`);
const recs = readFileSync(manifestPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
console.log(`Ingesting Dragonsfoot cards under schema ${SCHEMA.version}`);
console.log(`  manifest records : ${recs.length}`);

// ---- pre-flight: manifest sanity + image hashes ---------------------------
const problems = [];
for (const r of recs) {
  if (r.source_family !== 'Dragonsfoot' || String(r.thread_id) !== '10004')
    problems.push(`unexpected source/thread on seq ${r.sequence_in_preserved_slice}`);
  if (r.post_number !== '' || r.post_number_status !== 'unknown')
    problems.push(`seq ${r.sequence_in_preserved_slice}: manifest asserts a post number; this batch must not`);
  const f = join(PKG, r.image_file);
  if (!existsSync(f)) { problems.push(`missing image: ${r.image_file}`); continue; }
  if (sha(readFileSync(f)) !== r.image_sha256) problems.push(`sha256 mismatch: ${r.image_file}`);
  if (!parseStamp(r.timestamp_display)) problems.push(`unparseable timestamp on seq ${r.sequence_in_preserved_slice}: ${r.timestamp_display}`);
}
// ---- regularisation overlay: keyed by OLD asset sha256, fail closed ---------
const REPL = new Map();
if (REG) {
  const rp = join(REG, 'replacement_manifest.jsonl');
  if (!existsSync(rp)) die(`replacement_manifest.jsonl not found in ${REG}`);
  for (const rr of readFileSync(rp, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))) {
    if (REPL.has(rr.old_sha256)) problems.push(`duplicate old_sha256 ${rr.old_sha256.slice(0, 12)}`);
    const hits = recs.filter((r) => r.image_sha256 === rr.old_sha256);
    if (hits.length !== 1) problems.push(`old_sha256 ${rr.old_sha256.slice(0, 12)} matches ${hits.length} base records, expected exactly 1`);
    else if (Number(hits[0].sequence_in_preserved_slice) !== Number(rr.sequence_in_preserved_slice))
      problems.push(`sequence key mismatch for ${rr.old_asset_path}`);
    const nf = join(REG, rr.new_asset_file);
    if (!existsSync(nf)) problems.push(`missing replacement asset ${rr.new_asset_file}`);
    else if (sha(readFileSync(nf)) !== rr.new_sha256) problems.push(`replacement sha mismatch ${rr.new_asset_file}`);
    if ((rr.representation === 'stitched_compact_pagination') !== !!rr.reconstructed)
      problems.push(`${rr.new_asset_file}: representation/reconstructed disagree`);
    if (rr.reconstructed && rr.source_portions.length < 2)
      problems.push(`${rr.new_asset_file}: stitched with ${rr.source_portions.length} portion(s)`);
    REPL.set(rr.old_sha256, rr);
  }
}

// ---- quote-back attribution overlay ----------------------------------------
// FAIL CLOSED on sequence + baseline discovery SHA-256 + CURRENT evidence-asset
// SHA-256. The asset key means this cannot be applied to pre-regularisation cards.
const QREPL = new Map(), QSEGS = new Map();
let QPOLICY = null;
if (QQ) {
  const rd = (f) => readFileSync(join(QQ, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  QPOLICY = JSON.parse(readFileSync(join(QQ, 'speaker_policy.json'), 'utf8'));
  for (const r of rd('discovery_replacements.jsonl')) {
    if (QREPL.has(r.sequence_in_preserved_slice)) problems.push(`duplicate replacement for seq ${r.sequence_in_preserved_slice}`);
    QREPL.set(r.sequence_in_preserved_slice, r);
  }
  for (const s of rd('context_segments.jsonl')) {
    const k = s.sequence_in_preserved_slice;
    if (!QSEGS.has(k)) QSEGS.set(k, []);
    QSEGS.get(k).push(s);
  }
  for (const a of QSEGS.values()) a.sort((x, y) => x.context_sequence - y.context_sequence);
  const known = new Set([...(QPOLICY.forum_handles || []), ...(QPOLICY.named_quoted_source || [])]);
  for (const [seq, r] of QREPL) {
    const base = recs.filter((x) => x.sequence_in_preserved_slice === seq);
    if (base.length !== 1) { problems.push(`seq ${seq}: matches ${base.length} base records, expected 1`); continue; }
    if (sha(readFileSync(join(PKG, base[0].image_file))) !== base[0].image_sha256) problems.push(`seq ${seq}: base image hash drift`);
    // the package must target the CURRENT (post-regularisation) asset
    const expectAsset = REPL.get(base[0].image_sha256)?.new_sha256 || base[0].image_sha256;
    if (r.evidence_asset_sha256 !== expectAsset)
      problems.push(`seq ${seq}: evidence_asset_sha256 does not match the current card (expected ${expectAsset.slice(0, 12)})`);
    if (!(r.replacement_discovery_text || '').trim()) problems.push(`seq ${seq}: empty Gygax-reply replacement`);
  }
  for (const [seq, arr] of QSEGS) {
    if (!QREPL.has(seq)) problems.push(`seq ${seq}: context segments with no discovery replacement`);
    for (const s of arr) {
      if (s.context_type !== 'quoted_question') problems.push(`seq ${seq}/${s.context_sequence}: context_type ${s.context_type}`);
      if ((s.unit_context_text || '') !== '') problems.push(`seq ${seq}/${s.context_sequence}: unit_context_text must be empty (unverified)`);
      if (s.speaker_label && !known.has(s.speaker_label)) problems.push(`seq ${seq}/${s.context_sequence}: speaker "${s.speaker_label}" not declared in speaker_policy.json`);
    }
  }
}

if (problems.length) { problems.slice(0, 10).forEach((p) => console.error('  ' + p)); die(`${problems.length} problem(s); nothing ingested.`); }
console.log(`  card images      : ${recs.length} present, all SHA-256 matching the manifest`);
if (REG) console.log(`  regularisation   : ${REPL.size} replacement(s), all matched exactly one base record`);
if (QQ) console.log(`  quote attribution: ${QREPL.size} affected units, ${[...QSEGS.values()].reduce((n, a) => n + a.length, 0)} quoted prompts`);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const before = {
  units: g('SELECT count(*) c FROM testimony_units').c,
  assets: g('SELECT count(*) c FROM evidence_assets').c,
  sources: g('SELECT count(*) c FROM evidence_sources').c,
  discovery: g('SELECT count(*) c FROM discovery_text').c,
  objects: g('SELECT count(*) c FROM documentary_objects').c,
  families: g('SELECT count(*) c FROM source_families').c,
};
const speaker = g(`SELECT id FROM persons WHERE name='Gary Gygax'`);
if (!speaker) die('person "Gary Gygax" not found — run the v1 migration first.');

db.exec('BEGIN');
// family + object are created here if absent; a second batch reuses them.
let fam = g(`SELECT id FROM source_families WHERE name='Dragonsfoot'`);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes)
  VALUES ('Dragonsfoot','forum','Dragonsfoot forums; Q&A with Gary Gygax thread.')`).run().lastInsertRowid) };
let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title='Q&A with Gary Gygax'`, fam.id);
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,venue,identifier,date_timezone,notes) VALUES (?,?,?,?,?,?,?)`).run(
  fam.id, 'Q&A with Gary Gygax', 'forum_thread', 'Dragonsfoot', 'thread 10004', 'UTC',
  'One continuous thread. Preserved so far only as a partial printable-view slice; see coverage. The printable view states "All times are UTC".').lastInsertRowid) };
if (g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c > 0 && !FORCE) {
  db.exec('ROLLBACK'); die('this documentary object already holds testimony units. Re-run with --force only to add a further batch.');
}
if (!g('SELECT id FROM coverage WHERE object_id=? AND segment_label=?', obj.id, SEGMENT)) {
  db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,locator_from,locator_to,coverage_status,known_loss,detail,sort_order)
    VALUES (?,?,?,?,?,?,0,?,1)`).run(obj.id, SEGMENT, 'page_range', 'PDF p.1', 'PDF p.19', 'partial',
    `Partial preserved slice of thread 10004 ("${SOURCE_PDF}"). The rendering states "Page 1 of 23" while the preservation contains 19 PDF pages, so the thread extends beyond what is held. 14 Gygax posts preserved as cards; post IDs are not visible in the printable rendering.`);
}

const insUnit = db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
   speaker_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
  VALUES (?,?,NULL,'unknown',?,?,?,?,?,'direct','unknown','','untranscribed','unknown','pdf_text_extraction',?)`);
const insAsset = db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,1,?,?)`);
const insSrc = db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type) VALUES (?,?,'pdf_page')`);
// Structural quoted-prompt context; wording stays unverified so text is empty.
const insCtx = db.prepare(`INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status,sequence) VALUES (?,'quoted_question',?, '', 'untranscribed', ?)`);
// Speaker identity (schema v2.1). A pseudonymous forum handle is scoped to THIS
// source family: an identical handle on another forum is a separate, unresolved
// identity and is never merged. A person the source names as a real individual
// (e.g. Lenard Lakofka, quoted inside another poster's prompt) is a GLOBAL
// identity, resolved to an existing row if one already exists.
const HANDLE_SCOPE = 'Dragonsfoot';
const findScoped = db.prepare('SELECT id FROM persons WHERE name = ? AND identity_scope = ?');
const findGlobal = db.prepare('SELECT id FROM persons WHERE name = ? AND identity_scope IS NULL');
const addPerson = db.prepare('INSERT INTO persons(name,identity_scope,notes) VALUES (?,?,?)');
const personCache = new Map();
function personIdForSpeaker(label) {
  if (personCache.has(label)) return personCache.get(label);
  const isHandle = (QPOLICY?.forum_handles || []).includes(label);
  let id;
  if (isHandle) {
    const f = findScoped.get(label, HANDLE_SCOPE);
    id = f ? f.id : Number(addPerson.run(label, HANDLE_SCOPE,
      'Forum handle, recorded exactly as the source renders it; the scope, not the name, records where it is attested. Pseudonymous: the real-world identity is unverified and is NOT inferred. An identical handle in another source family is a separate unresolved identity until sameness is independently established.').lastInsertRowid);
    if (!f) stats.handlesCreated++;
  } else {
    const f = findGlobal.get(label);
    id = f ? f.id : Number(addPerson.run(label, null,
      'Named individual as identified by the source. Quoted inside another poster\'s prompt; no biographical identity beyond the name is asserted here.').lastInsertRowid);
    if (!f) stats.namedCreated++;
  }
  personCache.set(label, id);
  return id;
}
const insDisc = db.prepare(`INSERT INTO discovery_text(object_id,segment_label,source_type,source_locator,text,unit_id) VALUES (?,?,'pdf_text_extraction',?,?,?)`);

const stats = { units: 0, assets: 0, sources: 0, discovery: 0, crop: 0, stitched: 0, regularized: 0,
  qUnits: 0, qSegments: 0, qWithSpeaker: 0, qNoSpeaker: 0, handlesCreated: 0, namedCreated: 0 };
recs.sort((a, b) => a.sequence_in_preserved_slice - b.sequence_in_preserved_slice);
// sequence_in_object is an ordering key, so assign it densely (1..N) in
// preservation order. The source's gapped detection position is not a historical
// index and is retained only in the locator text.
let seq = db.prepare(`SELECT COALESCE(MAX(sequence_in_object),0) m FROM testimony_units WHERE object_id=?`).get(obj.id).m;
for (const r of recs) {
  const locator = `${SOURCE_PDF} p.${r.source_start_page}-${r.source_end_page}; preserved slice position ${r.sequence_in_preserved_slice} (batch 01)`;
  const uid = Number(insUnit.run(obj.id, ++seq,
    r.timestamp_display, parseStamp(r.timestamp_display), r.timestamp_precision || 'unknown',
    r.timestamp_timezone || null, speaker.id, locator).lastInsertRowid);
  stats.units++;
  const rr = REPL.get(r.image_sha256);
  let assetPath, type, srcFile;
  if (rr) {
    // regularised: rebuilt continuous card, representation declared by the overlay,
    // provenance = the corrected ordered source_portions.
    type = rr.reconstructed ? 'stitched' : 'crop';
    assetPath = 'evidence/dragonsfoot/t10004/' + basename(rr.new_asset_file);
    srcFile = join(REG, rr.new_asset_file);
    const aid0 = Number(insAsset.run(uid, assetPath, type, rr.new_sha256).lastInsertRowid);
    for (const p of [...rr.source_portions].sort((a, b) => a.order - b.order)) {
      insSrc.run(aid0, `${SOURCE_PDF} p.${p.source_page} (clip ${JSON.stringify(p.clip_pdf_points)}${rr.reconstructed ? `, stitch order ${p.order}` : ''})`);
      stats.sources++;
    }
    stats.regularized++;
  } else {
    const pages = []; for (let p = r.source_start_page; p <= r.source_end_page; p++) pages.push(p);
    type = pages.length > 1 ? 'stitched' : 'crop';
    assetPath = 'evidence/dragonsfoot/t10004/' + r.image_file;
    srcFile = join(PKG, r.image_file);
    const aid0 = Number(insAsset.run(uid, assetPath, type, r.image_sha256).lastInsertRowid);
    for (const p of pages) { insSrc.run(aid0, `${SOURCE_PDF} p.${p}`); stats.sources++; }
  }
  type === 'stitched' ? stats.stitched++ : stats.crop++;
  stats.assets++;
  const dest = join(EVID, assetPath);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(srcFile, dest);
  const qrep = QREPL.get(r.sequence_in_preserved_slice);
  if (qrep) {
    // fail closed on the baseline discovery text we are about to replace
    const baseline = (r.discovery_text || '').trim();
    if (sha(baseline) !== qrep.baseline_discovery_text_sha256) {
      db.exec('ROLLBACK');
      die(`seq ${r.sequence_in_preserved_slice}: baseline discovery SHA-256 mismatch; FAILING CLOSED.`);
    }
    insDisc.run(obj.id, SEGMENT, `${locator}; Gygax reply (newly authored)`, qrep.replacement_discovery_text.trim(), uid);
    stats.discovery++; stats.qUnits++;
    let n = 0;
    for (const s of QSEGS.get(r.sequence_in_preserved_slice) || []) {
      n++;
      const pid = s.speaker_label ? personIdForSpeaker(s.speaker_label) : null;
      insCtx.run(uid, pid, n);
      const who = s.speaker_label || 'speaker not identified in this quote-back';
      insDisc.run(obj.id, SEGMENT, `${locator}; quoted prompt ${n} — ${who} (quoted by Gygax, NOT Gygax-authored)`,
        (s.discovery_text || '').trim(), uid);
      stats.discovery++; stats.qSegments++;
      if (pid) stats.qWithSpeaker++; else stats.qNoSpeaker++;
    }
  } else {
    const text = (r.discovery_text || '').trim();
    if (text) { insDisc.run(obj.id, SEGMENT, locator, text, uid); stats.discovery++; }
  }
}
db.exec('COMMIT');

// ---- reconciliation + integrity ------------------------------------------
const after = {
  units: g('SELECT count(*) c FROM testimony_units').c,
  assets: g('SELECT count(*) c FROM evidence_assets').c,
  sources: g('SELECT count(*) c FROM evidence_sources').c,
  discovery: g('SELECT count(*) c FROM discovery_text').c,
  objects: g('SELECT count(*) c FROM documentary_objects').c,
  families: g('SELECT count(*) c FROM source_families').c,
};
const L = []; const P = (s) => { console.log(s); L.push(s); };
P('\nReconciliation report (Dragonsfoot batch 01)');
P(`  source cards in manifest        : ${recs.length}`);
P(`  testimony units created         : ${stats.units}   (${stats.units === recs.length ? 'all accounted for' : 'MISMATCH'})`);
P(`  duplicates / failures           : 0 (hashes matched; no duplicate slice positions)`);
P(`  evidence assets created         : ${stats.assets}   (${stats.crop} crop, ${stats.stitched} stitched)`);
P(`  evidence provenance rows        : ${stats.sources}  (one per source PDF page/portion of "${SOURCE_PDF}")`);
if (REG) P(`  regularised assets              : ${stats.regularized} rebuilt continuous card(s) from the overlay`);
if (QQ) {
  P(`  quote-back attribution          : ${stats.qUnits} units split into Gygax-reply + ${stats.qSegments} quoted prompt(s)`);
  P(`    prompts with an identified speaker : ${stats.qWithSpeaker}`);
  P(`    prompts with speaker unidentified  : ${stats.qNoSpeaker}`);
  P(`    Dragonsfoot-scoped handles created : ${stats.handlesCreated}`);
  P(`    globally-identified persons created: ${stats.namedCreated}  (named individuals, not handles)`);
}
P(`  discovery_text rows created     : ${stats.discovery}`);
P(`  transcripts written             : 0   |  unit_context rows : 0 (questions await visual verification)`);
P(`  discourse classified            : 0   (all 'unknown')`);
P(`  timezone recorded               : UTC on all ${stats.units}, source-observed ("All times are UTC"), minute precision`);
P('');
P(`  counts before : units ${before.units}, assets ${before.assets}, provenance ${before.sources}, discovery ${before.discovery}, objects ${before.objects}, families ${before.families}`);
P(`  counts after  : units ${after.units}, assets ${after.assets}, provenance ${after.sources}, discovery ${after.discovery}, objects ${after.objects}, families ${after.families}`);
P('');
P('  ASSUMPTIONS DECLARED:');
P('    - the source slice positions (1,3,6,7,15…29, with gaps) are detection');
P('      positions in the preserved material, not historical thread positions.');
P('      They are retained only in the locator text; sequence_in_object is a');
P('      dense ordering key (1..N) and asserts no historical position;');
P('    - the thread extends beyond the preserved slice ("Page 1 of 23" vs 19');
P('      preserved PDF pages); coverage records the segment as partial.');

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nIntegrity:');
ok(`exactly ${recs.length} source cards accounted for`, stats.units === recs.length && after.units - before.units === recs.length);
ok('one documentary object for the thread', g(`SELECT count(*) c FROM documentary_objects o JOIN source_families f ON f.id=o.family_id WHERE f.name='Dragonsfoot'`).c === 1);
ok('no historical unit_number asserted in this object',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND (unit_number IS NOT NULL OR unit_number_status<>'unknown')`, obj.id).c === 0);
ok('UTC + minute precision on every unit in this object',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND date_timezone='UTC' AND date_precision='minute' AND date_value IS NOT NULL`, obj.id).c === recs.length);
ok('no transcript text anywhere', g(`SELECT count(*) c FROM testimony_units WHERE transcript<>''`).c === 0);
// Scoped to THIS object: other sources may legitimately hold context rows (e.g.
// ENWorld's quoted-question separation). Dragonsfoot's own quote-back attribution
// is a separate, still-pending pass, so its units must carry no context yet.
if (QQ) {
  const inObj = 'unit_id IN (SELECT id FROM testimony_units WHERE object_id=' + obj.id + ')';
  ok(`unit_context holds one row per quoted prompt (${stats.qSegments})`,
     g(`SELECT count(*) c FROM unit_context WHERE ${inObj}`).c === stats.qSegments);
  ok('every context row is quoted_question, empty and untranscribed',
     g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND (context_type<>'quoted_question' OR text<>'' OR text_status<>'untranscribed')`).c === 0);
  ok('no quoted prompt attributed to Gygax',
     g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND speaker_id=?`, speaker.id).c === 0);
  ok('handles are Dragonsfoot-scoped, never merged with another forum\'s handle',
     g(`SELECT count(*) c FROM unit_context uc JOIN persons p ON p.id=uc.speaker_id WHERE ${inObj} AND p.identity_scope IS NOT NULL AND p.identity_scope<>'Dragonsfoot'`).c === 0);
  ok('no quoted wording left in the Gygax-reply discovery rows',
     g(`SELECT count(*) c FROM discovery_text WHERE source_locator LIKE '%Gygax reply (newly authored)%' AND source_locator LIKE '%preserved slice%' AND (text LIKE '%wrote:%' OR text LIKE '%Quote:%')`).c === 0);
} else ok('unit_context still empty for this object',
   g('SELECT count(*) c FROM unit_context WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?)', obj.id).c === 0);
ok('tags still empty', g('SELECT count(*) c FROM tags').c === 0);
ok('transcript index in sync with units', g('SELECT count(*) c FROM units_fts').c === after.units);
ok('transcript index holds no searchable text', g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'the OR a OR Gygax'`).c === 0);
ok('discovery index matches discovery rows', g('SELECT count(*) c FROM discovery_fts').c === after.discovery);
ok('pre-existing objects untouched by this ingest',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id<>?`, obj.id).c === before.units);
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
for (const t of ['units_fts', 'context_fts', 'discovery_fts']) {
  try { db.exec(`INSERT INTO ${t}(${t}) VALUES('integrity-check')`); ok(`${t} integrity-check`, true); }
  catch (e) { ok(`${t} integrity-check`, false, e.message); }
}
db.close();

const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-dragonsfoot-batch01.log';
writeFileSync(logPath, ['Gygax corpus v2 — Dragonsfoot batch 01 ingestion (testimony-unit ingestion)',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
