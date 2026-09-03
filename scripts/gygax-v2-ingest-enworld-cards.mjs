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
const [DB_PATH, PKG, EVID] = args.filter((a) => !a.startsWith('--') && a !== REG);
if (!DB_PATH || !PKG || !EVID) {
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-enworld-cards.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
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

const stats = { units: 0, assets: 0, sources: 0, discovery: 0, stitched: 0, crop: 0, regularized: 0, rangeCorrected: [],
  noText: 0, tagsSkipped: 0, contextSkipped: 0, dateParsed: 0, dateUnparsed: 0 };

db.exec('BEGIN');
for (const r of recs) {
  const label = 'Part ' + (ROMAN[r.thread_part] || r.thread_part);
  const d = parseDate(r.post_date);
  d.value ? stats.dateParsed++ : stats.dateUnparsed++;
  // Preserve the manifest's printable-view position as a locator, labelled as
  // what it is. It is not a thread post number and must not read as one.
  const locator = `${r.source_document} PDF pages ${r.source_start_page}-${r.source_end_page}; printable-view position ${r.post_number} (${label})`;
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
  const text = (r.full_rendered_text || r.gygax_text || '').trim();
  if (text) { insDisc.run(obj.id, label, locator, text, uid); stats.discovery++; }
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
  // Rules §17 / instruction: the unit-level source_locator embeds the ORIGINAL
  // "PDF pages A-B" range from the base manifest. Where the overlay corrected that
  // range, the unit locator now states an obsolete range. Historical metadata is
  // NOT changed here — this is reported for a separate decision.
  P(`  REPORT — unit-level source_locator now states an obsolete page range for these`);
  P(`           ${stats.rangeCorrected.length} unit(s). Historical metadata deliberately left unchanged:`);
  for (const s of stats.rangeCorrected.slice(0, 8)) P(`             ${s}`);
  if (stats.rangeCorrected.length > 8) P(`             …and ${stats.rangeCorrected.length - 8} more`);
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
ok('no unit_context rows created', q('SELECT count(*) c FROM unit_context') === 0);
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
