#!/usr/bin/env node
/*
 * gygax-v2-ingest-oerth-journal-12.mjs — ingest "Thus Spake Gary Gygax: Ye
 * Secrets of Oerth Revealed" (Oerth Journal, Volume II No. 1, Issue 12,
 * compiled by Paul J. Stormberg from email questionnaires put to Gygax).
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-oerth-journal-12.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * The article's own headnote states how the testimony was produced — "The
 * emails were essentially questionnaires, each having a list of Greyhawk
 * conundrums for Gary to solve" — and states its typographic convention:
 * "Text in bold indicates my line of questioning and the italic Author's Notes
 * identify my observations and comments on Gary's answers." That sentence is
 * the source's own attribution key, and this ingestion follows it exactly.
 *
 * Four distinctions carried structurally:
 *
 *   1. FOUR KINDS OF NON-GYGAX TEXT, each in its frozen-vocabulary slot:
 *      31 interviewer_question, 7 editorial_framing (6 [PJS] author's notes +
 *      the twin-cataclysms transition), 1 headnote, 3 caption. All are context,
 *      never testimony. The captions are UNATTRIBUTED in the source, so their
 *      speaker_id stays NULL rather than being assigned to Stormberg or Gygax —
 *      the same treatment as the 160 unnamed ENWorld quote segments.
 *
 *   2. PUBLICATION vs TESTIMONY DATE. The issue records three publication
 *      manifestations (Spring 2001 preview, August 2001 revision, July 2002
 *      recompilation). The underlying emails are undated. Publication dates go
 *      on the documentary object; every unit keeps date_value NULL and
 *      date_precision 'unknown'.
 *
 *   3. NO SOURCE NUMBERING. The article prints "Q:", not "Q1:". The Q1..Q31
 *      keys are preparation sequence, so unit_number stays NULL and
 *      unit_number_status 'unknown'. Order lives in sequence_in_object, which
 *      the schema defines as an ordering key and not a historical claim.
 *
 *   4. INTERMEDIARY. Gygax's answers reach us through Stormberg's compilation,
 *      so evidence_relationship is direct_quotation_by_intermediary.
 *
 * 31 Q&A units = 23 source-native crops + 8 layout reconstructions (4 cross-
 * column, 3 page-break, 1 layout-wrap), which must pass the eyes-on acceptance
 * gate. Deliberately NOT ingested as Gygax testimony: the Dorgha Torgu and
 * Greyhawk Gods / Rentaq game-text sections, whose authorship the issue does
 * not settle. They remain in the unchanged source PDF.
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
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-oerth-journal-12.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const units = jsonl(join(PKG, 'cards', 'manifest.jsonl'));
const ctxRows = jsonl(join(PKG, 'context_segments.jsonl'));
const ctxCards = jsonl(join(PKG, 'context_cards', 'manifest.jsonl'));
const unitAnns = jsonl(join(PKG, 'unit_annotations.jsonl'));
const README = readFileSync(join(PKG, 'README.md'), 'utf8');

// ---- validate ---------------------------------------------------------------
const problems = [];
const EXPECT = { units: 31, contexts: 42, questions: 31, framing: 7, headnote: 1, caption: 3, crops: 23, stitched: 8, ctxCards: 4 };
const FAMILY = 'Oerth Journal', DECLARED_KIND = 'questionnaire';
const REL = 'direct_quotation_by_intermediary', MODE = 'retrospective_commentary';
const BYLINE = 'Paul J. Stormberg';
const UNATTRIBUTED = 'Oerth Journal (unattributed editorial caption)';
// frozen unit_context vocabulary — anything outside this must stop, not be coerced
const CTX_VOCAB = new Set(['interviewer_question', 'quoted_question', 'editorial_framing', 'headnote', 'caption']);
const STITCH_REPS = new Set(['stitched_cross_column', 'stitched_compact_page_break', 'stitched_layout_wrap']);

if (units.length !== EXPECT.units) problems.push(`expected ${EXPECT.units} units, found ${units.length}`);
if (ctxRows.length !== EXPECT.contexts) problems.push(`expected ${EXPECT.contexts} context rows, found ${ctxRows.length}`);
if (ctxCards.length !== EXPECT.ctxCards) problems.push(`expected ${EXPECT.ctxCards} context cards, found ${ctxCards.length}`);

const byKey = new Map(units.map((u) => [u.testimony_unit, u]));
let nCrop = 0, nStitch = 0;
for (const u of units) {
  const k = u.testimony_unit;
  if (u.source_family !== FAMILY) problems.push(`${k}: source_family ${u.source_family}`);
  if (u.source_kind !== DECLARED_KIND) problems.push(`${k}: source_kind ${u.source_kind}`);
  if (u.evidence_relationship !== REL) problems.push(`${k}: evidence_relationship ${u.evidence_relationship}`);
  if (u.discourse_mode !== MODE) problems.push(`${k}: discourse_mode ${u.discourse_mode}`);
  if (u.speaker_display !== 'Gary Gygax') problems.push(`${k}: speaker_display ${u.speaker_display}`);
  if (u.article_byline !== BYLINE) problems.push(`${k}: article_byline ${u.article_byline}`);
  if (u.transcript_status !== 'untranscribed') problems.push(`${k}: transcript_status ${u.transcript_status}`);
  if (u.date_precision !== 'unknown') problems.push(`${k}: date_precision ${u.date_precision}`);
  if (!(u.discovery_text || '').trim()) problems.push(`${k}: empty Gygax discovery text`);
  // attribution: no interviewer or editorial wording inside Gygax discovery
  if (/^\s*Q\s*:/.test(u.discovery_text)) problems.push(`${k}: Gygax discovery opens with the interviewer's "Q:" line`);
  if (/\[PJS\]/.test(u.discovery_text)) problems.push(`${k}: Gygax discovery contains a [PJS] editorial note`);
  const f = join(PKG, 'cards', u.image_file);
  if (!existsSync(f)) { problems.push(`${k}: missing card ${u.image_file}`); continue; }
  if (shaFile(f) !== u.evidence_asset_sha256) problems.push(`${k}: card bytes do not match the manifest hash`);
  const isStitch = STITCH_REPS.has(u.representation);
  if (u.reconstructed !== isStitch) problems.push(`${k}: reconstructed=${u.reconstructed} contradicts representation ${u.representation}`);
  if (isStitch) {
    nStitch++;
    if (u.reconstruction_acceptance !== 'accepted_after_source_comparison') problems.push(`${k}: stitched but reconstruction_acceptance ${u.reconstruction_acceptance}`);
    if ((u.source_portions || []).length < 2) problems.push(`${k}: stitched with ${(u.source_portions || []).length} portion(s)`);
  } else {
    nCrop++;
    if (u.representation !== 'single_source_crop') problems.push(`${k}: unrecognised representation ${u.representation}`);
    if ((u.source_portions || []).length !== 1) problems.push(`${k}: ordinary crop with ${(u.source_portions || []).length} portion(s)`);
  }
}
if (nCrop !== EXPECT.crops) problems.push(`crops ${nCrop} != expected ${EXPECT.crops}`);
if (nStitch !== EXPECT.stitched) problems.push(`stitched ${nStitch} != expected ${EXPECT.stitched}`);

const ctxCount = { interviewer_question: 0, editorial_framing: 0, headnote: 0, caption: 0 };
for (const c of ctxRows) {
  const k = `${c.testimony_unit}/${c.context_sequence}`;
  if (!CTX_VOCAB.has(c.context_type)) { problems.push(`${k}: context_type "${c.context_type}" is outside the frozen v2.1 vocabulary`); continue; }
  ctxCount[c.context_type] = (ctxCount[c.context_type] || 0) + 1;
  if (!byKey.has(c.testimony_unit)) problems.push(`${k}: context attached to an unknown unit`);
  if ((c.unit_context_text || '') !== '') problems.push(`${k}: context supplies verified text; nothing in this source is verified`);
  if (!(c.discovery_text || '').trim()) problems.push(`${k}: empty context discovery text`);
  const named = c.context_type === 'caption' ? UNATTRIBUTED : BYLINE;
  if (c.speaker_label !== named) problems.push(`${k}: speaker_label ${c.speaker_label} (expected ${named})`);
}
for (const [t, n] of Object.entries({ interviewer_question: EXPECT.questions, editorial_framing: EXPECT.framing, headnote: EXPECT.headnote, caption: EXPECT.caption }))
  if (ctxCount[t] !== n) problems.push(`context_type ${t}: ${ctxCount[t]} != expected ${n}`);
// context sequences must be contiguous per unit so unit_context's UNIQUE(unit_id,sequence) holds
const seqs = new Map();
for (const c of ctxRows) { const a = seqs.get(c.testimony_unit) || []; a.push(c.context_sequence); seqs.set(c.testimony_unit, a); }
for (const [k, a] of seqs) { a.sort((x, y) => x - y); if (a.join(',') !== a.map((_, i) => i + 1).join(',')) problems.push(`${k}: context_sequence not contiguous (${a.join(',')})`); }

const ctxCardByKey = new Map();
for (const cc of ctxCards) {
  const f = join(PKG, 'context_cards', cc.image_file);
  if (!existsSync(f)) { problems.push(`missing context card ${cc.image_file}`); continue; }
  if (shaFile(f) !== cc.evidence_asset_sha256) problems.push(`${cc.context_asset_id}: card bytes do not match the manifest hash`);
  if (cc.reconstructed) problems.push(`${cc.context_asset_id}: context cards must be ordinary crops, not reconstructions`);
  if (!byKey.has(cc.linked_testimony_unit)) problems.push(`${cc.context_asset_id}: linked to an unknown unit`);
  const row = ctxRows.find((c) => c.testimony_unit === cc.linked_testimony_unit && c.evidence_asset_sha256 === cc.evidence_asset_sha256);
  if (!row) problems.push(`${cc.context_asset_id}: no context row references this card's hash`);
  else ctxCardByKey.set(`${row.testimony_unit}/${row.context_sequence}`, cc);
}

for (const a of unitAnns) {
  const u = byKey.get(a.testimony_unit);
  if (!u) { problems.push(`annotation for unknown unit ${a.testimony_unit}`); continue; }
  // the annotation's character offsets must actually select the interpolated text
  const seg = u.discovery_text.slice(a.discovery_char_start_zero_based, a.discovery_char_end_exclusive_zero_based);
  if (seg !== a.interpolated_text) problems.push(`${a.testimony_unit}: annotation offsets do not select the quoted interpolation`);
  if (a.evidence_asset_sha256 !== u.evidence_asset_sha256) problems.push(`${a.testimony_unit}: annotation asset hash disagrees with the unit`);
}

const sums = new Map(readFileSync(join(PKG, 'SHA256SUMS.txt'), 'utf8').split('\n').filter((l) => l.trim())
  .map((l) => { const m = l.trim().split(/\s+/); return [m.slice(1).join(' ').replace(/^\*/, ''), m[0]]; }));
