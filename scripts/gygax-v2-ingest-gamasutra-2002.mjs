#!/usr/bin/env node
/*
 * gygax-v2-ingest-gamasutra-2002.mjs — ingest "The Dungeon Master: An Interview
 * with Gary Gygax" (Gamasutra, Harvey Smith, 1 November 2002) under the frozen
 * v2 schema.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-gamasutra-2002.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * Second formal interview, and the first ingestion to exercise the finalised
 * continuous-card reconstruction rule end to end. One historical answer = one
 * evidence card; an answer that crosses preservation pages is a single continuous
 * STITCHED card (asset_type='stitched') with ordered provenance to each
 * contributing page — NOT paired assets. Eight answers are ordinary single-page
 * crops; six (q3,q4,q5,q6,q9,q13) are stitched and are content-affecting
 * reconstructions that must pass the eyes-on acceptance gate before any build.
 *
 * Interviewer questions follow the GameSpy pattern: a structural unit_context row
 * (Harvey Smith, interviewer_question, empty/untranscribed) records who asked,
 * while the unverified question WORDING lives in discovery_text. Gygax answers are
 * discovery_text only; transcripts stay untranscribed (0 verified here).
 *
 * The unchanged 11-page PDF and its page renders are preservation sources: hash-
 * recorded and left OFFLINE. Only the 14 cards are staged for encryption.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { assertSchemaFrozen } from './gygax-v2-lock.mjs';

const SCHEMA = assertSchemaFrozen();
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const [DB_PATH, PKG, EVID] = args.filter((a) => !a.startsWith('--'));
if (!DB_PATH || !PKG || !EVID) {
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-gamasutra-2002.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const spec = JSON.parse(readFileSync(join(PKG, 'ingestion_spec.json'), 'utf8'));
const testimony = jsonl(join(PKG, 'testimony_manifest.jsonl'));
const am = JSON.parse(readFileSync(join(PKG, 'asset_manifest.json'), 'utf8'));
const assetBySeq = new Map(am.map((a) => [a.sequence, a]));

// ---- validate the package (report mismatches, do not compensate) -----------
const exp = spec.ingestion_expectations;
const problems = [];
if (testimony.length !== exp.testimony_units) problems.push(`expected ${exp.testimony_units} units, found ${testimony.length}`);
if (am.length !== exp.evidence_assets) problems.push(`expected ${exp.evidence_assets} assets, found ${am.length}`);
let nCrop = 0, nStitch = 0, nProv = 0;
for (const a of am) {
  if (a.asset_type === 'crop') nCrop++; else if (a.asset_type === 'stitched') nStitch++;
  else problems.push(`${a.asset}: unexpected asset_type ${a.asset_type}`);
  nProv += (a.provenance || []).length;
  const f = join(PKG, 'evidence', a.asset);
  if (!existsSync(f)) problems.push(`missing card: ${a.asset}`);
  else if (shaFile(f) !== a.sha256) problems.push(`${a.asset}: sha256 mismatch`);
  // stitched must draw on >1 page; crop on exactly 1
  const pages = new Set((a.provenance || []).map((p) => p.source_page));
  if (a.asset_type === 'stitched' && pages.size < 2) problems.push(`${a.asset}: stitched but <2 source pages`);
  if (a.asset_type === 'crop' && pages.size !== 1) problems.push(`${a.asset}: crop but not single-source`);
}
if (nCrop !== exp.asset_types.crop) problems.push(`crop count ${nCrop} != expected ${exp.asset_types.crop}`);
if (nStitch !== exp.asset_types.stitched) problems.push(`stitched count ${nStitch} != expected ${exp.asset_types.stitched}`);
if (nProv !== exp.provenance_rows) problems.push(`provenance total ${nProv} != expected ${exp.provenance_rows}`);
const specStitch = new Set(spec.stitched_units);
for (const a of am) {
  const isStitch = a.asset_type === 'stitched';
  if (isStitch !== specStitch.has(a.sequence)) problems.push(`seq ${a.sequence}: stitched flag disagrees with spec.stitched_units`);
}
// preservation sources: PDF + every referenced page render present & sha-recorded
if (!existsSync(join(PKG, 'source.pdf'))) problems.push('received source.pdf missing');
const pdfSha = existsSync(join(PKG, 'source.pdf')) ? shaFile(join(PKG, 'source.pdf')) : null;
const pageSha = new Map();
for (const a of am) for (const p of a.provenance || []) {
  const pf = join(PKG, 'source_pages', `page-${String(p.source_page).padStart(2, '0')}.png`);
  if (!pageSha.has(p.source_page)) {
    if (!existsSync(pf)) problems.push(`preserved page render missing: page ${p.source_page}`);
    else pageSha.set(p.source_page, shaFile(pf));
  }
}
if (problems.length) { problems.slice(0, 20).forEach((p) => console.error('  ' + p)); die(`${problems.length} package problem(s); nothing ingested.`); }
console.log(`Gamasutra 2002 — package verified under schema ${SCHEMA.version}`);
console.log(`  ${testimony.length} units · ${nCrop} crop + ${nStitch} stitched assets · ${nProv} provenance rows · PDF ${pdfSha.slice(0, 16)}… (offline)`);
console.log(`  stitched (need eyes-on acceptance before build): q${spec.stitched_units.join(', q')}`);

// ---- ingest -----------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const B = (t) => g(`SELECT count(*) c FROM ${t}`).c;
const before = { objects: B('documentary_objects'), units: B('testimony_units'), context: B('unit_context'),
  assets: B('evidence_assets'), sources: B('evidence_sources'), discovery: B('discovery_text'), coverage: B('coverage') };

db.exec('BEGIN');
const gygax = g(`SELECT id FROM persons WHERE name='Gary Gygax'`);
if (!gygax) { db.exec('ROLLBACK'); die('speaker "Gary Gygax" not found — run the v1 migration first.'); }
let harvey = g(`SELECT id FROM persons WHERE name='Harvey Smith'`);
if (!harvey) harvey = { id: Number(db.prepare(`INSERT INTO persons(name,notes) VALUES ('Harvey Smith','Gamasutra interviewer; question-context speaker, not a testimony speaker.')`).run().lastInsertRowid) };
let fam = g(`SELECT id FROM source_families WHERE name='Gamasutra'`);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes) VALUES ('Gamasutra','interview','Games-industry site; published interviews preserved as page renderings.')`).run().lastInsertRowid) };

const TITLE = spec.source.title;
let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title=?`, fam.id, TITLE);
if (obj && !FORCE) { db.exec('ROLLBACK'); die(`object "${TITLE}" already present; use --force on a clean DB.`); }
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,date_display,date_from_value,date_precision,venue,citation,identifier,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
  fam.id, TITLE, 'interview', '1 November 2002', spec.source.publication_date, 'day', 'Gamasutra',
  `Harvey Smith, "${TITLE}", Gamasutra, 1 November 2002.`, null,
  'One documentary object = the Gamasutra interview. The 2018 PDF footer is preservation/render metadata, NOT publication metadata. The contemporary Nov-2002 Game Developer magazine manifestation is abridged related publication history, not a duplicate testimony object.').lastInsertRowid) };

const interp = [];
const uidBySeq = new Map(); const stitchedAssets = [];
for (const rec of testimony) {
  const seq = Number(rec.sequence_in_object);
  const a = assetBySeq.get(seq);
  const loc = `Gamasutra 2002 interview, answer ${seq} (preservation locator)`;
  const uid = Number(db.prepare(`INSERT INTO testimony_units
    (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
     speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
    VALUES (?,?,NULL,'unknown','1 November 2002',?,'day',NULL,?,NULL,'direct','commentary','', 'untranscribed','complete','pdf_text_extraction',?)`).run(
    obj.id, seq, spec.source.publication_date, gygax.id, loc).lastInsertRowid);
  uidBySeq.set(seq, uid);

  // structural interviewer-question context row (Harvey Smith), empty/untranscribed
  db.prepare(`INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status,sequence) VALUES (?,'interviewer_question',?, '', 'untranscribed', 1)`).run(uid, harvey.id);
  // question wording -> discovery (labelled Harvey Smith), never Gygax transcript/context index
  const qtext = (rec.context && rec.context.discovery_text || '').trim();
  if (qtext) db.prepare(`INSERT INTO discovery_text(object_id,unit_id,segment_label,source_type,source_locator,text) VALUES (?,?, 'Gamasutra 2002','pdf_text_extraction', ?, ?)`)
    .run(obj.id, uid, `interviewer question — Harvey Smith — answer ${seq}`, qtext);
  // Gygax answer wording -> discovery; transcript stays empty
  const atext = (rec.discovery_text || '').trim();
  if (atext) db.prepare(`INSERT INTO discovery_text(object_id,unit_id,segment_label,source_type,source_locator,text) VALUES (?,?, 'Gamasutra 2002','pdf_text_extraction', ?, ?)`)
    .run(obj.id, uid, `Gygax answer — answer ${seq}`, atext);

  // evidence: ONE card per unit (crop or continuous stitched), ordered provenance
  const assetPath = 'evidence/gamasutra/' + basename(a.asset);
  const aid = Number(db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,1,?,?)`)
    .run(uid, assetPath, a.asset_type, a.sha256).lastInsertRowid);
  for (const p of a.provenance) {
    db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,original_sha256,capture_date_precision) VALUES (?,?,'pdf_page',?, 'unknown')`)
      .run(aid, `Gamasutra received PDF page ${p.source_page} of 11${a.asset_type === 'stitched' ? ` (stitch order ${p.order})` : ''}, crop box ${JSON.stringify(p.crop_box_pixels)} on 200-dpi render; PDF + renders held offline`, pageSha.get(p.source_page));
  }
  const dest = join(EVID, assetPath); mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(PKG, 'evidence', a.asset), dest);   // stage ONLY the card
  if (a.asset_type === 'stitched') stitchedAssets.push({ seq, assetPath, sha: a.sha256, pages: a.provenance.map((p) => p.source_page) });
}

// coverage: whole interview preserved complete
db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,locator_from,locator_to,coverage_status,known_loss,detail,sort_order)
  VALUES (?, 'Preserved 11-page interview','page_range','page 1 of 11','page 11 of 11','complete',0, ?, 1)`).run(
  obj.id, 'Complete as preserved in the received 11-page PDF; PDF and page renders held offline. Abridged Game Developer magazine version not ingested.');

// object-level preservation note
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'preservation', ?)`).run(
  uidBySeq.get(1), 'Publication 1 November 2002 (day). The 2018 PDF footer is preservation/render metadata only. Interviewer questions held as unverified discovery text with structural unit_context rows attributing them to Harvey Smith. Six answers (q3,q4,q5,q6,q9,q13) crossed preservation pages and are single continuous stitched cards under the corpus continuous-card rule, each with ordered provenance to its contributing pages; they require eyes-on reconstruction acceptance.');

db.exec('COMMIT');

// ---- reconciliation report -------------------------------------------------
const A = (t) => B(t);
const after = { objects: A('documentary_objects'), units: A('testimony_units'), context: A('unit_context'),
  assets: A('evidence_assets'), sources: A('evidence_sources'), discovery: A('discovery_text'), coverage: A('coverage') };
const oid = obj.id;
const L = []; const P = (s) => { console.log(s); L.push(s); };
P('\nReconciliation report — Gamasutra 2002');
P(`  documentary object   : +${after.objects - before.objects} (expected 1, interview)`);
P(`  testimony units      : +${after.units - before.units} (expected 14)`);
P(`  unit_context rows    : +${after.context - before.context} (expected 14, Harvey Smith)`);
P(`  evidence assets      : +${after.assets - before.assets} (expected 14 = 8 crop + 6 stitched)`);
P(`  provenance rows      : +${after.sources - before.sources} (expected 20)`);
P(`  discovery records    : +${after.discovery - before.discovery} (expected 28 = 14 answers + 14 questions)`);
P(`  coverage segments    : +${after.coverage - before.coverage} (expected 1)`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
const inObj = `unit_id IN (SELECT id FROM testimony_units WHERE object_id=${oid})`;
P('\nConfirmations:');
ok('14 Gygax direct units, all untranscribed (0 verified)',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND speaker_id=? AND evidence_relationship='direct' AND transcript_status='untranscribed'`, oid, gygax.id).c === 14 &&
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND transcript_status='verified'`, oid).c === 0);
ok('8 crop + 6 stitched evidence assets',
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='crop'`).c === 8 &&
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='stitched'`).c === 6);
ok('20 provenance rows (8 crop×1 + 6 stitched×2)',
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj})`).c === 20);
ok('each stitched card carries 2 ordered provenance rows',
   g(`SELECT count(*) c FROM (SELECT asset_id FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj} AND asset_type='stitched') GROUP BY asset_id HAVING count(*)=2)`).c === 6);
ok('the 6 stitched cards are exactly q3,q4,q5,q6,q9,q13',
   g(`SELECT group_concat(sequence_in_object) g FROM testimony_units WHERE object_id=? AND id IN (SELECT unit_id FROM evidence_assets WHERE asset_type='stitched') ORDER BY sequence_in_object`, oid).g
   .split(',').map(Number).sort((a,b)=>a-b).join(',') === '3,4,5,6,9,13');
ok('interviewer questions attributed to Harvey Smith, none to Gygax',
   g(`SELECT count(*) c FROM unit_context WHERE speaker_id=? AND ${inObj}`, harvey.id).c === 14 &&
   g(`SELECT count(*) c FROM unit_context WHERE speaker_id=? AND ${inObj}`, gygax.id).c === 0);
P('\nFTS behaviour:');
ok('Gygax transcript index (units_fts) holds NO Gamasutra text (all untranscribed)',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'Lejendary OR grandmaster'`).c === 0);
ok('context_fts empty for Gamasutra (no verified question wording)',
   g(`SELECT count(*) c FROM context_fts JOIN unit_context c ON c.id=context_fts.rowid WHERE ${inObj.replace('unit_id','c.unit_id')} AND context_fts MATCH 'surreal OR EverQuest'`).c === 0);
ok('interviewer question searchable in discovery_fts (labelled Harvey Smith)',
   g(`SELECT count(*) c FROM discovery_fts JOIN discovery_text d ON d.id=discovery_fts.rowid WHERE d.object_id=? AND d.source_locator LIKE 'interviewer question%' AND discovery_fts MATCH 'surreal'`, oid).c >= 1);
ok('Gygax answer searchable in discovery_fts (labelled answer)',
   g(`SELECT count(*) c FROM discovery_fts JOIN discovery_text d ON d.id=discovery_fts.rowid WHERE d.object_id=? AND d.source_locator LIKE 'Gygax answer%' AND discovery_fts MATCH 'grandmaster'`, oid).c >= 1);
P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('units_fts in sync with units', A('units_fts') === after.units);
ok('context_fts in sync with unit_context', A('context_fts') === after.context);
ok('discovery_fts in sync with discovery_text', A('discovery_fts') === after.discovery);

P('\nWithin-schema interpretations (nothing required outside the frozen schema):');
P("  - discourse_mode not specified by the package -> 'commentary' (interview remarks; a within-schema vocabulary choice).");
P("  - per-unit completeness not specified -> 'complete' (each answer complete as preserved).");
P('  - source_locator holds a preservation locator; unit_number NULL/unknown (interview answers carry no source number).');
P('  - interviewer questions: structural unit_context (Harvey Smith) + wording in discovery_text (same as GameSpy).');
P('  - 2018 footer left as preservation metadata; abridged Game Developer magazine version not ingested.');

// stitched cards awaiting eyes-on acceptance (write a sidecar the acceptance step reads)
P('\nStitched cards requiring eyes-on acceptance before the build gate passes:');
for (const s of stitchedAssets) P(`  q${String(s.seq).padStart(2,'0')}  ${s.assetPath}  <- pages ${s.pages.join('+')}  sha ${s.sha.slice(0,12)}`);
writeFileSync(DB_PATH.replace(/\.sqlite$/, '') + '.gamasutra-stitched.json', JSON.stringify(stitchedAssets, null, 2));

db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-gamasutra-2002.log';
writeFileSync(logPath, ['Gygax corpus v2 — Gamasutra 2002 interview ingestion (continuous-card reconstruction rule)',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, `received PDF (offline) sha256 : ${pdfSha}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
