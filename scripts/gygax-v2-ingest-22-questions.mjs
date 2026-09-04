#!/usr/bin/env node
/*
 * gygax-v2-ingest-22-questions.mjs — ingest "22 Questions on Tharizdun answered
 * by Gary Gygax" (Greyhawk Codex questionnaire, questioner Michael Kasparian),
 * preserved in Tim Bannock's 2016 neuronphaser.com republication PDF.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-22-questions.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * Three evidentiary distinctions are carried structurally and must not blur:
 *
 *   1. QUESTIONER vs SPEAKER. All 22 questions are Michael Kasparian's. They are
 *      NOT Gygax testimony. The package supplies them already separated (a
 *      corrected v2.1 package; the first cleaned package merged them into
 *      Gygax-scoped discovery text and was refused at this gate). Each unit gets
 *      one structural quoted_question context row attributed to Kasparian, empty
 *      and untranscribed because unit_context may hold VERIFIED text only; the
 *      question wording lives in discovery_text, unit-linked and separately
 *      labelled. Same shape as the ENWorld and Dragonsfoot regularisations.
 *
 *   2. REPUBLICATION vs TESTIMONY DATE. 2016-06-09 is when Bannock republished.
 *      The original answer date is UNKNOWN; an Internet Archive capture attests
 *      the Greyhawk Codex page by 2000-10-13, which is a terminus ante quem for
 *      online publication and nothing more. No date value is therefore written
 *      to any queryable date column: the schema has no terminus-ante-quem field,
 *      and inventing one from the bound would manufacture precision. The bound is
 *      recorded as prose provenance instead.
 *
 *   3. INTERMEDIARY. Gygax's words reach us through Bannock's republication, so
 *      evidence_relationship is direct_quotation_by_intermediary (the Cyclopeatron
 *      precedent), not 'direct'.
 *
 * 22 Q&A units = 14 ordinary source-native crops + 8 continuous stitches where a
 * compact exchange is interrupted by preservation pagination. The stitches are
 * content-affecting reconstructions and must pass the eyes-on acceptance gate
 * before any build.
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
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-22-questions.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const units = jsonl(join(PKG, 'cards', 'manifest.jsonl'));
const ctxRows = jsonl(join(PKG, 'context_segments.jsonl'));
const ctxByUnit = new Map(ctxRows.map((c) => [c.testimony_unit, c]));

// ---- validate ---------------------------------------------------------------
// The package is applied as settled upstream: this validates, it does not reinterpret.
const problems = [];
const EXPECT = { units: 22, crops: 14, stitched: 8 };
const FAMILY = 'Greyhawk Codex', KIND = 'questionnaire';
const REL = 'direct_quotation_by_intermediary', MODE = 'retrospective_commentary';
const QUESTIONER = 'Michael Kasparian';
const STITCHED_UNITS = new Set(['Q2', 'Q5', 'Q7', 'Q10', 'Q15', 'Q17', 'Q19', 'Q21']);

if (units.length !== EXPECT.units) problems.push(`expected ${EXPECT.units} units, found ${units.length}`);
if (ctxRows.length !== EXPECT.units) problems.push(`expected ${EXPECT.units} context segments, found ${ctxRows.length}`);

let nCrop = 0, nStitch = 0;
const seen = new Set();
for (const u of units) {
  const k = u.testimony_unit;
  if (seen.has(k)) problems.push(`${k}: duplicate unit`); seen.add(k);
  if (!/^Q\d+$/.test(k)) problems.push(`${k}: unrecognised unit key`);
  // frozen-vocabulary mappings, confirmed upstream
  if (u.source_family !== FAMILY) problems.push(`${k}: source_family ${u.source_family}`);
  if (u.source_kind !== KIND) problems.push(`${k}: source_kind ${u.source_kind}`);
  if (u.evidence_relationship !== REL) problems.push(`${k}: evidence_relationship ${u.evidence_relationship}`);
  if (u.discourse_mode !== MODE) problems.push(`${k}: discourse_mode ${u.discourse_mode}`);
  if (u.speaker_display !== 'Gary Gygax') problems.push(`${k}: speaker_display ${u.speaker_display}`);
  if (u.original_questioner !== QUESTIONER) problems.push(`${k}: original_questioner ${u.original_questioner}`);
  // transcript purity: nothing here is verified
  if (u.transcript_status !== 'untranscribed') problems.push(`${k}: transcript_status ${u.transcript_status}`);
  // the defect this package exists to correct: no questioner text inside Gygax discovery
  if (/^\s*Q\d+\s*:/.test(u.discovery_text || '')) problems.push(`${k}: discovery_text still opens with the questioner's "Qn:" line`);
  if (!(u.discovery_text || '').trim()) problems.push(`${k}: empty Gygax discovery text`);
  if ('plaintext_sha256' in u) problems.push(`${k}: plaintext_sha256 should have been removed (it hashed the PNG, and the unit is untranscribed)`);
  // date handling
  if (u.original_date_status !== 'terminus_ante_quem') problems.push(`${k}: original_date_status ${u.original_date_status}`);
  if (u.date_precision !== 'unknown') problems.push(`${k}: date_precision ${u.date_precision}`);
  if (u.preservation_publication_date !== '2016-06-09') problems.push(`${k}: preservation_publication_date ${u.preservation_publication_date}`);

  // the paired context segment
  const c = ctxByUnit.get(k);
  if (!c) { problems.push(`${k}: no context segment`); }
  else {
    if (c.context_type !== 'quoted_question') problems.push(`${k}: context_type ${c.context_type}`);
    if (c.speaker_label !== QUESTIONER) problems.push(`${k}: context speaker ${c.speaker_label}`);
    if ((c.unit_context_text || '') !== '') problems.push(`${k}: context supplies verified text; nothing here is verified`);
    if (!(c.discovery_text || '').trim()) problems.push(`${k}: empty question discovery text`);
    if (!new RegExp(`^\\s*${k}\\s*:`).test(c.discovery_text || '')) problems.push(`${k}: question discovery text does not open with its own "Qn:" line`);
    if (c.evidence_asset_sha256 !== u.evidence_asset_sha256) problems.push(`${k}: context/unit asset hash disagree`);
  }

  // evidence asset: the byte-level identity the eyes-on acceptance is keyed to
  const f = join(PKG, 'cards', u.image_file);
  if (!existsSync(f)) { problems.push(`${k}: missing card ${u.image_file}`); continue; }
  const h = shaFile(f);
  if (h !== u.evidence_asset_sha256) problems.push(`${k}: card bytes do not match the manifest hash`);
  const portions = u.source_portions || [];
  const isStitch = STITCHED_UNITS.has(k);
  if (u.reconstructed !== isStitch) problems.push(`${k}: reconstructed=${u.reconstructed} contradicts the declared stitch set`);
  if (isStitch) {
    nStitch++;
    if (portions.length !== 2) problems.push(`${k}: stitched but ${portions.length} source portion(s)`);
    if (u.representation !== 'stitched_compact_page_break') problems.push(`${k}: representation ${u.representation}`);
    if (u.reconstruction_acceptance !== 'accepted_after_source_comparison') problems.push(`${k}: reconstruction_acceptance ${u.reconstruction_acceptance}`);
  } else {
    nCrop++;
    if (portions.length !== 1) problems.push(`${k}: ordinary crop with ${portions.length} source portion(s)`);
    if (u.representation !== 'single_source_crop') problems.push(`${k}: representation ${u.representation}`);
  }
  for (const p of portions) if (!Number.isInteger(p.source_page)) problems.push(`${k}: portion without an integer source page`);
}
if (nCrop !== EXPECT.crops) problems.push(`crops ${nCrop} != expected ${EXPECT.crops}`);
if (nStitch !== EXPECT.stitched) problems.push(`stitched ${nStitch} != expected ${EXPECT.stitched}`);

// every shipped file must match the package's own checksums
const sums = new Map(readFileSync(join(PKG, 'SHA256SUMS.txt'), 'utf8').split('\n').filter((l) => l.trim())
  .map((l) => { const m = l.trim().split(/\s+/); return [m.slice(1).join(' ').replace(/^\*/, ''), m[0]]; }));