for (const [f, h] of sums) {
  const p = join(PKG, f);
  if (!existsSync(p)) { problems.push(`SHA256SUMS lists a missing file: ${f}`); continue; }
  if (shaFile(p) !== h) problems.push(`checksum mismatch: ${f}`);
}
const PDF = [...sums.keys()].find((f) => f.toLowerCase().endsWith('.pdf'));
if (!PDF) problems.push('the preserved source PDF is not in the package');
else {
  const m = README.match(/Source PDF SHA-256:\s*`([0-9a-f]{64})`/);
  if (!m) problems.push('the README does not state the source PDF SHA-256');
  else if (m[1] !== shaFile(join(PKG, PDF))) problems.push('source PDF hash disagrees with the README');
}

if (problems.length) { problems.slice(0, 20).forEach((p) => console.error('  ' + p)); die(`${problems.length} package problem(s); nothing ingested.`); }
console.log(`Oerth Journal #12 — package verified under schema ${SCHEMA.version}`);
console.log(`  ${sums.size} files checksum-verified · ${units.length} units (${nCrop} crops + ${nStitch} stitched)`);
console.log(`  ${ctxRows.length} context rows: ${ctxCount.interviewer_question} question · ${ctxCount.editorial_framing} editorial_framing · ${ctxCount.headnote} headnote · ${ctxCount.caption} caption (+${ctxCards.length} context cards)`);

