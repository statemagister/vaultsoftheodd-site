#!/usr/bin/env node
/*
 * gygax-v2-ingest-cyclopeatron.mjs — ingest the Cyclopeatron compilation
 * ("Gary Gygax's Whitebox OD&D House Rules") under the frozen v2 schema.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-cyclopeatron.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * First test of `direct_quotation_by_intermediary` and the corpus's FIRST
 * verified transcript. A compilation carries several evidentiary layers; exactly
 * ONE is promoted to a Gygax testimony unit:
 *
 *   - VERIFIED testimony unit: the passage the intermediary presents as a direct
 *     quote from Gygax (ENWorld, Sep 2006). evidence_relationship =
 *     direct_quotation_by_intermediary, discourse_mode = commentary,
 *     transcript_status = verified, completeness = fragment (the original ENWorld
 *     post is unrecovered). Its transcript is eyes-on verified against the
 *     page-4 crop and MAY enter units_fts under Gary Gygax.
 *   - Everything else stays discovery_only and never enters Gygax transcript FTS:
 *     Robert Fisher's reported 2005 list, the 2007 forum list, the GenCon XL
 *     lead (all attributed_report), and the blogger's secondary_interpretation.
 *   - The unrecovered Sep-2006 ENWorld primary is recorded as an unresolved
 *     cross_reference annotation, NOT a testimony_relation (no target unit exists).
 *
 * Evidence: one deterministic single-source crop from preserved page 4 — an
 * ordinary crop (asset_type='crop', one source), gate-exempt. The supplied PDF
 * and six page renders are preservation sources, hash-recorded and left OFFLINE.
 *
 * The frozen schema is untouched. Controlled-vocabulary mappings are reported.
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
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-cyclopeatron.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// ---- read + validate the package -------------------------------------------
const objs = jsonl(join(PKG, 'documentary_objects.jsonl'));
const units = jsonl(join(PKG, 'testimony.jsonl'));
const assets = jsonl(join(PKG, 'evidence_assets.jsonl'));
const prov = jsonl(join(PKG, 'provenance_rows.jsonl'));
const cover = jsonl(join(PKG, 'coverage_segments.jsonl'));
const disc = jsonl(join(PKG, 'discovery_records.jsonl'));
const related = jsonl(join(PKG, 'related_sources.jsonl'));

const problems = [];
if (objs.length !== 1) problems.push(`expected 1 documentary object, found ${objs.length}`);
if (units.length !== 1) problems.push(`expected 1 testimony unit, found ${units.length}`);
if (assets.length !== 1) problems.push(`expected 1 evidence asset, found ${assets.length}`);
if (prov.length !== 1) problems.push(`expected 1 provenance row, found ${prov.length}`);
if (cover.length !== 1) problems.push(`expected 1 coverage segment, found ${cover.length}`);
if (disc.length !== 4) problems.push(`expected 4 discovery records, found ${disc.length}`);
if (related.length !== 1) problems.push(`expected 1 related source, found ${related.length}`);

const u = units[0], a = assets[0], pr = prov[0];
if (a.asset_type !== 'crop') problems.push(`asset_type is "${a.asset_type}", expected crop`);
if (String(a.source_count) !== '1') problems.push(`asset source_count is ${a.source_count}, expected 1 (must stay gate-exempt)`);
if (u.evidence_relationship !== 'direct_quotation_by_intermediary') problems.push(`unexpected evidence_relationship: ${u.evidence_relationship}`);
if (u.transcript_status !== 'verified') problems.push(`unexpected transcript_status: ${u.transcript_status}`);
if (!(u.transcript || '').trim()) problems.push('verified unit has empty transcript');

// crop file present + hash-verified
const cropFile = join(PKG, a.path);
if (!existsSync(cropFile)) problems.push(`missing crop file: ${a.path}`);
else if (shaFile(cropFile) !== pr.asset_sha256) problems.push(`crop sha256 != provenance asset_sha256`);
// preservation sources present + hash-verified, then left OFFLINE
const pdf = join(PKG, pr.source_pdf), pageRender = join(PKG, pr.source_page_render);
if (!existsSync(pdf)) problems.push(`preservation PDF missing: ${pr.source_pdf}`);
else if (shaFile(pdf) !== pr.source_pdf_sha256) problems.push('preservation PDF sha256 mismatch');
if (!existsSync(pageRender)) problems.push(`preserved page render missing: ${pr.source_page_render}`);
else if (shaFile(pageRender) !== pr.source_page_sha256) problems.push('preserved page render sha256 mismatch');

if (problems.length) { problems.slice(0, 20).forEach((p) => console.error('  ' + p)); die(`${problems.length} package problem(s); nothing ingested.`); }

// EYES-ON verification of the verified transcript is a human step, recorded here.
// The transcript below was compared character-for-character to the page-4 crop
// (attribution framing excluded; only the quoted passage promoted).
console.log(`Cyclopeatron — package verified under schema ${SCHEMA.version}`);
console.log(`  1 verified Gygax quotation (direct_quotation_by_intermediary), 1 crop (gate-exempt), 4 discovery layers`);
console.log(`  transcript (verified against page-4 crop): "${u.transcript.slice(0, 70)}…"`);

// controlled-vocabulary mappings (reported; not schema changes)
const interp = [];
const OBJ_TYPES = ['forum_thread','interview','letter','article','column','compilation','questionnaire','other'];
let objType = objs[0].object_type;
if (!OBJ_TYPES.includes(objType)) { const m = objType === 'article_compilation' ? 'compilation' : 'other'; interp.push(`object_type "${objType}" -> '${m}' (not in schema vocabulary)`); objType = m; }
const DISC_TYPES = ['pdf_text_extraction','screenshot_ocr','compilation_quotation','other'];
const discType = (rel) => rel === 'secondary_interpretation' ? 'other' : 'compilation_quotation';

// ---- ingest -----------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const before = { objects: g('SELECT count(*) c FROM documentary_objects').c, units: g('SELECT count(*) c FROM testimony_units').c,
  assets: g('SELECT count(*) c FROM evidence_assets').c, sources: g('SELECT count(*) c FROM evidence_sources').c,
  discovery: g('SELECT count(*) c FROM discovery_text').c, coverage: g('SELECT count(*) c FROM coverage').c,
  annotations: g('SELECT count(*) c FROM annotations').c, families: g('SELECT count(*) c FROM source_families').c };

db.exec('BEGIN');
const gygax = g(`SELECT id FROM persons WHERE name='Gary Gygax'`);
if (!gygax) { db.exec('ROLLBACK'); die('speaker "Gary Gygax" not found — run the v1 migration first.'); }
let fam = g(`SELECT id FROM source_families WHERE name='Cyclopeatron'`);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes) VALUES ('Cyclopeatron','compilation','Blog compilation of Gygax OD&D house-rule material; layered evidentiary content.')`).run().lastInsertRowid) };

const oRec = objs[0];
let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title=?`, fam.id, oRec.title);
if (obj && !FORCE) { db.exec('ROLLBACK'); die(`object "${oRec.title}" already present; use --force on a clean DB.`); }
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,date_display,date_precision,venue,citation,identifier,notes) VALUES (?,?,?,?,?,?,?,?,?)`).run(
  fam.id, oRec.title, objType, null, 'unknown', 'Cyclopeatron (blog)',
  `${oRec.author_or_compiler}, "${oRec.title}", Cyclopeatron.`, oRec.canonical_url,
  'Compilation/discovery object. The 27/11/2017 footer is a preservation/print timestamp, not a publication date. Only the intermediary-quoted Gygax passage is promoted to verified testimony.').lastInsertRowid) };

// the single VERIFIED Gygax testimony unit
const dateValue = /september 2006/i.test(u.date_display) ? '2006-09' : null;
const uid = Number(db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
   speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
  VALUES (?,?,NULL,'unknown',?,?,?,NULL,?,?, 'direct_quotation_by_intermediary','commentary', ?, 'verified','fragment','compilation_quotation',?)`).run(
  obj.id, Number(u.sequence_in_object) || 1, u.date_display, dateValue, u.date_precision || 'month',
  gygax.id, gygax.id, u.transcript.trim(), u.source_locator).lastInsertRowid);

// canonical evidence: single-source crop from preserved page 4 (gate-exempt)
const assetPath = 'evidence/cyclopeatron/' + basename(a.path);
const aid = Number(db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,?, 'crop', ?)`)
  .run(uid, assetPath, Number(a.display_order) || 1, pr.asset_sha256).lastInsertRowid);
// one provenance row: the crop's immediate parent (200-dpi page-4 render), with
// the full PDF->render->crop chain and BOTH offline hashes recorded in the locator.
db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,original_sha256,capture_date_precision) VALUES (?,?,'pdf_page',?, 'unknown')`)
  .run(aid, `Cyclopeatron preserved PDF "${basename(pr.source_pdf)}" p.${pr.source_page} (PDF sha ${pr.source_pdf_sha256.slice(0,16)}…); 200-dpi page-4 render (crop box ${pr.crop_box_px_on_200dpi_render}); PDF and render held offline`, pr.source_page_sha256);
// stage ONLY the crop; PDF + page renders stay offline
const dest = join(EVID, assetPath); mkdirSync(dirname(dest), { recursive: true });
copyFileSync(cropFile, dest);

// coverage: whole article preserved complete
const c = cover[0];
db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,locator_from,locator_to,coverage_status,known_loss,detail,sort_order)
  VALUES (?,?, 'page_range', 'p.1', 'p.6', 'complete', 0, ?, 1)`).run(obj.id, c.segment_label, c.notes || 'Complete as preserved in the supplied six-page PDF.');

// four discovery-only layers — object-scoped (unit_id NULL), never Gygax transcript
for (const d of disc) {
  db.prepare(`INSERT INTO discovery_text(object_id,unit_id,segment_label,source_type,source_locator,text) VALUES (?,NULL,?,?,?,?)`).run(
    obj.id, `${d.relationship} — ${d.speaker_or_source}`, discType(d.relationship),
    `${d.locator} — ${d.speaker_or_source} (${d.relationship}); ${d.promotion_rule}`, d.summary);
}

// unrecovered ENWorld primary: unresolved cross_reference annotation (no testimony_relation)
const rel = related[0];
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'cross_reference', ?)`).run(
  uid, `Unresolved lead -> ${rel.target_description} (${rel.target_status}). ${rel.notes} No testimony_relation asserted: the primary target is not in the corpus.`);
// record the eyes-on transcript verification
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'verification', ?)`).run(
  uid, 'Transcript diplomatically verified against the preserved page-4 crop (attribution framing excluded; only the quoted passage promoted). Reaches us via the Cyclopeatron intermediary quoting an unrecovered ENWorld Sep-2006 post; hence direct_quotation_by_intermediary and completeness=fragment.');

db.exec('COMMIT');

// ---- reconciliation + FTS behaviour ----------------------------------------
const after = { objects: g('SELECT count(*) c FROM documentary_objects').c, units: g('SELECT count(*) c FROM testimony_units').c,
  assets: g('SELECT count(*) c FROM evidence_assets').c, sources: g('SELECT count(*) c FROM evidence_sources').c,
  discovery: g('SELECT count(*) c FROM discovery_text').c, coverage: g('SELECT count(*) c FROM coverage').c,
  annotations: g('SELECT count(*) c FROM annotations').c };
const L = []; const P = (s) => { console.log(s); L.push(s); };
P('\nReconciliation report — Cyclopeatron');
P(`  documentary object       : +${after.objects - before.objects} (expected 1, ${objType})`);
P(`  testimony units          : +${after.units - before.units} (expected 1, verified)`);
P(`  evidence assets          : +${after.assets - before.assets} (expected 1, crop)`);
P(`  provenance rows          : +${after.sources - before.sources} (expected 1)`);
P(`  coverage segments        : +${after.coverage - before.coverage} (expected 1)`);
P(`  discovery records        : +${after.discovery - before.discovery} (expected 4)`);
P(`  annotations              : +${after.annotations - before.annotations} (cross_reference + verification)`);

let fails = 0;
const ok = (n, cond, x = '') => { const l = `  [${cond ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!cond) fails++; };
P('\nConfirmations:');
ok('added exactly 1 object / 1 unit / 1 asset / 1 provenance / 1 coverage / 4 discovery',
   after.objects - before.objects === 1 && after.units - before.units === 1 && after.assets - before.assets === 1 &&
   after.sources - before.sources === 1 && after.coverage - before.coverage === 1 && after.discovery - before.discovery === 4);
ok('unit is verified, speaker Gygax, direct_quotation_by_intermediary, fragment, commentary',
   g(`SELECT count(*) c FROM testimony_units WHERE id=? AND speaker_id=? AND transcript_status='verified'
      AND evidence_relationship='direct_quotation_by_intermediary' AND completeness='fragment' AND discourse_mode='commentary'`, uid, gygax.id).c === 1);
ok('crop is gate-exempt (asset_type=crop, single source)',
   g(`SELECT count(*) c FROM evidence_assets WHERE id=? AND asset_type='crop'`, aid).c === 1 &&
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id=?`, aid).c === 1);
P('\nFTS behaviour:');
ok('verified quotation IS in Gygax transcript FTS (units_fts)',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'clerics' AND rowid=?`, uid).c >= 1);
ok('the four discovery layers are NOT in Gygax transcript FTS',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'Fisher OR GenCon OR mortality'`).c === 0);
ok('discovery layers ARE searchable in discovery_fts',
   g(`SELECT count(*) c FROM discovery_fts JOIN discovery_text d ON d.id=discovery_fts.rowid WHERE d.object_id=? AND discovery_fts MATCH 'Fisher OR GenCon'`, obj.id).c >= 1);
ok('evidence_relationship is queryable/visible for the unit',
   g(`SELECT evidence_relationship r FROM testimony_units WHERE id=?`, uid).r === 'direct_quotation_by_intermediary');
ok('no testimony_relation created (unrecovered primary)', g('SELECT count(*) c FROM testimony_relations').c === 0);
P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('units_fts in sync with units', g('SELECT count(*) c FROM units_fts').c === after.units);
ok('discovery_fts in sync with discovery_text', g('SELECT count(*) c FROM discovery_fts').c === after.discovery);

if (interp.length) { P('\nControlled-vocabulary mappings (interpretations, not schema changes):'); for (const i of interp) P('  - ' + i); }
P('  - discovery source_type: attributed_report layers -> compilation_quotation; blogger interpretation -> other.');
P('  - provenance original_sha256 = 200-dpi page-4 render (direct crop parent); PDF sha + crop box recorded in the locator; PDF and renders held offline.');
P('  - related_sources -> unresolved cross_reference annotation (target ENWorld Sep-2006 post not in corpus); no testimony_relation.');
P('  - package field record_type="quoted_testimony" has no schema column and is not stored.');
P('  - 2017 footer treated as preservation timestamp; unit dated September 2006 (month); object publication date left unknown.');

db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-cyclopeatron.log';
writeFileSync(logPath, ['Gygax corpus v2 — Cyclopeatron ingestion (first direct_quotation_by_intermediary; first verified transcript)',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`, `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