for (const [f, h] of sums) {
  const p = join(PKG, f);
  if (!existsSync(p)) { problems.push(`SHA256SUMS lists a missing file: ${f}`); continue; }
  if (shaFile(p) !== h) problems.push(`checksum mismatch: ${f}`);
}
const PDF = [...sums.keys()].find((f) => f.toLowerCase().endsWith('.pdf'));
if (!PDF) problems.push('the preserved source PDF is not in the package');

if (problems.length) { problems.slice(0, 20).forEach((p) => console.error('  ' + p)); die(`${problems.length} package problem(s); nothing ingested.`); }
console.log(`22 Questions on Tharizdun — package verified under schema ${SCHEMA.version}`);
console.log(`  ${sums.size} files checksum-verified · ${units.length} units · ${nCrop} crops + ${nStitch} stitched · ${ctxRows.length} Kasparian questions held separately`);

// ---- ingest -----------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const B = (t) => g(`SELECT count(*) c FROM ${t}`).c;
const snap = () => ({ objects: B('documentary_objects'), units: B('testimony_units'), context: B('unit_context'),
  assets: B('evidence_assets'), sources: B('evidence_sources'), coverage: B('coverage'), persons: B('persons'),
  discovery: B('discovery_text'), families: B('source_families'),
  verified: g(`SELECT count(*) c FROM testimony_units WHERE transcript_status='verified'`).c,
  vctx: g(`SELECT count(*) c FROM unit_context WHERE text_status='verified'`).c });
