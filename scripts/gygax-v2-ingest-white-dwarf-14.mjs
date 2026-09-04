#!/usr/bin/env node
/*
 * gygax-v2-ingest-white-dwarf-14.mjs — ingest "White Dwarf Interviews Gary Gygax"
 * (White Dwarf #14, August/September 1979, interviewer Ian Livingstone).
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-white-dwarf-14.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--page-map <json>] [--force]
 *
 * Two firsts for the corpus:
 *
 *   1. The first VERIFIED, non-empty unit_context. Every earlier interview stored
 *      the interviewer's question as unverified discovery with a structural, empty
 *      context row, because unit_context may hold verified text only. Here the 19
 *      questions were manually collated against the page images, so they are stored
 *      as verified context text — which makes context_fts genuinely searchable for
 *      the first time. The §8 guarantee is therefore now testable with real text:
 *      Livingstone's wording must reach context_fts and NEVER units_fts.
 *   2. The first source whose ordinary CROPS were caught defective before ingestion.
 *      Four cards sliced the first glyph of every line and one clipped its final
 *      line; ordinary crops are reconstruction-gate-exempt, so no automated control
 *      would have caught it. Corrected upstream and re-verified before this ran.
 *
 * 19 Q&A exchanges = 19 testimony units, each card preserving question and answer
 * together. 16 ordinary crops + 3 stitched cards where a compact exchange crosses a
 * printed COLUMN boundary within the same page (q03 p23 c1->c2; q14 p24 c1->c2;
 * q15 p24 c2->c3). The stitches are content-affecting reconstructions and must pass
 * the eyes-on acceptance gate before any build.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { assertSchemaFrozen } from './gygax-v2-lock.mjs';

const SCHEMA = assertSchemaFrozen();
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const PAGEMAP = (() => { const i = args.indexOf('--page-map'); return (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : null; })();
const [DB_PATH, PKG, EVID] = args.filter((a) => !a.startsWith('--') && a !== PAGEMAP);
if (!DB_PATH || !PKG || !EVID) {
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-white-dwarf-14.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--page-map <json>] [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));

const man = JSON.parse(readFileSync(join(PKG, 'manifest.json'), 'utf8'));
const dobj = man.documentary_object;
const units = man.testimony_units;
const sum = man.evidence_summary;
// per-asset source page: the manifest does not carry it, so it is supplied by a map
// derived from exact pixel-row matching against the two preserved page images.
const pageMap = PAGEMAP ? JSON.parse(readFileSync(PAGEMAP, 'utf8')) : {};

// ---- validate ---------------------------------------------------------------
const problems = [];
if (units.length !== sum.unit_count) problems.push(`unit_count ${sum.unit_count} != units ${units.length}`);
let nCrop = 0, nStitch = 0;
for (const u of units) {
  if (u.transcript_status !== 'verified') problems.push(`${u.unit_key}: transcript_status ${u.transcript_status}`);
  if (!(u.transcript || '').trim()) problems.push(`${u.unit_key}: verified unit with empty transcript`);
  const c = u.context || {};
  if (c.context_type !== 'interviewer_question') problems.push(`${u.unit_key}: context_type ${c.context_type}`);
  if (c.transcript_status !== 'verified') problems.push(`${u.unit_key}: context not verified`);
  if (!(c.text || '').trim()) problems.push(`${u.unit_key}: verified context with empty text`);
  if (u.evidence_assets.length !== 1) problems.push(`${u.unit_key}: expected 1 card, found ${u.evidence_assets.length}`);
  for (const a of u.evidence_assets) {
    const f = join(PKG, a.file);
    if (!existsSync(f)) { problems.push(`missing card ${a.file}`); continue; }
    a.reconstructed ? nStitch++ : nCrop++;
    if (a.reconstructed && a.representation !== 'stitched_cross_column') problems.push(`${a.file}: reconstructed but representation ${a.representation}`);
    if (!a.reconstructed && a.representation !== 'single_source_crop') problems.push(`${a.file}: representation ${a.representation}`);
    if (PAGEMAP && !pageMap[basename(a.file)]) problems.push(`${a.file}: no source page in the page map`);
  }
}
if (nCrop !== sum.single_source_crops) problems.push(`crops ${nCrop} != declared ${sum.single_source_crops}`);
if (nStitch !== sum.stitched_cross_column_assets) problems.push(`stitched ${nStitch} != declared ${sum.stitched_cross_column_assets}`);
// every file must match the package's own checksums
const sums = new Map(readFileSync(join(PKG, 'SHA256SUMS.txt'), 'utf8').split('\n').filter((l) => l.trim())
  .map((l) => { const m = l.trim().split(/\s+/); return [m[1].replace(/^\*/, ''), m[0]]; }));
