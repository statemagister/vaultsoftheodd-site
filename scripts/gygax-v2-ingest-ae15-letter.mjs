#!/usr/bin/env node
/*
 * gygax-v2-ingest-ae15-letter.mjs — ingest Gary Gygax's letter to Lee Gold in
 * "Alarums & Excursions" #15 (October 1976) under the frozen v2 schema.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-ae15-letter.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * The corpus's SECOND verified transcript, and the FIRST verified against primary
 * page images rather than an intermediary's printing (Cyclopeatron's is verified as
 * wording printed by an intermediary). The transcript was manually collated against
 * all three page images; no OCR is treated as evidentiary authority.
 *
 *   1 documentary object : the ISSUE, A&E #15 (partially preserved — we hold the
 *                          Gygax letter, cover and contents, not the whole issue)
 *   1 testimony unit     : the complete three-page authored letter, VERIFIED
 *   3 ordered assets     : letter pages 1 -> 2 -> 3, single-source each, NOT stitched
 *                          (§5: long testimony over substantial pages stays multi-asset)
 *
 * Transcript fidelity, preserved deliberately (§7):
 *   - source typos retained verbatim — e.g. "wsys" in the Origins I passage is NOT
 *     silently corrected to "ways";
 *   - a damaged first character in the mailing abbreviation is shown editorially as
 *     "[P]OB" rather than pretending the page image is clearer than it is;
 *   - preservation-page line wrapping is normalised (typography, not wording).
 *
 * Boundary: the letter ends at "E. Gary Gygax". The "MONSTER BY - WES IVES"
 * contribution that follows on the same preservation page is a different author's
 * work and is excluded from the testimony unit.
 *
 * Cover and contents pages are object-level supporting evidence. evidence_assets is
 * unit-scoped (unit_id NOT NULL), so attaching them to the letter would misrepresent
 * them as evidence OF the testimony. They are therefore recorded by hash in an
 * annotation and retained for audit, NOT ingested as testimony evidence assets.
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
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-ae15-letter.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));

const man = JSON.parse(readFileSync(join(PKG, 'manifest.json'), 'utf8'));
const dobj = man.documentary_object;
const unit = man.testimony_units[0];

// ---- validate ---------------------------------------------------------------
const problems = [];
if (man.testimony_units.length !== 1) problems.push(`expected 1 testimony unit, found ${man.testimony_units.length}`);
if (unit.transcript_status !== 'verified') problems.push(`transcript_status is ${unit.transcript_status}, expected verified`);
if (unit.relationship !== 'direct') problems.push(`relationship is ${unit.relationship}, expected direct`);
if ((unit.evidence_assets || []).length !== 3) problems.push(`expected 3 ordered testimony assets, found ${(unit.evidence_assets || []).length}`);
for (const a of unit.evidence_assets || []) {
  if (!existsSync(join(PKG, a.file))) problems.push(`missing testimony page: ${a.file}`);
}
for (const a of unit.supporting_assets || []) {
  if (!existsSync(join(PKG, a.file))) problems.push(`missing supporting asset: ${a.file}`);
}
// every file must match the package's own SHA256SUMS
const sums = new Map(readFileSync(join(PKG, 'SHA256SUMS.txt'), 'utf8').split('\n')
  .filter((l) => l.trim()).map((l) => { const m = l.trim().split(/\s+/); return [m[1].replace(/^\*/, ''), m[0]]; }));
for (const [f, h] of sums) {
  const p = join(PKG, f);
  if (!existsSync(p)) { problems.push(`SHA256SUMS lists a missing file: ${f}`); continue; }
  if (shaFile(p) !== h) problems.push(`checksum mismatch: ${f}`);
}