// ---- ingest -----------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const B = (t) => g(`SELECT count(*) c FROM ${t}`).c;
const snap = () => ({ objects: B('documentary_objects'), units: B('testimony_units'), context: B('unit_context'),
  assets: B('evidence_assets'), sources: B('evidence_sources'), coverage: B('coverage'), persons: B('persons'),
  discovery: B('discovery_text'), families: B('source_families'), annotations: B('annotations'),
  verified: g(`SELECT count(*) c FROM testimony_units WHERE transcript_status='verified'`).c,
  vctx: g(`SELECT count(*) c FROM unit_context WHERE text_status='verified'`).c });
const before = snap();

db.exec('BEGIN');
const gygax = g(`SELECT id FROM persons WHERE name='Gary Gygax' AND identity_scope IS NULL`);
if (!gygax) { db.exec('ROLLBACK'); die('speaker "Gary Gygax" not found — run the v1 migration first.'); }

// Stormberg is a NAMED individual (bylined author), so a GLOBAL identity —
// not a source-scoped pseudonymous handle. Same treatment as Livingstone and Kasparian.
let sb = g(`SELECT id FROM persons WHERE name=? AND identity_scope IS NULL`, BYLINE);
const sbIsNew = !sb;
if (!sb) sb = { id: Number(db.prepare(`INSERT INTO persons(name,identity_scope,notes) VALUES (?,NULL,?)`)
  .run(BYLINE, 'Named individual: bylined compiler of the Oerth Journal #12 Gygax questionnaires; put the questions and wrote the [PJS] author\'s notes. Globally identified, not a source-scoped handle.').lastInsertRowid) };