const before = snap();

db.exec('BEGIN');
const gygax = g(`SELECT id FROM persons WHERE name='Gary Gygax' AND identity_scope IS NULL`);
if (!gygax) { db.exec('ROLLBACK'); die('speaker "Gary Gygax" not found — run the v1 migration first.'); }

// Michael Kasparian is a NAMED individual, not a source-scoped pseudonymous handle,
// so he takes a GLOBAL identity (identity_scope NULL) under the v2.1 rule — the same
// treatment as Ian Livingstone, and the opposite of the ENWorld/Dragonsfoot handles.
let asker = g(`SELECT id FROM persons WHERE name=? AND identity_scope IS NULL`, QUESTIONER);
const askerIsNew = !asker;
if (!asker) asker = { id: Number(db.prepare(`INSERT INTO persons(name,identity_scope,notes) VALUES (?,NULL,?)`)
  .run(QUESTIONER, 'Named individual: compiled and put the 22 Tharizdun questions to Gygax on the Greyhawk Codex. Globally identified, not a source-scoped handle.').lastInsertRowid) };

let fam = g(`SELECT id FROM source_families WHERE name=?`, FAMILY);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes) VALUES (?,?,?)`).run(
  FAMILY, KIND, 'Greyhawk fan site that hosted the original questionnaire. The site itself is not preserved here; the surviving evidence is a later republication, and an Internet Archive capture attests the page by 2000-10-13.').lastInsertRowid) };

const TITLE = units[0].documentary_object;
let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title=?`, fam.id, TITLE);
if (obj && !FORCE) { db.exec('ROLLBACK'); die(`object "${TITLE}" already present; use --force on a clean DB.`); }
const m0 = units[0];
// NO date value is written. The only fixed point is a terminus ante quem for online
// publication, which the schema cannot express without being read as a testimony date.
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,date_display,date_from_value,date_to_value,date_precision,date_timezone,venue,citation,identifier,notes)
  VALUES (?,?,'questionnaire',?,NULL,NULL,'unknown',NULL,?,?,?,?)`).run(
  fam.id, TITLE, m0.original_date_display, m0.original_venue,
  `Michael Kasparian, "${m0.original_title}", Greyhawk Codex; republished by Tim Bannock, neuronphaser.com, ${m0.preservation_publication_date}.`,
  m0.original_url,
  `${m0.provenance_note} Preserved evidence is a ${m0.pdf_capture_date} PDF capture of the ${m0.preservation_publication_date} neuronphaser.com republication. No date value is recorded on this object or its units: the ${m0.earliest_attested_online} Internet Archive capture (${m0.archived_url}) is a terminus ante quem for online publication only, and the schema has no field that would keep that distinction if the bound were written into a date column.`).lastInsertRowid) };
if (g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c > 0 && !FORCE) { db.exec('ROLLBACK'); die('this object already holds testimony units.'); }

const insUnit = db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
   speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
  VALUES (?,?,?,'observed',?,NULL,'unknown',NULL,?,?,?,?,'','untranscribed','unknown','pdf_text_extraction',?)`);