for (const [f, h] of sums) {
  const p = join(PKG, f);
  if (!existsSync(p)) { problems.push(`SHA256SUMS lists a missing file: ${f}`); continue; }
  if (shaFile(p) !== h) problems.push(`checksum mismatch: ${f}`);
}
for (const n of [23, 24]) if (!existsSync(join(PKG, `white_dwarf14_page${n}.jpeg`))) problems.push(`missing preserved page ${n}`);
if (problems.length) { problems.slice(0, 15).forEach((p) => console.error('  ' + p)); die(`${problems.length} package problem(s); nothing ingested.`); }
console.log(`White Dwarf #14 interview — package verified under schema ${SCHEMA.version}`);
console.log(`  ${sums.size} files checksum-verified · ${units.length} units · ${nCrop} crops + ${nStitch} stitched · 19 verified transcripts + 19 verified contexts`);

// ---- ingest -----------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const B = (t) => g(`SELECT count(*) c FROM ${t}`).c;
const before = { objects: B('documentary_objects'), units: B('testimony_units'), context: B('unit_context'),
  assets: B('evidence_assets'), sources: B('evidence_sources'), coverage: B('coverage'), persons: B('persons'),
  verified: g(`SELECT count(*) c FROM testimony_units WHERE transcript_status='verified'`).c,
  vctx: g(`SELECT count(*) c FROM unit_context WHERE text_status='verified'`).c };

db.exec('BEGIN');
const gygax = g(`SELECT id FROM persons WHERE name='Gary Gygax' AND identity_scope IS NULL`);
if (!gygax) { db.exec('ROLLBACK'); die('speaker "Gary Gygax" not found — run the v1 migration first.'); }
// Ian Livingstone is a NAMED individual, not a pseudonymous handle: global identity
// (identity_scope NULL), per the v2.1 scoped-identity rule.
const IVNAME = dobj.interviewer;
let iv = g(`SELECT id FROM persons WHERE name=? AND identity_scope IS NULL`, IVNAME);
if (!iv) iv = { id: Number(db.prepare(`INSERT INTO persons(name,identity_scope,notes) VALUES (?,NULL,?)`)
  .run(IVNAME, 'Named individual: interviewer for White Dwarf. Globally identified, not a source-scoped handle.').lastInsertRowid) };
let fam = g(`SELECT id FROM source_families WHERE name='White Dwarf'`);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes) VALUES ('White Dwarf','periodical','British games magazine; published interviews preserved as page images.')`).run().lastInsertRowid) };

const TITLE = dobj.title;
let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title=?`, fam.id, TITLE);
if (obj && !FORCE) { db.exec('ROLLBACK'); die(`object "${TITLE}" already present; use --force on a clean DB.`); }
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,date_display,date_from_value,date_precision,venue,citation,identifier,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
  fam.id, TITLE, 'interview', dobj.date_display, '1979-08', 'month', 'White Dwarf',
  `Ian Livingstone, "${TITLE}", White Dwarf #${dobj.issue}, August/September 1979, pp.${dobj.pages}.`,
  `issue ${dobj.issue}, pp.${dobj.pages}`,
  `The interview is complete across pp.${dobj.pages}. ${dobj.preservation_note} Only these two pages are preserved, so unrelated material elsewhere in the issue is not held.`).lastInsertRowid) };
if (g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c > 0 && !FORCE) { db.exec('ROLLBACK'); die('this object already holds testimony units.'); }