// The family is the PERIODICAL; the questionnaire kind belongs to the article, which
// takes object_type 'questionnaire' below. Typing the periodical itself 'questionnaire'
// would misdescribe every future Oerth Journal article. Matches White Dwarf and A&E.
let fam = g(`SELECT id FROM source_families WHERE name=?`, FAMILY);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes) VALUES (?,'periodical',?)`).run(
  FAMILY, 'Long-running World of Greyhawk fanzine. Issue 12 carries the Stormberg Gygax questionnaires; the family is the periodical, while this particular article is typed a questionnaire at object level.').lastInsertRowid) };

const m0 = units[0];
const TITLE = m0.documentary_object;
let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title=?`, fam.id, TITLE);
if (obj && !FORCE) { db.exec('ROLLBACK'); die(`object "${TITLE}" already present; use --force on a clean DB.`); }
// Publication manifestations ARE dated; the testimony is not. The date range spans first
// publication to the supplied recompilation, at the coarser of the two precisions.
const DATE_DISPLAY = `${m0.first_publication_display}; first revision ${m0.first_revision_display}; supplied manifestation ${m0.supplied_manifestation_display}`;
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,date_display,date_from_value,date_to_value,date_precision,date_timezone,venue,citation,identifier,notes)
  VALUES (?,?,'questionnaire',?,'2001','2002-07','year',NULL,?,?,?,?)`).run(
  fam.id, TITLE, DATE_DISPLAY, FAMILY,
  `Paul J. Stormberg, "${TITLE}", Oerth Journal ${m0.issue}, pp.3-9.`, m0.issue,
  `Compiled by Stormberg from email questionnaires put to Gygax over several years; the article's own headnote states "The emails were essentially questionnaires, each having a list of Greyhawk conundrums for Gary to solve." Those dates ARE THE PUBLICATION's, not the testimony's: the preview issue is ${m0.first_publication_display}, the first revision ${m0.first_revision_display}, the supplied recompilation ${m0.supplied_manifestation_display}. The underlying emails are undated and every unit here keeps date_value NULL. The article prints its questions as "Q:" with no numbering, so unit numbers are not recorded either.`).lastInsertRowid) };