const insCtx = db.prepare(`INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status,sequence)
  VALUES (?,'quoted_question',?,'','untranscribed',1)`);
const insDisc = db.prepare(`INSERT INTO discovery_text(object_id,segment_label,source_type,source_locator,text,unit_id)
  VALUES (?,?,'pdf_text_extraction',?,?,?)`);
const insAsset = db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,1,?,?)`);
const insSrc = db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,capture_date_display,capture_date_value,capture_date_precision)
  VALUES (?,?,'pdf_page',?,?,'day')`);

const stitched = [];
const ordered = [...units].sort((a, b) => Number(a.testimony_unit.slice(1)) - Number(b.testimony_unit.slice(1)));
for (let i = 0; i < ordered.length; i++) {
  const u = ordered[i];
  const k = u.testimony_unit;
  const n = Number(k.slice(1));           // the source itself prints "Q15:" — an OBSERVED number
  const locator = `Greyhawk Codex, "${u.original_title}", question ${n} of ${EXPECT.units}; preserved at neuronphaser.com PDF p.${u.source_pages}`;
  const uid = Number(insUnit.run(obj.id, i + 1, n, u.original_date_display, gygax.id, gygax.id, REL, MODE, locator).lastInsertRowid);

  // Kasparian's question: structural context row (empty — nothing verified) …
  insCtx.run(uid, asker.id);
  // … with the wording held as unit-linked discovery, labelled so it can never be
  // mistaken for Gygax's own words.
  const c = ctxByUnit.get(k);
  insDisc.run(obj.id, k, `${locator}; question put by ${QUESTIONER} (NOT Gygax testimony)`, c.discovery_text.trim(), uid);
  insDisc.run(obj.id, k, `${locator}; Gygax answer`, u.discovery_text.trim(), uid);

  const assetPath = 'evidence/greyhawk-codex/22-questions/' + basename(u.image_file);
  const h = shaFile(join(PKG, 'cards', u.image_file));
  const isStitch = STITCHED_UNITS.has(k);
  const aid = Number(insAsset.run(uid, assetPath, isStitch ? 'stitched' : 'crop', h).lastInsertRowid);
  const portions = u.source_portions;
  for (let j = 0; j < portions.length; j++) {
    const p = portions[j];
    const what = isStitch
      ? `preservation page portion ${j + 1} of ${portions.length} (stitch order ${j + 1}) — compact Q&A interrupted by preservation pagination`
      : 'source-native crop of one preservation-page region';
    insSrc.run(aid, `neuronphaser.com republication PDF p.${p.source_page}, clip [${p.clip_pdf_points.join(', ')}] pt — ${what}`,
      u.pdf_capture_date, u.pdf_capture_date);
  }
  const dest = join(EVID, assetPath); mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(PKG, 'cards', u.image_file), dest);
  if (isStitch) stitched.push({ unit: k, assetPath, sha: h, pages: u.source_pages });
}