// transcript body: everything after the conventions header, i.e. the letter itself
const tFull = readFileSync(join(PKG, man.transcription.file), 'utf8');
const parts = tFull.split('\n---\n');
if (parts.length < 2) problems.push('verified_transcript.md has no --- body separator');
const transcript = (parts[1] || '').trim();
if (!transcript) problems.push('extracted transcript body is empty');
// the boundary must hold: the following contributor's work must not be inside it
if (/MONSTER BY/i.test(transcript)) problems.push('transcript contains "MONSTER BY" — the Wes Ives contribution must be excluded');
if (!/^from Gary Gygax/.test(transcript)) problems.push('transcript does not begin at "from Gary Gygax"');
if (!/E\. Gary Gygax$/.test(transcript)) problems.push('transcript does not end at the "E. Gary Gygax" signature');
// declared fidelity markers must actually survive into the stored transcript
for (const typo of man.transcription.source_typos_retained || [])
  if (!transcript.includes(typo)) problems.push(`declared retained source typo "${typo}" is absent from the transcript`);
if (!transcript.includes('[P]OB')) problems.push('declared editorial reading "[P]OB" is absent from the transcript');

if (problems.length) { problems.slice(0, 15).forEach((p) => console.error('  ' + p)); die(`${problems.length} package problem(s); nothing ingested.`); }
console.log(`A&E #15 Gygax letter — package verified under schema ${SCHEMA.version}`);
console.log(`  ${sums.size} files checksum-verified · transcript ${transcript.length} chars, VERIFIED against 3 page images`);
console.log(`  boundary holds: begins "from Gary Gygax", ends "E. Gary Gygax", Wes Ives contribution excluded`);

// ---- ingest -----------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const B = (t) => g(`SELECT count(*) c FROM ${t}`).c;
const before = { objects: B('documentary_objects'), units: B('testimony_units'), assets: B('evidence_assets'),
  sources: B('evidence_sources'), coverage: B('coverage'), annotations: B('annotations'), families: B('source_families'),
  verified: g(`SELECT count(*) c FROM testimony_units WHERE transcript_status='verified'`).c };

db.exec('BEGIN');
const gygax = g(`SELECT id FROM persons WHERE name='Gary Gygax' AND identity_scope IS NULL`);
if (!gygax) { db.exec('ROLLBACK'); die('speaker "Gary Gygax" not found — run the v1 migration first.'); }
let fam = g(`SELECT id FROM source_families WHERE name='Alarums & Excursions'`);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes) VALUES ('Alarums & Excursions','periodical','Amateur press association zine edited by Lee Gold; each issue compiles contributions from many members.')`).run().lastInsertRowid) };

const TITLE = dobj.title;
let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title=?`, fam.id, TITLE);
if (obj && !FORCE) { db.exec('ROLLBACK'); die(`object "${TITLE}" already present; use --force on a clean DB.`); }
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,date_display,date_from_value,date_precision,venue,citation,identifier,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
  fam.id, TITLE, 'compilation', dobj.date_display, '1976-10', 'month', 'Alarums & Excursions',
  `Gary Gygax, letter to Lee Gold, "Alarums & Excursions" #${dobj.issue_number}, October 1976.`,
  `issue ${dobj.issue_number}`,
  `Amateur-press zine issue compiling many contributors. ONLY PART OF THE ISSUE IS PRESERVED HERE: the three-page Gygax letter plus the cover and contents page. ${dobj.preservation_note}`).lastInsertRowid) };
if (g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c > 0 && !FORCE) { db.exec('ROLLBACK'); die('this object already holds testimony units.'); }