if (g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c > 0 && !FORCE) { db.exec('ROLLBACK'); die('this object already holds testimony units.'); }

const insUnit = db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
   speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
  VALUES (?,?,NULL,'unknown',?,NULL,'unknown',NULL,?,?,?,?,'','untranscribed',?,'pdf_text_extraction',?)`);
const insCtx = db.prepare(`INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status,sequence)
  VALUES (?,?,?,'','untranscribed',?)`);
const insDisc = db.prepare(`INSERT INTO discovery_text(object_id,segment_label,source_type,source_locator,text,unit_id)
  VALUES (?,?,'pdf_text_extraction',?,?,?)`);
const insAsset = db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,?,?,?)`);
const insSrc = db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,capture_date_precision) VALUES (?,?,'pdf_page','unknown')`);
const insAnn = db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?,?,?)`);

const ASSET_DIR = 'evidence/oerth-journal/12/';
const stitched = [];
const unitIds = new Map();
const ctxByUnit = new Map();
for (const c of ctxRows) { const a = ctxByUnit.get(c.testimony_unit) || []; a.push(c); ctxByUnit.set(c.testimony_unit, a); }
const CTX_LABEL = {
  interviewer_question: `question put by ${BYLINE} (NOT Gygax testimony)`,
  editorial_framing: `editorial framing by ${BYLINE} (NOT Gygax testimony)`,
  headnote: `article headnote by ${BYLINE} (NOT Gygax testimony)`,
  caption: 'illustration caption, author not credited in the source (NOT Gygax testimony)',
};

for (const u of [...units].sort((a, b) => a.sequence_in_object - b.sequence_in_object)) {
  const k = u.testimony_unit;
  const locator = `Oerth Journal ${u.issue}, "${TITLE}", p.${u.source_pages}; exchange ${u.sequence_in_object} of ${units.length} (article order; the source prints "Q:" without numbering)`;
  const uid = Number(insUnit.run(obj.id, u.sequence_in_object, DATE_DISPLAY, gygax.id, gygax.id, REL, MODE, u.completeness, locator).lastInsertRowid);
  unitIds.set(k, uid);
  insDisc.run(obj.id, k, `${locator}; Gygax answer`, u.discovery_text.trim(), uid);

  // context: structural row (empty — nothing here is verified) + labelled discovery
  let order = 1;
  for (const c of (ctxByUnit.get(k) || []).sort((a, b) => a.context_sequence - b.context_sequence)) {
    // captions are UNATTRIBUTED in the source: speaker_id stays NULL rather than
    // inventing an author, matching the 160 unnamed ENWorld quote segments.
    const speaker = c.context_type === 'caption' ? null : sb.id;
    insCtx.run(uid, c.context_type, speaker, c.context_sequence);
    insDisc.run(obj.id, k, `${locator}; ${CTX_LABEL[c.context_type]}`, c.discovery_text.trim(), uid);
  }

  // evidence: the testimony card first, then any context card for this unit
  const h = shaFile(join(PKG, 'cards', u.image_file));
  const isStitch = STITCH_REPS.has(u.representation);
  const aid = Number(insAsset.run(uid, ASSET_DIR + basename(u.image_file), order++, isStitch ? 'stitched' : 'crop', h).lastInsertRowid);
  const portions = u.source_portions;
  for (let j = 0; j < portions.length; j++) {
    const p = portions[j];
    const what = isStitch
      ? `portion ${j + 1} of ${portions.length} (stitch order ${p.order})${p.column ? `, ${p.column} column` : ''} — compact Q&A interrupted by the ${u.representation.replace('stitched_', '').replace(/_/g, ' ')}`
      : `source-native crop of one ${p.column ? p.column + '-column ' : ''}page region`;
    insSrc.run(aid, `Oerth Journal ${u.issue} p.${p.source_page}, clip [${p.clip_pdf_points.join(', ')}] pt — ${what}`);
  }
  let dest = join(EVID, ASSET_DIR + basename(u.image_file)); mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(PKG, 'cards', u.image_file), dest);
  if (isStitch) stitched.push({ unit: k, assetPath: ASSET_DIR + basename(u.image_file), sha: h, rep: u.representation });

  for (const c of (ctxByUnit.get(k) || [])) {
    const cc = ctxCardByKey.get(`${c.testimony_unit}/${c.context_sequence}`);
    if (!cc) continue;
    const ch = shaFile(join(PKG, 'context_cards', cc.image_file));
    // Context evidence has no unit-independent home in the frozen schema, so it hangs
    // off the unit it is documentarily adjacent to, labelled so it can never read as
    // a second page of Gygax testimony.
    const caid = Number(insAsset.run(uid, ASSET_DIR + basename(cc.image_file), order++, 'crop', ch).lastInsertRowid);
    const p = cc.source_portions[0];
    insSrc.run(caid, `Oerth Journal ${u.issue} p.${p.source_page}, clip [${p.clip_pdf_points.join(', ')}] pt — source-native crop of CONTEXT (${c.context_type}), not Gygax testimony; adjacency to this unit is documentary, not semantic`);
    dest = join(EVID, ASSET_DIR + basename(cc.image_file)); mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(PKG, 'context_cards', cc.image_file), dest);
  }
}

