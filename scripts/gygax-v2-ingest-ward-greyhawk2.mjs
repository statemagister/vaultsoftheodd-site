#!/usr/bin/env node
/*
 * gygax-v2-ingest-ward-greyhawk2.mjs — ingest James M. Ward's "Greyhawk #2"
 * retrospective account as ONE testimony unit under the frozen v2 schema.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-ward-greyhawk2.mjs \
 *        <v2.sqlite> <corrected-package-dir> <evidence-staging-dir> [--force]
 *
 * CORRECTED evidence representation. An earlier package split this single
 * Facebook post into two evidence assets because the received PDF paginated it
 * across two pages. That split is a preservation artefact, not historical
 * structure. The canonical representation is now:
 *
 *   1 testimony unit  ->  1 continuous canonical evidence asset
 *                     ->  provenance to BOTH pages of the unchanged received PDF.
 *
 * Because the whole corpus is regenerated from this pipeline, running this
 * corrected ingester IS the replacement: the superseded two-asset form is
 * simply never produced. No manual edit of the derived database is involved.
 *
 * The received PDF stays OFFLINE (recorded by hash + locator, never deployed).
 * Only the continuous canonical PNG is staged for encryption. Ward's words go to
 * discovery_text only; transcript stays empty; speaker = James M. Ward, subject
 * = Gary Gygax, evidence_relationship = eyewitness_account.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { assertSchemaFrozen } from './gygax-v2-lock.mjs';

const SCHEMA = assertSchemaFrozen();
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const [DB_PATH, PKG, EVID] = args.filter((a) => !a.startsWith('--'));
if (!DB_PATH || !PKG || !EVID) {
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-ward-greyhawk2.mjs <v2.sqlite> <corrected-package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// hashes of the SUPERSEDED two-page assets from the earlier package; these must
// never appear in the corpus again.
const SUPERSEDED_SHAS = new Set([
  '085e2e81525eccd6eff2f83b8b5bc49100f24e2a047664bf728d102d51a3153e',
  '41722281d30d4132cdbba40ee1ec045bd66fce8353eeabe2e3b59d0948e770d9',
]);

const t = jsonl(join(PKG, 'testimony.jsonl'));
if (t.length !== 1) die(`expected exactly 1 testimony record, found ${t.length}`);
const rec = t[0];
const assets = jsonl(join(PKG, 'evidence_assets.jsonl'));
if (assets.length !== 1) die(`corrected package must contain exactly 1 canonical evidence asset, found ${assets.length}`);
const asset = assets[0];
const pages = asset.source_pages || (asset.source_page ? [asset.source_page] : []);
if (pages.length < 1) die('canonical asset declares no source pages');
console.log(`Ingesting CORRECTED Ward "Greyhawk #2" under schema ${SCHEMA.version}`);
console.log(`  1 canonical asset "${asset.filename}" <- received PDF pages ${pages.join(',')}`);

// pre-flight: hashes of the canonical card AND the received preservation PDF
const problems = [];
if (rec.speaker_display !== 'James M. Ward') problems.push(`unexpected speaker: ${rec.speaker_display}`);
if (rec.subject_person !== 'Gary Gygax') problems.push(`unexpected subject: ${rec.subject_person}`);
if (rec.evidence_relationship !== 'eyewitness_account') problems.push(`unexpected relationship: ${rec.evidence_relationship}`);
if (SUPERSEDED_SHAS.has(asset.sha256)) problems.push('canonical asset hash equals a superseded two-page asset');
const cardFile = join(PKG, 'evidence', asset.filename);
if (!existsSync(cardFile)) problems.push(`missing canonical card: ${asset.filename}`);
else if (sha(readFileSync(cardFile)) !== asset.sha256) problems.push('canonical card sha256 mismatch');
// received PDF: verified for provenance, then left offline
const pdfMatch = readFileSync(join(PKG, 'PROVENANCE.md'), 'utf8').match(/received[^`]*`([^`]+\.pdf)`[^`]*`([0-9a-f]{64})`/i);
if (!pdfMatch) problems.push('PROVENANCE.md does not declare the received PDF and its hash');
let pdfRel, pdfSha;
if (pdfMatch) {
  pdfRel = pdfMatch[1]; pdfSha = pdfMatch[2];
  const pdfPath = join(PKG, pdfRel);
  if (!existsSync(pdfPath)) problems.push(`received PDF not present: ${pdfRel}`);
  else if (sha(readFileSync(pdfPath)) !== pdfSha) problems.push('received PDF sha256 does not match PROVENANCE.md');
}
if (problems.length) { problems.slice(0, 10).forEach((p) => console.error('  ' + p)); die(`${problems.length} problem(s); nothing ingested.`); }
console.log(`  canonical card + received PDF present, both SHA-256 verified`);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const before = { units: g('SELECT count(*) c FROM testimony_units').c, assets: g('SELECT count(*) c FROM evidence_assets').c,
  sources: g('SELECT count(*) c FROM evidence_sources').c, discovery: g('SELECT count(*) c FROM discovery_text').c,
  persons: g('SELECT count(*) c FROM persons').c, objects: g('SELECT count(*) c FROM documentary_objects').c, families: g('SELECT count(*) c FROM source_families').c };

db.exec('BEGIN');
let ward = g(`SELECT id FROM persons WHERE name='James M. Ward'`);
if (!ward) ward = { id: Number(db.prepare(`INSERT INTO persons(name) VALUES ('James M. Ward')`).run().lastInsertRowid) };
const gygax = g(`SELECT id FROM persons WHERE name='Gary Gygax'`);
if (!gygax) die('subject person "Gary Gygax" not found — run the v1 migration first.');
let fam = g(`SELECT id FROM source_families WHERE name='Social media'`);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes)
  VALUES ('Social media','other','Public social-media posts preserved as page renderings.')`).run().lastInsertRowid) };
let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title='Greyhawk #2'`, fam.id);
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,venue,identifier,date_display,date_from_value,date_precision,notes) VALUES (?,?,?,?,?,?,?,?,?)`).run(
  fam.id, 'Greyhawk #2', 'other', rec.original_venue || 'Facebook', rec.canonical_source_locator || null,
  rec.date_display, rec.date_display, rec.date_precision || 'unknown',
  'A single retrospective post by James M. Ward about gaming with Gary Gygax. "Greyhawk #2" is the post\'s own label, not a within-object number.').lastInsertRowid) };
if (g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c > 0 && !FORCE) {
  db.exec('ROLLBACK'); die('this object already holds testimony units.');
}

const locator = `${rec.original_venue || 'Facebook'} ${rec.canonical_source_locator || ''}; one continuous canonical card reconstructed from received PDF pages ${pages.join('-')}`.trim();
const uid = Number(db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
   speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
  VALUES (?,1,NULL,'unknown',?,?,?,NULL,?,?,'eyewitness_account','retrospective_commentary','','untranscribed','unknown','pdf_text_extraction',?)`).run(
  obj.id, rec.date_display, rec.date_display, rec.date_precision || 'unknown', ward.id, gygax.id, locator).lastInsertRowid);

// ONE continuous canonical evidence asset (stitched from the two PDF pages).
const assetPath = 'evidence/social-media/ward/greyhawk2/' + asset.filename;
const aid = Number(db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,1,'stitched',?)`)
  .run(uid, assetPath, asset.sha256).lastInsertRowid);
// provenance: BOTH pages of the unchanged received PDF (offline), with its hash.
for (const pg of pages)
  db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,original_sha256) VALUES (?,?,'pdf_page',?)`)
    .run(aid, `${pdfRel} p.${pg} (received preservation PDF, held offline)`, pdfSha);
// stage ONLY the canonical PNG for encryption; the received PDF stays offline.
const dest = join(EVID, assetPath); mkdirSync(dirname(dest), { recursive: true });
copyFileSync(cardFile, dest);

// Ward's words -> discovery only
const text = (rec.discovery_text || '').trim();
if (text) db.prepare(`INSERT INTO discovery_text(object_id,segment_label,source_type,source_locator,text,unit_id) VALUES (?, 'Greyhawk #2','screenshot_ocr',?,?,?)`)
  .run(obj.id, locator, text, uid);
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'preservation', ?)`).run(
  uid, `Manifest completeness = "${rec.completeness}": complete as preserved, NOT independently verified against the live post. The received PDF paginates the post across ${pages.length} pages; that pagination is a preservation artefact and the canonical evidence is one continuous card traced to both pages. External record number "${rec.external_record_number}" is the post's own label.`);
db.exec('COMMIT');

// reconciliation + the specific confirmations requested
const after = { units: g('SELECT count(*) c FROM testimony_units').c, assets: g('SELECT count(*) c FROM evidence_assets').c,
  sources: g('SELECT count(*) c FROM evidence_sources').c };
const L = []; const P = (s) => { console.log(s); L.push(s); };
P('\nReconciliation report (Ward "Greyhawk #2" — corrected)');
P(`  testimony units for this object : ${g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c} (expected 1)`);
P(`  canonical evidence assets       : ${g('SELECT count(*) c FROM evidence_assets WHERE unit_id=?', uid).c} (expected 1, continuous)`);
P(`  provenance rows                 : ${g('SELECT count(*) c FROM evidence_sources WHERE asset_id=?', aid).c} (expected ${pages.length}, both received-PDF pages)`);
P(`  received PDF                     : recorded by hash ${pdfSha.slice(0, 16)}…, held offline (not staged, not deployed)`);
P(`  before : units ${before.units}, assets ${before.assets}, sources ${before.sources}`);
P(`  after  : units ${after.units}, assets ${after.assets}, sources ${after.sources}`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nConfirmations requested:');
ok('exactly one Ward "Greyhawk #2" testimony unit', g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c === 1);
ok('exactly one canonical evidence asset for it', g('SELECT count(*) c FROM evidence_assets WHERE unit_id=?', uid).c === 1);
ok('the two superseded derived assets are absent (by hash)',
   g(`SELECT count(*) c FROM evidence_assets WHERE sha256 IN ('${[...SUPERSEDED_SHAS].join("','")}')`).c === 0);
ok('no legacy _p01/_p02 asset paths remain',
   g(`SELECT count(*) c FROM evidence_assets WHERE asset_path LIKE '%_p01.%' OR asset_path LIKE '%_p02.%'`).c === 0);
ok('single asset traces to both PDF pages', g('SELECT count(*) c FROM evidence_sources WHERE asset_id=?', aid).c === pages.length);
ok('identity preserved: speaker Ward, subject Gygax, eyewitness_account',
   g(`SELECT count(*) c FROM testimony_units u JOIN persons s ON s.id=u.speaker_id JOIN persons j ON j.id=u.subject_person_id
      WHERE u.id=? AND s.name='James M. Ward' AND j.name='Gary Gygax' AND u.evidence_relationship='eyewitness_account' AND u.discourse_mode='retrospective_commentary'`, uid).c === 1);
ok('no transcript text for Ward', g('SELECT transcript t FROM testimony_units WHERE id=?', uid).t === '');
ok('Ward wording NOT in transcript index', g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'mappers OR storyteller'`).c === 0);
ok('Ward wording still discoverable in discovery text', g(`SELECT count(*) c FROM discovery_fts WHERE discovery_fts MATCH 'mappers'`).c >= 1);
P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('transcript index in sync with units', g('SELECT count(*) c FROM units_fts').c === after.units);
db.close();

const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-ward-greyhawk2.log';
writeFileSync(logPath, ['Gygax corpus v2 — Ward "Greyhawk #2" CORRECTED ingestion (one continuous canonical asset)',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`, `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