const stitched = [];
for (const u of [...units].sort((a, b) => a.sequence_in_object - b.sequence_in_object)) {
  const uid = Number(db.prepare(`INSERT INTO testimony_units
    (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
     speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
    VALUES (?,?,NULL,'unknown',?,?,'month',NULL,?,?, ?, ?, ?, 'verified', ?, 'other', ?)`).run(
    obj.id, u.sequence_in_object, dobj.date_display, '1979-08', gygax.id, gygax.id,
    u.relationship, u.discourse_mode, u.transcript.trim(), u.completeness,
    `White Dwarf #${dobj.issue} (Aug/Sep 1979) pp.${dobj.pages}, exchange ${u.sequence_in_object} of ${units.length}`).lastInsertRowid);

  // VERIFIED interviewer question — the first non-empty unit_context in the corpus.
  db.prepare(`INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status,sequence)
    VALUES (?,'interviewer_question',?,?, 'verified', 1)`).run(uid, iv.id, u.context.text.trim());

  for (const a of u.evidence_assets) {
    const page = pageMap[basename(a.file)] || null;
    const assetPath = 'evidence/white-dwarf/14/' + basename(a.file);
    const h = shaFile(join(PKG, a.file));
    const type = a.reconstructed ? 'stitched' : 'crop';
    const aid = Number(db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,?,?,?)`)
      .run(uid, assetPath, a.sequence, type, h).lastInsertRowid);
    const where = page ? `p.${page}` : `pp.${dobj.pages}`;
    if (a.reconstructed) {
      // cross-column stitch: two ordered portions from the SAME preserved page
      for (const col of [1, 2]) db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,capture_date_precision) VALUES (?,?,'scan','unknown')`)
        .run(aid, `White Dwarf #${dobj.issue} ${where}, printed column portion ${col} of 2 (stitch order ${col}) — compact exchange interrupted by the column boundary`);
    } else {
      db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,capture_date_precision) VALUES (?,?,'scan','unknown')`)
        .run(aid, `White Dwarf #${dobj.issue} ${where} — source-native crop of one printed column region`);
    }
    const dest = join(EVID, assetPath); mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(PKG, a.file), dest);
    if (a.reconstructed) stitched.push({ unit: u.unit_key, assetPath, sha: h, page });
  }
}

db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,locator_from,locator_to,coverage_status,known_loss,detail,sort_order)
  VALUES (?, 'Interview (pp.23-24)','page_range','p.23','p.24','complete',0, ?, 1)`).run(obj.id,
  'The interview is preserved complete across both printed pages: it opens on p.23 with "WHITE DWARF INTERVIEWS GARY GYGAX" and closes on p.24 with the question about visiting the UK.');
db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,coverage_status,known_loss,detail,sort_order)
  VALUES (?, 'Remainder of issue #14','other','missing',0, ?, 2)`).run(obj.id,
  'Only pp.23-24 are preserved here. Unrelated material elsewhere in White Dwarf #14 is not held, so the ISSUE is not fully preserved even though the interview within it is complete.');