db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,number_from,number_to,coverage_status,known_loss,detail,sort_order)
  VALUES (?, 'Questions 1-22','other',1,22,'complete',0,?,1)`).run(obj.id,
  'All 22 numbered questions and their answers are preserved. The questionnaire is complete as a set; the surviving witness is a republication, not the Greyhawk Codex page itself.');

const u1 = g(`SELECT id FROM testimony_units WHERE object_id=? AND sequence_in_object=1`, obj.id).id;
const ann = db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?,?,?)`);
ann.run(u1, 'date_limitation',
  `The original answer date is UNKNOWN. 2016-06-09 is Tim Bannock's republication date on neuronphaser.com and 2018-03-31 is the PDF capture; neither dates the testimony. An Internet Archive capture of ${m0.original_url} at ${m0.archived_url} attests the page by ${m0.earliest_attested_online}, which bounds online publication from above and says nothing about when Gygax answered. No date value is stored on the object or on any of the 22 units, so no query can promote the bound into a testimony date.`);
ann.run(u1, 'attribution',
  `All 22 questions were put by ${QUESTIONER} and are held as quoted_question context attributed to him, with the wording in unit-linked discovery_text. None of it is Gygax testimony. Q15 is the case that made this concrete: the parenthetical speculations "a Suel Mage of Power, an Elven arch-mage…" are Kasparian's, while Gygax's answer opens "Once more, I have no file of data dealing with Tsojcanth." A first cleaned package merged every question into Gygax-scoped discovery text and was refused at the ingestion gate; this package separates them upstream, and the separation was verified lossless (question + newline + answer reproduces the earlier merged text exactly, for all 22).`);
ann.run(u1, 'evidence_relationship',
  'Gygax\'s words survive only through Bannock\'s 2016 republication, so the relationship is direct_quotation_by_intermediary rather than direct — the Cyclopeatron precedent. The republication is verbatim so far as can be checked, but no independent witness to the Greyhawk Codex text is held.');
ann.run(u1, 'source_formatting',
  'Q19 is a source-formatting exception: in the republication both Kasparian\'s question and Gygax\'s answer are set bold, where the other 21 answers carry the blockquote rule. The boundary is still explicit in the source — the three-line prefixed question ends "she develop Tsojcanthʼs research?" and the next line begins "I thought of it as a sort of “know thy enemy” matter." The split follows that visible boundary, not the styling.');

db.exec('COMMIT');

// ---- report -----------------------------------------------------------------
const after = snap();
const L = []; const P = (s) => { console.log(s); L.push(s); };
const inObj = `unit_id IN (SELECT id FROM testimony_units WHERE object_id=${obj.id})`;
P('\nReconciliation report — 22 Questions on Tharizdun');
P(`  source family        : +${after.families - before.families} (${FAMILY}, ${KIND})`);
P(`  documentary object   : +${after.objects - before.objects} (questionnaire; no date value recorded)`);
P(`  testimony units      : +${after.units - before.units} (expected 22, all UNTRANSCRIBED)`);
P(`  unit_context rows    : +${after.context - before.context} (expected 22 quoted_question, all Kasparian)`);
P(`  discovery_text rows  : +${after.discovery - before.discovery} (expected 44 = 22 questions + 22 answers)`);
P(`  evidence assets      : +${after.assets - before.assets} (14 crop + 8 stitched)`);
P(`  provenance rows      : +${after.sources - before.sources} (expected 30 = 14x1 + 8x2)`);
P(`  coverage segments    : +${after.coverage - before.coverage}`);
P(`  persons              : +${after.persons - before.persons} (${askerIsNew ? QUESTIONER + ', global' : 'none; ' + QUESTIONER + ' already held'})`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nConfirmations:');
ok('22 Gygax units, intermediary-quoted, retrospective, untranscribed',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND speaker_id=? AND evidence_relationship=? AND discourse_mode=? AND transcript_status='untranscribed' AND transcript=''`,
     obj.id, gygax.id, REL, MODE).c === 22);
ok('no verified transcript was added anywhere in the corpus', after.verified === before.verified);
ok('question numbers are OBSERVED 1..22, one per unit',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND unit_number_status='observed' AND unit_number BETWEEN 1 AND 22`, obj.id).c === 22 &&
   g(`SELECT count(DISTINCT unit_number) c FROM testimony_units WHERE object_id=?`, obj.id).c === 22);