db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,coverage_status,known_loss,detail,sort_order)
  VALUES (?, 'Questionnaire Q&A (pp.3-9)','page_range','complete',0,?,1)`).run(obj.id,
  'All 31 question-and-answer exchanges of the article are preserved, from the headnote through the final S3/C1 exchange. Complete AS PRESERVED in this issue; the underlying email questionnaires themselves are not held, and the article does not state whether it prints every question ever put to Gygax.');
db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,coverage_status,known_loss,detail,sort_order)
  VALUES (?, 'Dorgha Torgu and Greyhawk Gods / Elder Elemental God sections','other','missing',0,?,2)`).run(obj.id,
  'Standalone game-text sections printed in the same article (Dorgha Torgu after Q18; Greyhawk Gods / Rentaq after Q31) are NOT ingested as Gygax testimony. The issue describes the Greyhawk Gods sourcebook as a collaboration and does not allocate authorship sentence by sentence, so classifying it as Gygax testimony would infer authorship the source does not state. Preserved unchanged in the source PDF.');

const u1 = unitIds.get('Q1');
insAnn.run(u1, 'date_limitation',
  `The dates of Gygax's answers are UNKNOWN. Stormberg compiled the article from email questionnaires exchanged over several years; the issue's three publication manifestations (${m0.first_publication_display}, ${m0.first_revision_display}, ${m0.supplied_manifestation_display}) date the PUBLICATION only and are held on the documentary object. Every unit keeps date_value NULL and date_precision 'unknown' so no query can promote a publication date into a testimony date.`);
insAnn.run(u1, 'attribution',
  `The article states its own attribution key in the headnote: "Text in bold indicates my line of questioning and the italic Author's Notes identify my observations and comments on Gary's answers." This ingestion follows it exactly — 31 interviewer questions, 6 [PJS] author's notes and 1 transition paragraph are Stormberg's and are held as context, never as Gygax testimony. The 3 illustration captions are credited to nobody in the source, so their context rows carry speaker_id NULL rather than an inferred author.`);
insAnn.run(u1, 'evidence_relationship',
  'Gygax answered by email; what survives is Stormberg\'s printed compilation, so the relationship is direct_quotation_by_intermediary rather than direct. The original emails are not held, and word-for-word fidelity of the printed text to them has not been independently collated.');