const u1 = g(`SELECT id FROM testimony_units WHERE object_id=? AND sequence_in_object=1`, obj.id).id;
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'verification', ?)`).run(u1,
  'All 19 questions and answers manually collated against the two preserved page images; no OCR treated as evidentiary authority. Both the Gygax answers and the Ian Livingstone questions are stored as VERIFIED text — the questions are the corpus\'s first verified unit_context, so interviewer wording is searchable in context_fts while remaining outside Gygax transcript FTS.');
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'evidence_correction', ?)`).run(u1,
  'Pre-ingestion review rejected the first package: four ordinary crops (q16-q19) sliced the initial glyph of every line and one stitched card (q03) clipped its final word. Ordinary crops are reconstruction-gate-exempt, so no automated control would have caught this — byte hashes prove the prepared bytes are unchanged, not that a crop contains all of the source text. Corrected upstream from the source pages and re-verified; transcripts, questions and unit identities were unchanged by the correction.');
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'external_verification', ?)`).run(u1,
  'Independent bibliographic sources identify the issue as White Dwarf #14, August/September 1979, and the interview as Ian Livingstone\'s. The verified transcript is grounded in the supplied page images, not in those descriptions.');

db.exec('COMMIT');

// ---- report -----------------------------------------------------------------
const after = { objects: B('documentary_objects'), units: B('testimony_units'), context: B('unit_context'),
  assets: B('evidence_assets'), sources: B('evidence_sources'), coverage: B('coverage'), persons: B('persons'),
  verified: g(`SELECT count(*) c FROM testimony_units WHERE transcript_status='verified'`).c,
  vctx: g(`SELECT count(*) c FROM unit_context WHERE text_status='verified'`).c };
const L = []; const P = (s) => { console.log(s); L.push(s); };
const inObj = `unit_id IN (SELECT id FROM testimony_units WHERE object_id=${obj.id})`;
P('\nReconciliation report — White Dwarf #14 interview');
P(`  documentary object   : +${after.objects - before.objects} (interview; issue only partly preserved)`);
P(`  testimony units      : +${after.units - before.units} (expected 19, all VERIFIED)`);
P(`  verified transcripts : ${before.verified} -> ${after.verified}`);
P(`  unit_context rows    : +${after.context - before.context} (expected 19)`);
P(`  VERIFIED contexts    : ${before.vctx} -> ${after.vctx}   <- first verified context text in the corpus`);
P(`  evidence assets      : +${after.assets - before.assets} (16 crop + 3 stitched)`);
P(`  provenance rows      : +${after.sources - before.sources} (expected 22 = 16x1 + 3x2)`);
P(`  coverage segments    : +${after.coverage - before.coverage}`);
P(`  persons              : +${after.persons - before.persons} (Ian Livingstone, global)`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nConfirmations:');
ok('19 verified Gygax units, direct, commentary, complete',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND speaker_id=? AND evidence_relationship='direct'
      AND discourse_mode='commentary' AND completeness='complete' AND transcript_status='verified'`, obj.id, gygax.id).c === 19);
ok('19 VERIFIED interviewer contexts, all attributed to Ian Livingstone',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND context_type='interviewer_question' AND text_status='verified' AND speaker_id=?`, iv.id).c === 19);
ok('interviewer is a GLOBAL identity, not a source-scoped handle',
   g(`SELECT count(*) c FROM persons WHERE id=? AND identity_scope IS NULL`, iv.id).c === 1);
ok('no context row attributes a question to Gygax',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND speaker_id=?`, gygax.id).c === 0);
ok('16 crops + 3 stitched; every stitch keeps 2 ordered portions',
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='crop'`).c === 16 &&
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='stitched'`).c === 3 &&
   g(`SELECT count(*) c FROM (SELECT asset_id FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj} AND asset_type='stitched') GROUP BY asset_id HAVING count(*)=2)`).c === 3);
ok('every asset traces to a named preserved page',
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj}) AND original_locator NOT LIKE '%p.2%'`).c === 0);
P('\nFTS behaviour (the §8 guarantee, now testable with real verified context text):');
ok('Gygax answers ARE in transcript FTS',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'CHAINMAIL'`).c >= 1);
ok('the origins answer is searchable as printed',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'Megarry'`).c >= 1);
ok('interviewer question wording IS in context_fts',
   g(`SELECT count(*) c FROM context_fts JOIN unit_context c ON c.id=context_fts.rowid WHERE ${inObj.replace('unit_id', 'c.unit_id')} AND context_fts MATCH 'inspiration'`).c >= 1);
ok('interviewer question wording is NOT in Gygax transcript FTS',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH '"original inspiration"'`).c === 0);
P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('units_fts in sync with units', B('units_fts') === after.units);
ok('context_fts in sync with unit_context', B('context_fts') === after.context);

P('\nStitched cards requiring eyes-on acceptance before the build gate passes:');
for (const s of stitched) P(`  ${s.unit}  ${s.assetPath}  (page ${s.page}, cross-column)  sha ${s.sha.slice(0, 12)}`);

db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-white-dwarf-14.log';
writeFileSync(logPath, ['Gygax corpus v2 — White Dwarf #14 interview (19 verified transcripts + 19 verified contexts)',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