// the verified testimony unit
const uid = Number(db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
   speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
  VALUES (?,1,NULL,'unknown',?,?,'month',NULL,?,?, 'direct', ?, ?, 'verified', ?, 'other', ?)`).run(
  obj.id, dobj.date_display, '1976-10', gygax.id, gygax.id, unit.discourse_mode, transcript, unit.completeness,
  `"Alarums & Excursions" #${dobj.issue_number} (October 1976), Gygax letter pages 1-3; transcript manually collated against all three page images`).lastInsertRowid);

// three ordered testimony pages, single-source each (gate-exempt, not stitched)
for (const a of [...unit.evidence_assets].sort((x, y) => x.sequence - y.sequence)) {
  const assetPath = 'evidence/alarums-excursions/15/' + basename(a.file);
  const h = shaFile(join(PKG, a.file));
  const aid = Number(db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,?, 'page', ?)`)
    .run(uid, assetPath, a.sequence, h).lastInsertRowid);
  db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,original_sha256,capture_date_precision) VALUES (?,?,'scan',?, 'unknown')`)
    .run(aid, `"Alarums & Excursions" #${dobj.issue_number} (October 1976), Gygax letter page ${a.sequence} of 3 — page image, ${dobj.source_role}`, h);
  const dest = join(EVID, assetPath); mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(PKG, a.file), dest);
}

// coverage: the OBJECT (the issue) is only partially preserved, even though the
// testimony unit inside it is complete. §3 forbids conflating the two.
db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,coverage_status,known_loss,detail,sort_order)
  VALUES (?, 'Gygax letter (pages 1-3)','other','complete',0, ?, 1)`).run(obj.id,
  'The three-page Gygax letter is preserved complete: it begins at "from Gary Gygax" and ends at the "E. Gary Gygax" signature, after which a different contributor\'s work begins.');
db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,coverage_status,known_loss,detail,sort_order)
  VALUES (?, 'Remainder of issue #15','other','missing',0, ?, 2)`).run(obj.id,
  'Only the Gygax letter, the cover and the contents page are preserved here. The rest of the issue is not held, so the OBJECT is partially preserved even though the testimony unit within it is complete.');

// supporting object-level evidence: recorded by hash, NOT ingested as testimony
// evidence, because evidence_assets is unit-scoped and attaching a cover to the
// letter would misrepresent it as evidence of the testimony.
const support = (unit.supporting_assets || []).map((s) => `${basename(s.file)} [${s.role}] sha256=${shaFile(join(PKG, s.file))}`).join('; ');
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'supporting_evidence', ?)`).run(uid,
  `Object-level supporting evidence, retained for audit and recorded by hash but NOT ingested as testimony evidence assets (evidence_assets is unit-scoped; attaching a cover or contents page to the letter would misrepresent it as evidence of the testimony): ${support}. The contents page independently corroborates authorship and the three-page extent by listing "Letter / Gary Gygax / 3".`);

// verification + external corroboration, kept separate from the transcript itself
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'verification', ?)`).run(uid,
  'Transcript manually collated against all three supplied page images; no OCR treated as evidentiary authority. Source wording and typos retained verbatim (e.g. "wsys" in the Origins I passage is NOT corrected to "ways"). Preservation-page line wrapping and end-of-line hyphenation normalised — typography, not wording. A damaged first character in the mailing abbreviation is shown editorially as "[P]OB" rather than asserting a clean reading; contemporary TSR usage corroborates POB 756 but the brackets preserve the weakness of the image.');
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'external_verification', ?)`).run(uid,
  'Independent witnesses identify the same document as Gygax\'s letter in "Alarums & Excursions" #15, October 1976, and reproduce the same substantive text (Jason Zavoda 2012; Acaeum discussion/reproduction; Tim Bannock, Gygax\'s Legendarium). These are CORROBORATIVE ONLY: the verified transcript is grounded in the supplied page images, not in those later transcriptions.');
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'cross_reference', ?)`).run(uid,
  'Unresolved contextual lead: the letter responds, in order, to material in A&E #14. Recovering #14 would let each paragraph be linked to what it answers. It is contextual enrichment only and is NOT unfinished evidence for this letter, which stands complete on its own pages.');

db.exec('COMMIT');

// ---- report -----------------------------------------------------------------
const after = { objects: B('documentary_objects'), units: B('testimony_units'), assets: B('evidence_assets'),
  sources: B('evidence_sources'), coverage: B('coverage'), annotations: B('annotations'), families: B('source_families'),
  verified: g(`SELECT count(*) c FROM testimony_units WHERE transcript_status='verified'`).c };