insAnn.run(u1, 'unit_numbering',
  'The article prints every question as a bare "Q:" with no number. The Q1..Q31 keys are preparation sequence only, so unit_number is NULL and unit_number_status is \'unknown\'; ordering lives in sequence_in_object, which the schema defines as an ordering key rather than a historical claim.');
insAnn.run(u1, 'context_evidence',
  'The headnote and three caption cards are evidence for CONTEXT rows, not for Gygax testimony. The frozen schema binds evidence_assets to a testimony unit, with no unit_context-scoped or object-scoped home, so each hangs off the unit it is documentarily adjacent to at display_order 2 and says so in its provenance locator. This is the same schema gap already recorded for object-level supporting evidence on GameSpy and A&E #15 — recorded, not amended.');
insAnn.run(u1, 'external_verification',
  'Greyhawk Online\'s Oerth Journal index independently lists Issue #12 as Volume II No. 1 with the Stormberg article, dating the indexed issue August 2001; the supplied PDF carries the fuller three-manifestation history. Not independently verified: the dates of the underlying emails, word-for-word fidelity of the printed answers to them, and authorship allocation inside the excluded collaborative sections.');
for (const a of unitAnns)
  insAnn.run(unitIds.get(a.testimony_unit), 'inline_editorial_interpolation',
    `${a.note} Interpolated text, verbatim: "${a.interpolated_text.replace(/\s+/g, ' ')}" (characters ${a.discovery_char_start_zero_based}-${a.discovery_char_end_exclusive_zero_based} of this unit's discovery text).`);

db.exec('COMMIT');

// ---- report -----------------------------------------------------------------
const after = snap();
const L = []; const P = (s) => { console.log(s); L.push(s); };
const inObj = `unit_id IN (SELECT id FROM testimony_units WHERE object_id=${obj.id})`;
P('\nReconciliation report — Oerth Journal #12');
P(`  source family        : +${after.families - before.families} (${FAMILY}, periodical)`);
P(`  documentary object   : +${after.objects - before.objects} (questionnaire; publication dated, testimony not)`);
P(`  testimony units      : +${after.units - before.units} (expected 31, all UNTRANSCRIBED)`);
P(`  unit_context rows    : +${after.context - before.context} (expected 42: 31 question · 7 framing · 1 headnote · 3 caption)`);
P(`  discovery_text rows  : +${after.discovery - before.discovery} (expected 73 = 31 answers + 42 contexts)`);
P(`  evidence assets      : +${after.assets - before.assets} (23 crop + 8 stitched + 4 context cards)`);
P(`  provenance rows      : +${after.sources - before.sources}`);
P(`  coverage segments    : +${after.coverage - before.coverage} (Q&A complete; game-text sections excluded)`);
P(`  annotations          : +${after.annotations - before.annotations}`);
P(`  persons              : +${after.persons - before.persons} (${sbIsNew ? BYLINE + ', global' : 'none; ' + BYLINE + ' already held'})`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nConfirmations:');
ok('31 Gygax units, intermediary-quoted, retrospective, untranscribed',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND speaker_id=? AND evidence_relationship=? AND discourse_mode=? AND transcript_status='untranscribed' AND transcript=''`,
     obj.id, gygax.id, REL, MODE).c === 31);
ok('no verified transcript was added anywhere in the corpus', after.verified === before.verified);
ok('no unit claims a source question number (the article prints bare "Q:")',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND (unit_number IS NOT NULL OR unit_number_status<>'unknown')`, obj.id).c === 0);
ok('no testimony date on any unit; publication dates live on the object only',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND (date_value IS NOT NULL OR date_precision<>'unknown')`, obj.id).c === 0 &&
   g(`SELECT count(*) c FROM documentary_objects WHERE id=? AND date_from_value='2001' AND date_to_value='2002-07'`, obj.id).c === 1);
ok('42 context rows in the exact declared shape',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND context_type='interviewer_question'`).c === 31 &&
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND context_type='editorial_framing'`).c === 7 &&
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND context_type='headnote'`).c === 1 &&
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND context_type='caption'`).c === 3);
ok('39 Stormberg contexts; the 3 unattributed captions carry NO speaker',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND speaker_id=?`, sb.id).c === 39 &&
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND speaker_id IS NULL`).c === 3 &&
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND context_type='caption' AND speaker_id IS NOT NULL`).c === 0);
ok('no context row attributes anything to Gygax',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND speaker_id=?`, gygax.id).c === 0);
ok('every context row is empty and untranscribed (nothing here is verified)',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND (text<>'' OR text_status<>'untranscribed')`).c === 0);
ok('the bylined compiler is a GLOBAL identity, not a source-scoped handle',
   g(`SELECT count(*) c FROM persons WHERE id=? AND identity_scope IS NULL`, sb.id).c === 1);
