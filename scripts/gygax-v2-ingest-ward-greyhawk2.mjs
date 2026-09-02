#!/usr/bin/env node
/*
 * gygax-v2-ingest-ward-greyhawk2.mjs — ingest James M. Ward's "Greyhawk #2"
 * retrospective account as ONE testimony unit under the frozen v2 schema.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-ward-greyhawk2.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * First non-Gygax speaker and first eyewitness_account. The point is separation:
 *   - speaker = James M. Ward, subject = Gary Gygax;
 *   - evidence_relationship = eyewitness_account (evidence ABOUT Gygax, not by him);
 *   - discourse_mode = retrospective_commentary;
 *   - Ward's words go to discovery_text ONLY; transcript stays empty, so his
 *     wording can never enter the Gygax transcript index;
 *   - one unit, TWO ordered evidence assets (display_order 1,2), one per page;
 *   - "Greyhawk #2" is the documentary-object identifier, not a numeric post
 *     number: unit_number NULL / unknown;
 *   - the manifest's "complete_as_preserved" describes the preservation, not a
 *     verified transcription, so completeness stays 'unknown' and the caveat is
 *     recorded as an annotation.
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
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-ward-greyhawk2.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const t = jsonl(join(PKG, 'testimony.jsonl'));
if (t.length !== 1) die(`expected exactly 1 testimony record, found ${t.length}`);
const rec = t[0];
const assets = jsonl(join(PKG, 'evidence_assets.jsonl')).sort((a, b) => a.asset_order - b.asset_order);
console.log(`Ingesting Ward "Greyhawk #2" under schema ${SCHEMA.version}`);
console.log(`  testimony records : ${t.length}  |  evidence assets : ${assets.length}`);

// pre-flight
const problems = [];
if (rec.speaker_display !== 'James M. Ward') problems.push(`unexpected speaker: ${rec.speaker_display}`);
if (rec.subject_person !== 'Gary Gygax') problems.push(`unexpected subject: ${rec.subject_person}`);
if (rec.evidence_relationship !== 'eyewitness_account') problems.push(`unexpected relationship: ${rec.evidence_relationship}`);
for (const a of assets) {
  const f = join(PKG, 'evidence', a.filename);
  if (!existsSync(f)) { problems.push(`missing image: ${a.filename}`); continue; }
  if (sha(readFileSync(f)) !== a.sha256) problems.push(`sha256 mismatch: ${a.filename}`);
}
if (assets.map((a) => a.asset_order).join(',') !== assets.map((_, i) => i + 1).join(','))
  problems.push('asset_order is not a clean 1..N sequence');
if (problems.length) { problems.slice(0, 10).forEach((p) => console.error('  ' + p)); die(`${problems.length} problem(s); nothing ingested.`); }
console.log(`  images present, all SHA-256 matching the manifest`);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const before = { units: g('SELECT count(*) c FROM testimony_units').c, assets: g('SELECT count(*) c FROM evidence_assets').c,
  sources: g('SELECT count(*) c FROM evidence_sources').c, discovery: g('SELECT count(*) c FROM discovery_text').c,
  persons: g('SELECT count(*) c FROM persons').c, objects: g('SELECT count(*) c FROM documentary_objects').c, families: g('SELECT count(*) c FROM source_families').c };

db.exec('BEGIN');
// speaker (new) + subject (existing)
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

const locator = `${rec.original_venue || 'Facebook'} ${rec.canonical_source_locator || ''}; preserved rendering (${assets.length} pages)`.trim();
const uid = Number(db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
   speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
  VALUES (?,1,NULL,'unknown',?,?,?,NULL,?,?,'eyewitness_account','retrospective_commentary','','untranscribed','unknown','pdf_text_extraction',?)`).run(
  obj.id, rec.date_display, rec.date_display, rec.date_precision || 'unknown', ward.id, gygax.id, locator).lastInsertRowid);

// two ordered evidence assets, one provenance row each
let assetCount = 0, srcCount = 0;
for (const a of assets) {
  const assetPath = `evidence/social-media/ward/greyhawk2/${a.filename}`;
  const aid = Number(db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,?,'page',?)`)
    .run(uid, assetPath, a.asset_order, a.sha256).lastInsertRowid);
  db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type) VALUES (?,?,'screenshot')`)
    .run(aid, `${rec.original_venue || 'Facebook'} preserved rendering p.${a.source_page}`);
  assetCount++; srcCount++;
  const dest = join(EVID, assetPath);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(PKG, 'evidence', a.filename), dest);
}

// Ward's words -> discovery only (never transcript)
let discCount = 0;
const text = (rec.discovery_text || '').trim();
if (text) { db.prepare(`INSERT INTO discovery_text(object_id,segment_label,source_type,source_locator,text,unit_id) VALUES (?,?, 'screenshot_ocr',?,?,?)`)
  .run(obj.id, 'Greyhawk #2', locator, text, uid); discCount++; }

// preservation caveat as a research annotation (not a transcription-completeness claim)
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'preservation', ?)`).run(
  uid, `Manifest completeness = "${rec.completeness}": complete as preserved, NOT independently verified against the live post. External record number "${rec.external_record_number}" is the post's own label.`);

db.exec('COMMIT');

// reconciliation + integrity
const after = { units: g('SELECT count(*) c FROM testimony_units').c, assets: g('SELECT count(*) c FROM evidence_assets').c,
  sources: g('SELECT count(*) c FROM evidence_sources').c, discovery: g('SELECT count(*) c FROM discovery_text').c,
  persons: g('SELECT count(*) c FROM persons').c, objects: g('SELECT count(*) c FROM documentary_objects').c, families: g('SELECT count(*) c FROM source_families').c };
const L = []; const P = (s) => { console.log(s); L.push(s); };
P('\nReconciliation report (Ward "Greyhawk #2")');
P(`  testimony units created  : ${after.units - before.units} (expected 1)`);
P(`  evidence assets created  : ${assetCount} (two ordered pages of one unit)`);
P(`  provenance rows created  : ${srcCount}`);
P(`  discovery rows created   : ${discCount}`);
P(`  new persons / families / objects : ${after.persons - before.persons} / ${after.families - before.families} / ${after.objects - before.objects}`);
P(`  speaker James M. Ward, subject Gary Gygax, eyewitness_account, retrospective_commentary`);
P(`  before : units ${before.units}, assets ${before.assets}, discovery ${before.discovery}, persons ${before.persons}, families ${before.families}, objects ${before.objects}`);
P(`  after  : units ${after.units}, assets ${after.assets}, discovery ${after.discovery}, persons ${after.persons}, families ${after.families}, objects ${after.objects}`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nSeparation checks (the point of this source):');
ok('Ward is the speaker, Gygax the subject',
  g(`SELECT count(*) c FROM testimony_units u JOIN persons s ON s.id=u.speaker_id JOIN persons j ON j.id=u.subject_person_id
     WHERE u.id=? AND s.name='James M. Ward' AND j.name='Gary Gygax'`, uid).c === 1);
ok('relationship is eyewitness_account, not direct', g('SELECT evidence_relationship r FROM testimony_units WHERE id=?', uid).r === 'eyewitness_account');
ok('no transcript text stored for Ward', g('SELECT transcript t FROM testimony_units WHERE id=?', uid).t === '');
ok("Ward wording is NOT in the transcript index", g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'mappers OR storyteller OR dungeon'`).c === 0);
ok("Ward wording IS discoverable in discovery text", g(`SELECT count(*) c FROM discovery_fts WHERE discovery_fts MATCH 'mappers'`).c >= 1);
ok('one unit, two ordered evidence assets', g('SELECT count(*) c FROM evidence_assets WHERE unit_id=?', uid).c === 2
   && g('SELECT group_concat(display_order) g FROM evidence_assets WHERE unit_id=?', uid).g === '1,2');
ok('preservation caveat recorded as annotation', g('SELECT count(*) c FROM annotations WHERE unit_id=?', uid).c === 1);
ok('completeness left unknown (no verified transcription)', g('SELECT completeness c FROM testimony_units WHERE id=?', uid).c === 'unknown');
ok('no post number asserted', g('SELECT count(*) c FROM testimony_units WHERE id=? AND unit_number IS NULL AND unit_number_status=\'unknown\'', uid).c === 1);
P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
for (const ft of ['units_fts', 'context_fts', 'discovery_fts']) {
  try { db.exec(`INSERT INTO ${ft}(${ft}) VALUES('integrity-check')`); ok(`${ft} integrity-check`, true); }
  catch (e) { ok(`${ft} integrity-check`, false, e.message); }
}
ok('transcript index in sync with units', g('SELECT count(*) c FROM units_fts').c === after.units);
ok('unit_context still empty', g('SELECT count(*) c FROM unit_context').c === 0);
db.close();

const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-ward-greyhawk2.log';
writeFileSync(logPath, ['Gygax corpus v2 — Ward "Greyhawk #2" ingestion (first non-Gygax speaker)',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`, `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