const L = []; const P = (s) => { console.log(s); L.push(s); };
P('\nReconciliation report — A&E #15 Gygax letter');
P(`  source family        : +${after.families - before.families} (Alarums & Excursions, periodical)`);
P(`  documentary object   : +${after.objects - before.objects} (compilation; issue only partially preserved)`);
P(`  testimony units      : +${after.units - before.units} (expected 1, VERIFIED)`);
P(`  verified transcripts : ${before.verified} -> ${after.verified}`);
P(`  evidence assets      : +${after.assets - before.assets} (expected 3 ordered pages)`);
P(`  provenance rows      : +${after.sources - before.sources} (expected 3)`);
P(`  coverage segments    : +${after.coverage - before.coverage} (letter complete; remainder of issue missing)`);
P(`  annotations          : +${after.annotations - before.annotations} (supporting evidence, verification, external, lead)`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
const inObj = `unit_id IN (SELECT id FROM testimony_units WHERE object_id=${obj.id})`;
P('\nConfirmations:');
ok('one VERIFIED unit: Gygax speaker+subject, direct, commentary, complete',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND speaker_id=? AND subject_person_id=?
      AND evidence_relationship='direct' AND discourse_mode='commentary' AND transcript_status='verified' AND completeness='complete'`, obj.id, gygax.id, gygax.id).c === 1);
ok('transcript stored non-empty and byte-identical to the collated body',
   g('SELECT transcript t FROM testimony_units WHERE id=?', uid).t === transcript);
ok('source typo "wsys" retained verbatim (not corrected to "ways")',
   /wsys/.test(g('SELECT transcript t FROM testimony_units WHERE id=?', uid).t));
ok('editorial "[P]OB" retained (image weakness not hidden)',
   g('SELECT transcript t FROM testimony_units WHERE id=?', uid).t.includes('[P]OB'));
ok('Wes Ives contribution excluded from the testimony unit',
   !/MONSTER BY/i.test(g('SELECT transcript t FROM testimony_units WHERE id=?', uid).t));
ok('3 ordered page assets, single-source, gate-exempt (no stitching)',
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='page'`).c === 3 &&
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='stitched'`).c === 0 &&
   g(`SELECT count(*) c FROM (SELECT asset_id FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj}) GROUP BY asset_id HAVING count(*)>1)`).c === 0);
ok('cover/contents NOT ingested as testimony evidence assets',
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND (asset_path LIKE '%cover%' OR asset_path LIKE '%contents%')`).c === 0);
ok('object recorded as only partially preserved',
   g(`SELECT count(*) c FROM coverage WHERE object_id=? AND coverage_status='missing'`, obj.id).c === 1);
P('\nFTS behaviour:');
ok('verified letter IS searchable in Gygax transcript FTS',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'Blackmoor' AND rowid=?`, uid).c === 1);
ok('the retained source typo is searchable as printed',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'wsys'`).c === 1);
ok('Wes Ives wording is NOT in Gygax transcript FTS',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'Ochizaumae OR eyestalks'`).c === 0);
ok('no unit_context invented for this object', g(`SELECT count(*) c FROM unit_context WHERE ${inObj}`).c === 0);
P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('units_fts in sync with units', B('units_fts') === after.units);

P('\nInterpretations recorded:');
P('  - object_type: an amateur-press ZINE ISSUE has no exact vocabulary value; mapped to');
P('    \'compilation\' (the issue compiles many contributors) rather than \'letter\' (which');
P('    describes the unit, not the object) or \'other\'.');
P('  - coverage distinguishes a COMPLETE testimony unit inside a PARTIALLY preserved object.');
P('  - cover/contents are object-level supporting evidence with no unit-scoped home;');
P('    recorded by hash in an annotation, retained for audit, not shown as testimony evidence.');

db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-ae15-letter.log';
writeFileSync(logPath, ['Gygax corpus v2 — A&E #15 Gygax letter (verified transcript from primary page images)',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