ok('73 discovery rows: one Gygax answer per unit, one row per context',
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%Gygax answer%'`, obj.id).c === 31 &&
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%NOT Gygax testimony%'`, obj.id).c === 42);
ok('no Gygax-answer discovery row carries interviewer or editorial wording',
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%Gygax answer%' AND (text GLOB 'Q:*' OR text LIKE '%[PJS]%')`, obj.id).c === 0);
ok('23 crops + 8 stitched testimony cards + 4 context cards',
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='stitched'`).c === 8 &&
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='crop'`).c === 27);
ok('every context card is labelled as context, never as testimony evidence',
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj} AND display_order=2) AND original_locator NOT LIKE '%crop of CONTEXT%'`).c === 0 &&
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND display_order=2`).c === 4);
ok('every asset hash in the DB matches the staged file bytes',
   db.prepare(`SELECT asset_path, sha256 FROM evidence_assets WHERE ${inObj}`).all()
     .every((a) => existsSync(join(EVID, a.asset_path)) && shaFile(join(EVID, a.asset_path)) === a.sha256));
ok('every provenance row names an Oerth Journal page and clip',
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj}) AND original_locator NOT LIKE '%Oerth Journal%pt —%'`).c === 0);
ok('the Q31 inline interpolation is annotated as Stormberg\'s, not Gygax\'s',
   g(`SELECT count(*) c FROM annotations WHERE unit_id=? AND annotation_type='inline_editorial_interpolation'`, unitIds.get('Q31')).c === 1);

P('\nFTS behaviour (the §8 guarantee):');
ok('Gygax answer wording IS discoverable',
   g(`SELECT count(*) c FROM discovery_fts WHERE discovery_fts MATCH 'Theorparts OR oerthquake'`).c >= 1);
ok('the headnote provenance statement is discoverable as CONTEXT, not as testimony',
   g(`SELECT count(*) c FROM discovery_text d JOIN discovery_fts f ON f.rowid=d.id WHERE d.object_id=? AND discovery_fts MATCH '"essentially questionnaires"' AND d.source_locator LIKE '%headnote%'`, obj.id).c === 1 &&
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%Gygax answer%' AND text LIKE '%essentially questionnaires%'`, obj.id).c === 0);
ok('interviewer wording is NOT in Gygax transcript FTS',
   g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH '"Obsidian Citadel"'`).c === 0);
ok('this object contributes no transcript text at all',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND length(transcript)>0`, obj.id).c === 0);

P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('units_fts in sync with units', B('units_fts') === after.units);
ok('context_fts in sync with unit_context', B('context_fts') === after.context);
ok('discovery_fts in sync with discovery_text', B('discovery_fts') === after.discovery);

P('\nStitched cards requiring eyes-on acceptance before the build gate passes:');
for (const s of stitched) P(`  ${s.unit}  ${s.assetPath}  (${s.rep})  sha ${s.sha.slice(0, 12)}`);

db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-oerth-journal-12.log';
writeFileSync(logPath, ['Gygax corpus v2 — Oerth Journal #12, "Thus Spake Gary Gygax: Ye Secrets of Oerth Revealed"',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