ok('no date value on the object or any unit (terminus ante quem stays prose)',
   g(`SELECT count(*) c FROM documentary_objects WHERE id=? AND date_from_value IS NULL AND date_to_value IS NULL AND date_precision='unknown'`, obj.id).c === 1 &&
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND (date_value IS NOT NULL OR date_precision<>'unknown')`, obj.id).c === 0);
ok('22 quoted_question contexts, every one attributed to Michael Kasparian',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND context_type='quoted_question' AND speaker_id=?`, asker.id).c === 22);
ok('no context row attributes a question to Gygax',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND speaker_id=?`, gygax.id).c === 0);
ok('every context row is empty and untranscribed (nothing here is verified)',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND (text<>'' OR text_status<>'untranscribed')`).c === 0);
ok('the questioner is a GLOBAL identity, not a source-scoped handle',
   g(`SELECT count(*) c FROM persons WHERE id=? AND identity_scope IS NULL`, asker.id).c === 1);
ok('44 discovery rows: exactly one question and one answer per unit',
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%question put by%'`, obj.id).c === 22 &&
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%Gygax answer%'`, obj.id).c === 22);
ok('no Gygax-answer discovery row opens with the questioner\'s "Qn:" line',
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%Gygax answer%' AND text GLOB 'Q[0-9]*:*'`, obj.id).c === 0);
ok('14 crops + 8 stitched; every stitch keeps 2 ordered portions',
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='crop'`).c === 14 &&
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='stitched'`).c === 8 &&
   g(`SELECT count(*) c FROM (SELECT asset_id FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj} AND asset_type='stitched') GROUP BY asset_id HAVING count(*)=2)`).c === 8);
ok('every asset hash in the DB matches the staged file bytes',
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj}`).c === 22 &&
   db.prepare(`SELECT asset_path, sha256 FROM evidence_assets WHERE ${inObj}`).all()
     .every((a) => existsSync(join(EVID, a.asset_path)) && shaFile(join(EVID, a.asset_path)) === a.sha256));
ok('every provenance row names a preservation page and its capture date',
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj})
      AND (original_locator NOT LIKE '%republication PDF p.%' OR capture_date_value IS NULL)`).c === 0);

P('\nFTS behaviour (the §8 guarantee):');
ok('Gygax answer wording IS discoverable',
   g(`SELECT count(*) c FROM discovery_fts WHERE discovery_fts MATCH 'Theorparts'`).c >= 1);
ok('Kasparian question wording is NOT in Gygax transcript FTS',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH '"Suel Mage of Power"'`).c === 0);
ok('no unit transcript text exists for this object at all',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND length(transcript)>0`, obj.id).c === 0);
ok('the Q15 speculations sit on the QUESTION side, not the answer side',
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND segment_label='Q15' AND source_locator LIKE '%question put by%' AND text LIKE '%Suel%Mage of Power%'`, obj.id).c === 1 &&
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND segment_label='Q15' AND source_locator LIKE '%Gygax answer%' AND text LIKE '%Suel Mage of Power%'`, obj.id).c === 0);

P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('units_fts in sync with units', B('units_fts') === after.units);
ok('context_fts in sync with unit_context', B('context_fts') === after.context);
ok('discovery_fts in sync with discovery_text', B('discovery_fts') === after.discovery);

P('\nStitched cards requiring eyes-on acceptance before the build gate passes:');
for (const s of stitched) P(`  ${s.unit}  ${s.assetPath}  (pp.${s.pages})  sha ${s.sha.slice(0, 12)}`);

db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-22-questions.log';
writeFileSync(logPath, ['Gygax corpus v2 — 22 Questions on Tharizdun (Greyhawk Codex questionnaire)',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
