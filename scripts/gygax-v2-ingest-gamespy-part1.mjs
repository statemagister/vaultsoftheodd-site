#!/usr/bin/env node
/*
 * gygax-v2-ingest-gamespy-part1.mjs — ingest the GameSpy "Gary Gygax
 * Interview - Part I" (Allen Rausch, 15 August 2004) under the frozen v2 schema.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-gamespy-part1.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * This is the corpus's FIRST interview source and first deliberate exercise of
 * unit_context. It ingests the corrected v2 package (per-unit source-native
 * crops; page-crossing answers carry multiple ordered crops; nothing stitched).
 *
 *   1 documentary object (interview)  ->  28 Gygax answer testimony units
 *   each unit  ->  one or two ordered source-native crops (asset_type='crop')
 *   each crop  ->  one provenance row to the exact preserved page (PDF offline)
 *
 * FROZEN-SCHEMA REPRESENTATION OF THE INTERVIEWER QUESTION
 * -------------------------------------------------------
 * unit_context enforces the same purity as transcript: text is either verified
 * (non-empty) or untranscribed (empty). The package's question wording is PDF-
 * derived and explicitly NOT verified ("not promoted ... merely because the
 * interview format makes speaker boundaries clear"). So the schema's only legal
 * home for the unverified question WORDING is discovery_text. We therefore:
 *   - create a STRUCTURAL unit_context row per unit (interviewer_question,
 *     speaker = Allen Rausch, empty text, untranscribed) — recording that an
 *     interviewer question exists and who asked it, ready to be promoted to
 *     verified context wording after manual visual verification; and
 *   - store the question WORDING as discovery_text, labelled as Rausch's
 *     interviewer question, unverified, unit-scoped.
 * Consequences (reported, not worked around): the interviewer question is
 * searchable in the DISCOVERY dimension, never in the Gygax transcript index,
 * and is never attributed to Gygax; context_fts is empty by design until a
 * question is verified.  Gygax's own answers are likewise discovery_text only;
 * transcript stays untranscribed.
 *
 * The received nine-page PDF and the nine full page renderings are preservation
 * sources: verified by hash, recorded in provenance, and left OFFLINE. Only the
 * per-unit crops are staged for encryption.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { assertSchemaFrozen } from './gygax-v2-lock.mjs';

const SCHEMA = assertSchemaFrozen();
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
// Optional reconciliation overlay (Rules §17: corrected packages replace erroneous
// derived assets THROUGH the reproducible pipeline). When supplied, the compact
// cross-page exchanges named in the overlay are produced as ONE continuous stitched
// card with ordered provenance to both contributing pages, instead of the earlier
// paired ordered crops. The superseded pairing is then simply never produced.
const RECON = (() => { const i = args.indexOf('--reconciliation'); return (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : null; })();
const [DB_PATH, PKG, EVID] = args.filter((a) => !a.startsWith('--') && a !== RECON);
if (!DB_PATH || !PKG || !EVID) {
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-gamespy-part1.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--reconciliation <dir>] [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const csv = (p) => {
  const [head, ...rows] = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
  const cols = head.split(',');
  return rows.map((r) => { const v = r.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
};

// ---- read + validate the package (report mismatches, do not compensate) -----
const testimony = jsonl(join(PKG, 'testimony.jsonl'));
const assets = jsonl(join(PKG, 'evidence_assets.jsonl'));
const prov = csv(join(PKG, 'provenance_rows.csv'));
const related = existsSync(join(PKG, 'related_sources.csv')) ? csv(join(PKG, 'related_sources.csv')) : [];

const problems = [];
if (testimony.length !== 28) problems.push(`expected 28 testimony units, found ${testimony.length}`);
if (assets.length !== 35) problems.push(`expected 35 canonical evidence assets, found ${assets.length}`);
if (prov.length !== assets.length) problems.push(`provenance rows (${prov.length}) != assets (${assets.length})`);

// every asset: single source page, deterministic crop, no stitching, file present & hash-verified
for (const a of assets) {
  if (a.asset_type !== 'source_native_unit_crop') problems.push(`${a.asset_id}: unexpected asset_type "${a.asset_type}"`);
  if (/stitch/i.test(a.derivation || '') && !/no\s+stitch/i.test(a.derivation || '')) problems.push(`${a.asset_id}: derivation claims stitching`);
  if (a.source_page == null) problems.push(`${a.asset_id}: no source_page`);
  const f = join(PKG, a.path);
  if (!existsSync(f)) problems.push(`${a.asset_id}: missing crop file ${a.path}`);
  else if (shaFile(f) !== a.sha256) problems.push(`${a.asset_id}: crop sha256 mismatch`);
}
// every provenance page render must exist offline and hash-match its provenance row
const pageSha = new Map(); // source_page -> sha
for (const r of prov) {
  const pf = join(PKG, r.source_path);
  if (!existsSync(pf)) { problems.push(`preservation page missing: ${r.source_path}`); continue; }
  const s = shaFile(pf);
  if (s !== r.source_sha256) problems.push(`preservation page sha mismatch: ${r.source_path}`);
  pageSha.set(String(r.source_page), r.source_sha256);
}
// received PDF is a preservation source: verify it exists (kept offline)
if (!existsSync(join(PKG, 'source.pdf'))) problems.push('received source.pdf not present');
const pdfSha = existsSync(join(PKG, 'source.pdf')) ? shaFile(join(PKG, 'source.pdf')) : null;

// map asset_id -> its provenance row (one exact page each)
const provByAsset = new Map(prov.map((r) => [r.asset_id, r]));
for (const a of assets) if (!provByAsset.has(a.asset_id)) problems.push(`${a.asset_id}: no provenance row`);

// ---- reconciliation overlay: compact cross-page exchanges -> one stitched card
const replacement = new Map();   // testimony_id -> replacement asset record
if (RECON) {
  const repl = jsonl(join(RECON, 'replacement_assets.jsonl'));
  for (const r of repl) {
    if (r.asset_type !== 'stitched') problems.push(`reconciliation ${r.asset_id}: asset_type ${r.asset_type}, expected stitched`);
    const f = join(RECON, r.path);
    if (!existsSync(f)) { problems.push(`reconciliation: missing card ${r.path}`); continue; }
    if (shaFile(f) !== r.sha256) problems.push(`reconciliation ${r.asset_id}: sha256 mismatch`);
    if (!Array.isArray(r.contributors) || r.contributors.length < 2)
      problems.push(`reconciliation ${r.asset_id}: a stitched card must record every contributing source portion`);
    // the superseded pair it replaces must be exactly what the base package holds
    for (const c of r.contributors) {
      const prior = assets.find((a) => a.asset_id === c.prior_asset_id);
      if (!prior) problems.push(`reconciliation ${r.asset_id}: superseded asset ${c.prior_asset_id} not in the base package`);
      else if (prior.sha256 !== c.prior_asset_sha256) problems.push(`reconciliation ${r.asset_id}: superseded ${c.prior_asset_id} sha differs from the base package`);
    }
    replacement.set(r.testimony_id, r);
  }
}

if (problems.length) { problems.slice(0, 20).forEach((p) => console.error('  ' + p)); die(`${problems.length} package problem(s); nothing ingested.`); }
if (RECON) console.log(`  reconciliation overlay: ${replacement.size} compact exchange(s) -> one continuous stitched card each (superseded pairs never produced)`);
console.log(`GameSpy "Gary Gygax Interview - Part I" — package verified under schema ${SCHEMA.version}`);
console.log(`  ${testimony.length} units · ${assets.length} crops · ${prov.length} provenance rows · received PDF ${pdfSha.slice(0, 16)}… (offline)`);

// group assets by testimony id, ordered by display_order
const assetsByUnit = new Map();
for (const a of assets) {
  const k = a.testimony_id;
  if (!assetsByUnit.has(k)) assetsByUnit.set(k, []);
  assetsByUnit.get(k).push(a);
}
for (const arr of assetsByUnit.values()) arr.sort((x, y) => x.display_order - y.display_order);

// interpretations we are forced to make (reported at the end)
const interp = [];
const mapCompleteness = (c) => { if (c === 'complete_as_preserved') { interp.push(`completeness "${c}" -> schema 'complete' (complete as preserved)`); return 'complete'; } return (['complete','partial','fragment','unknown'].includes(c) ? c : 'unknown'); };

// ---- ingest -----------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const before = {
  persons: g('SELECT count(*) c FROM persons').c, families: g('SELECT count(*) c FROM source_families').c,
  objects: g('SELECT count(*) c FROM documentary_objects').c, units: g('SELECT count(*) c FROM testimony_units').c,
  context: g('SELECT count(*) c FROM unit_context').c, assets: g('SELECT count(*) c FROM evidence_assets').c,
  sources: g('SELECT count(*) c FROM evidence_sources').c, discovery: g('SELECT count(*) c FROM discovery_text').c,
  coverage: g('SELECT count(*) c FROM coverage').c,
};

db.exec('BEGIN');
const gygax = g(`SELECT id FROM persons WHERE name='Gary Gygax'`);
if (!gygax) { db.exec('ROLLBACK'); die('speaker "Gary Gygax" not found — run the v1 migration first.'); }
let rausch = g(`SELECT id FROM persons WHERE name='Allen Rausch'`);
if (!rausch) rausch = { id: Number(db.prepare(`INSERT INTO persons(name,notes) VALUES ('Allen Rausch','GameSpy interviewer; question-context speaker, not a testimony speaker.')`).run().lastInsertRowid) };
let fam = g(`SELECT id FROM source_families WHERE name='GameSpy'`);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes) VALUES ('GameSpy','interview','Games-journalism site; published interviews preserved as page renderings.')`).run().lastInsertRowid) };

const OBJ_TITLE = 'Gary Gygax Interview - Part I';
let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title=?`, fam.id, OBJ_TITLE);
if (obj && !FORCE) { db.exec('ROLLBACK'); die(`object "${OBJ_TITLE}" already present; use --force to re-ingest a clean DB.`); }
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,date_display,date_from_value,date_precision,venue,citation,identifier,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
  fam.id, OBJ_TITLE, 'interview', '15 August 2004', '2004-08-15', 'day', 'GameSpy',
  'Allen Rausch, "Gary Gygax Interview - Part I", GameSpy, 15 August 2004.',
  'http://pc.gamespy.com/articles/538/538817p1.html',
  'One documentary object = Part I only. Part II (16 Aug 2004) and any later parts are separate objects, series-linked after their own provenance is checked. The 2018 PDF footer timestamp is preservation/render metadata, NOT publication metadata.').lastInsertRowid) };
if (g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c > 0 && !FORCE) { db.exec('ROLLBACK'); die('this object already holds testimony units.'); }

const uidByTid = new Map();
let seq = 0;
for (const rec of testimony) {
  seq++;
  const loc = `printable-view ${rec.source_locator || ''}`.trim();  // preservation locator, NOT a unit number
  const uid = Number(db.prepare(`INSERT INTO testimony_units
    (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
     speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
    VALUES (?,?,NULL,'unknown',?,?,?,NULL,?,NULL,?,?, '', 'untranscribed', ?, 'pdf_text_extraction', ?)`).run(
    obj.id, seq, '15 August 2004', '2004-08-15', 'day', gygax.id,
    rec.evidence_relationship || 'direct', rec.discourse_mode || 'retrospective_commentary',
    mapCompleteness(rec.completeness), loc).lastInsertRowid);
  uidByTid.set(rec.testimony_id, uid);

  // structural interviewer-question context row (Rausch), empty/untranscribed
  db.prepare(`INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status,sequence) VALUES (?,'interviewer_question',?, '', 'untranscribed', 1)`).run(uid, rausch.id);

  // question WORDING -> discovery (unverified, labelled as Rausch's), never transcript/context index
  const qtext = (rec.question_context || '').trim();
  if (qtext) db.prepare(`INSERT INTO discovery_text(object_id,unit_id,segment_label,source_type,source_locator,text) VALUES (?,?,?,'pdf_text_extraction',?,?)`)
    .run(obj.id, uid, 'Part I', `interviewer question — Allen Rausch — ${loc}`, qtext);
  // Gygax answer WORDING -> discovery (unverified); transcript stays empty
  const atext = (rec.discovery_text || '').trim();
  if (atext) db.prepare(`INSERT INTO discovery_text(object_id,unit_id,segment_label,source_type,source_locator,text) VALUES (?,?,?,'pdf_text_extraction',?,?)`)
    .run(obj.id, uid, 'Part I', `Gygax answer — ${loc}`, atext);

  // evidence: ONE continuous stitched card where the compact exchange was split by
  // pagination (reconciliation overlay), otherwise ordered per-unit source-native crops
  const rep = replacement.get(rec.testimony_id);
  if (rep) {
    const assetPath = 'evidence/gamespy/part1/' + basename(rep.path);
    const aid = Number(db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,1,'stitched',?)`)
      .run(uid, assetPath, rep.sha256).lastInsertRowid);
    for (const c of [...rep.contributors].sort((x, y) => x.order - y.order))
      db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,original_sha256,capture_date_precision) VALUES (?,?,'pdf_page',?, 'unknown')`)
        .run(aid, `GameSpy rendered PDF page ${c.source_page} of 9 (stitch order ${c.order}), crop box ${JSON.stringify(c.crop_box_pixels)} on the page render; PDF + renders held offline`, c.source_sha256);
    const dest = join(EVID, assetPath); mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(RECON, rep.path), dest);
    continue;   // the superseded pair is not produced
  }
  for (const a of assetsByUnit.get(rec.testimony_id) || []) {
    const assetPath = 'evidence/gamespy/part1/' + basename(a.path);
    const aid = Number(db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,?,'crop',?)`)
      .run(uid, assetPath, a.display_order, a.sha256).lastInsertRowid);
    const pr = provByAsset.get(a.asset_id);
    db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,original_sha256,capture_date_precision) VALUES (?,?,'pdf_page',?, 'unknown')`)
      .run(aid, `GameSpy rendered PDF page ${a.source_page} of 9 (received preservation PDF held offline)`, pr.source_sha256);
    const dest = join(EVID, assetPath); mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(PKG, a.path), dest);   // stage ONLY the crop; pages+PDF stay offline
  }
}

// coverage: Part I preserved complete
db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,locator_from,locator_to,coverage_status,known_loss,detail,sort_order)
  VALUES (?,?, 'preservation_part', 'PDF page 1 of 9', 'PDF page 9 of 9', 'complete', 0, ?, 1)`).run(
  obj.id, 'Part I', 'Nine rendered pages preserved complete; received PDF and full-page renderings held offline. Part II and later parts are not in this object.');

// related sources: advisory cross-references only. We do NOT auto-create
// testimony_relations: the referenced items are either outside the corpus
// (A&E 1975 letter) or point at ENWorld by "inferred #N", which our ENWorld
// ingestion deliberately left unit_number=NULL/unknown, so no stable target
// unit exists to link to. Preserve them as annotations, unresolved.
for (const r of related) {
  const uid = uidByTid.get(r.testimony_id);
  if (!uid) continue;
  db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'cross_reference', ?)`).run(
    uid, `Advisory (${r.relationship}) -> ${r.related_source}. ${r.note} [Not auto-reconciled: link left unresolved per "links, not reconciliations".]`);
}
// object-level preservation note on unit 1
const u1 = uidByTid.get(testimony[0].testimony_id);
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'preservation', ?)`).run(
  u1, 'Publication date 15 August 2004 (day precision), independently corroborated by later bibliographic citation. The 2018 PDF footer timestamp is preservation/render metadata and is NOT promoted to publication metadata. Interviewer questions are held as unverified discovery text pending manual visual verification; a structural unit_context row records Allen Rausch as the question speaker.');

db.exec('COMMIT');

// ---- reconciliation + FTS behaviour report ---------------------------------
const after = {
  persons: g('SELECT count(*) c FROM persons').c, families: g('SELECT count(*) c FROM source_families').c,
  objects: g('SELECT count(*) c FROM documentary_objects').c, units: g('SELECT count(*) c FROM testimony_units').c,
  context: g('SELECT count(*) c FROM unit_context').c, assets: g('SELECT count(*) c FROM evidence_assets').c,
  sources: g('SELECT count(*) c FROM evidence_sources').c, discovery: g('SELECT count(*) c FROM discovery_text').c,
  coverage: g('SELECT count(*) c FROM coverage').c,
};
const L = []; const P = (s) => { console.log(s); L.push(s); };
const oid = obj.id;
P('\nReconciliation report — GameSpy "Gary Gygax Interview - Part I"');
P(`  documentary objects (this)  : ${g('SELECT count(*) c FROM documentary_objects WHERE id=?', oid).c} (interview)`);
P(`  testimony units             : ${g('SELECT count(*) c FROM testimony_units WHERE object_id=?', oid).c} (expected 28)`);
P(`  unit_context rows           : ${g('SELECT count(*) c FROM unit_context WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?)', oid).c} (interviewer_question, Rausch, structural)`);
const nRep = replacement.size;                       // 0 = base package, 7 = reconciled
const expAssets = 35 - nRep * 2 + nRep;              // each pair (2) becomes one card
const expProv = 35 - nRep * 2 + nRep * 2;            // stitched cards keep both pages
P(`  evidence assets             : ${g('SELECT count(*) c FROM evidence_assets WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?)', oid).c} (expected ${expAssets}${nRep ? ` = ${35 - nRep * 2} crop + ${nRep} stitched` : ''})`);
P(`  ${nRep ? 'continuous stitched cards  ' : 'units with 2 ordered crops '}: ${nRep
    ? g(`SELECT count(*) c FROM evidence_assets WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?) AND asset_type='stitched'`, oid).c
    : g('SELECT count(*) c FROM (SELECT unit_id FROM evidence_assets WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?) GROUP BY unit_id HAVING count(*)=2)', oid).c} (expected ${nRep || 7})`);
P(`  provenance rows             : ${g('SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?))', oid).c} (expected ${expProv})`);
P(`  discovery_text rows         : ${g('SELECT count(*) c FROM discovery_text WHERE object_id=?', oid).c} (expected 56 = 28 answers + 28 questions)`);
P(`  coverage segments           : ${g('SELECT count(*) c FROM coverage WHERE object_id=?', oid).c} (Part I, complete)`);
P(`  before: units ${before.units} ctx ${before.context} assets ${before.assets} disc ${before.discovery}`);
P(`  after : units ${after.units} ctx ${after.context} assets ${after.assets} disc ${after.discovery}`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nConfirmations:');
ok('28 Gygax answer units, all speaker Gary Gygax, evidence_relationship=direct',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND speaker_id=? AND evidence_relationship='direct'`, oid, gygax.id).c === 28);
ok(`${expAssets} evidence assets (${35 - nRep * 2} single-source crops + ${nRep} stitched)`,
   g(`SELECT count(*) c FROM evidence_assets WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?) AND asset_type='crop'`, oid).c === 35 - nRep * 2 &&
   g(`SELECT count(*) c FROM evidence_assets WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?) AND asset_type='stitched'`, oid).c === nRep);
ok('every crop is single-source; every stitched card keeps ordered provenance to both pages',
   g(`SELECT count(*) c FROM (SELECT asset_id FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?) AND asset_type='crop') GROUP BY asset_id HAVING count(*)>1)`, oid).c === 0 &&
   g(`SELECT count(*) c FROM (SELECT asset_id FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?) AND asset_type='stitched') GROUP BY asset_id HAVING count(*)=2)`, oid).c === nRep);
ok('one evidence card per unit where the exchange was reconciled (no superseded pairs)',
   nRep === 0 || g(`SELECT count(*) c FROM (SELECT unit_id FROM evidence_assets WHERE unit_id IN (SELECT id FROM testimony_units WHERE object_id=?) GROUP BY unit_id HAVING count(*)>1)`, oid).c === 0);
ok('all transcripts empty/untranscribed',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND (transcript<>'' OR transcript_status<>'untranscribed')`, oid).c === 0);
ok('interviewer questions attributed to Rausch in unit_context, none to Gygax',
   g(`SELECT count(*) c FROM unit_context WHERE speaker_id=? AND unit_id IN (SELECT id FROM testimony_units WHERE object_id=?)`, rausch.id, oid).c === 28 &&
   g(`SELECT count(*) c FROM unit_context WHERE speaker_id=? AND unit_id IN (SELECT id FROM testimony_units WHERE object_id=?)`, gygax.id, oid).c === 0);
P('\nFTS behaviour:');
// pick a distinctive question word and a distinctive answer word to probe routing
ok('Gygax transcript index (units_fts) has NO GameSpy text (all untranscribed)',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'cigars OR stroke'`).c === 0);
ok('context_fts empty for GameSpy (no verified question wording yet)',
   g(`SELECT count(*) c FROM context_fts JOIN unit_context c ON c.id=context_fts.rowid WHERE c.unit_id IN (SELECT id FROM testimony_units WHERE object_id=?) AND context_fts MATCH 'health OR games'`, oid).c === 0);
ok('interviewer question searchable in discovery_fts (labelled Rausch)',
   g(`SELECT count(*) c FROM discovery_fts JOIN discovery_text d ON d.id=discovery_fts.rowid WHERE d.object_id=? AND d.source_locator LIKE 'interviewer question%' AND discovery_fts MATCH 'health'`, oid).c >= 1);
ok('Gygax answer searchable in discovery_fts (labelled answer)',
   g(`SELECT count(*) c FROM discovery_fts JOIN discovery_text d ON d.id=discovery_fts.rowid WHERE d.object_id=? AND d.source_locator LIKE 'Gygax answer%' AND discovery_fts MATCH 'cigars'`, oid).c >= 1);
P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('units_fts row count in sync with units', g('SELECT count(*) c FROM units_fts').c === after.units);
ok('context_fts row count in sync with unit_context', g('SELECT count(*) c FROM context_fts').c === after.context);
ok('discovery_fts row count in sync with discovery_text', g('SELECT count(*) c FROM discovery_fts').c === after.discovery);

if (interp.length) { P('\nInterpretations the source forced (not mere ingestion):'); for (const i of [...new Set(interp)]) P('  - ' + i); }
P('  - Interviewer question WORDING stored as discovery_text (unverified): the frozen unit_context purity rule forbids non-empty untranscribed context, and the package explicitly does not verify the questions. A structural unit_context row records Rausch as speaker; wording is promoted into it only after manual visual verification.');
P('  - source_locator holds the printable-view page position as a PRESERVATION locator; unit_number left NULL/unknown (interview answers carry no source-native number).');
P('  - related_sources.csv retained as unresolved cross_reference annotations, not testimony_relations (targets are outside the corpus or point at ENWorld by unmapped "inferred #N").');
P('  - 2018 PDF footer timestamp treated as preservation metadata; publication kept at 15 August 2004 (day).');

db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-gamespy-part1.log';
writeFileSync(logPath, ['Gygax corpus v2 — GameSpy "Gary Gygax Interview - Part I" ingestion',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, `received PDF (offline) sha256 : ${pdfSha}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
