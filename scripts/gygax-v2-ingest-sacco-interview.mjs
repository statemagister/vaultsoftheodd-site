#!/usr/bin/env node
/*
 * gygax-v2-ingest-sacco-interview.mjs — ingest "The Ultimate Interview With Gary
 * Gygax", conducted by Ciro Alessandro Sacco of dungeons.it, published in
 * OD&DITIES #9 (Feb 2003, Part I) and #10 (Jul 2003, Part II), preserved here
 * through a 60-page The Kyngdoms browser-print PDF.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-sacco-interview.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * The largest single source in the corpus: 60 Gygax testimony units.
 *
 *   1. SIXTY UNITS, NOT FIFTY. Besides the 50 question responses, Gygax wrote
 *      an introduction of his own and nine interstitial statements under Sacco's
 *      section headings ("GARY GYGAX, THE MAN" -> "Does that mean you think I
 *      have grown up? Wrong!"). Those ten are his words and stay in the Gygax
 *      testimony layer; the headings above them are context.
 *
 *   2. DATES ONLY WHERE THE SOURCE EVIDENCES THEM. The interview demonstrably
 *      spans two years — Q41 says "later this year, in 2003", while Q49 places
 *      Comdex "this November" BEFORE an alpha test expected "early in 2003",
 *      so it was written before November 2002. Gygax's own introduction says he
 *      answered "in bits and pieces over a period of weeks". Those two units
 *      therefore carry a year; the other 58 carry no date at all, and the
 *      2002-2003 span lives on the documentary object.
 *
 *   3. NO SOURCE NUMBERING. The article prints no question numbers. SACCO_Q01
 *      etc. are preparation keys, so unit_number is NULL and status 'unknown'.
 *
 *   4. FOUR VOICES, KEPT APART. 50 interviewer_question (Sacco), 2 headnote
 *      (one The Kyngdoms republisher preface, one Sacco introduction) and 11
 *      editorial_framing headings that the source credits to nobody. The
 *      republisher preface speaks of Sacco in the third person — "presented here
 *      with HIS permission" — so it is not Sacco's, and the eleven headings get
 *      no speaker rather than an invented one.
 *
 *   5. TWO INLINE EDITORIAL INTERPOLATIONS. "(the first big sci-fi role playing
 *      game N.d.R.)" in Q06 and "(Amazing! N.d.R.)" in Q21 are printed inside
 *      Gygax's answers and cannot be separated without departing from the
 *      source. They stay verbatim, annotated with exact character offsets.
 *
 * 60 cards = 25 source-native page crops + 35 stitched across preservation
 * pagination (50 joins, some cards spanning four pages). Every join was verified
 * continuous; the browser-print footer is excluded at each one.
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
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-sacco-interview.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const units = jsonl(join(PKG, 'cards', 'manifest.jsonl'));
const ctxRows = jsonl(join(PKG, 'context_segments.jsonl'));
const unitAnns = jsonl(join(PKG, 'unit_annotations.jsonl'));

// ---- validate ---------------------------------------------------------------
const problems = [];
const EXPECT = { units: 60, answers: 50, intro: 1, headnotes: 9, contexts: 63, questions: 50, framing: 11, headnote: 2, crops: 25, stitched: 35, joins: 50, anns: 2 };
const FAMILY = 'Dungeons.it', FAMILY_KIND = 'other';
const REL = 'direct_quotation_by_intermediary', MODE = 'retrospective_commentary';
const INTERVIEWER = 'Ciro Alessandro Sacco';
const REPUBLISHER = 'The Kyngdoms (republisher)';
const CTX_VOCAB = new Set(['interviewer_question', 'quoted_question', 'editorial_framing', 'headnote', 'caption']);
const SPAN = '2002-2003';

if (units.length !== EXPECT.units) problems.push(`expected ${EXPECT.units} units, found ${units.length}`);
if (ctxRows.length !== EXPECT.contexts) problems.push(`expected ${EXPECT.contexts} context rows, found ${ctxRows.length}`);
if (unitAnns.length !== EXPECT.anns) problems.push(`expected ${EXPECT.anns} unit annotations, found ${unitAnns.length}`);

const byKey = new Map(units.map((u) => [u.preparation_key, u]));
const roleCount = {}; let nCrop = 0, nStitch = 0, nJoin = 0, nDated = 0;
for (const u of units) {
  const k = u.preparation_key;
  roleCount[u.unit_role] = (roleCount[u.unit_role] || 0) + 1;
  if (u.source_family !== FAMILY) problems.push(`${k}: source_family ${u.source_family}`);
  if (u.source_family_kind !== FAMILY_KIND) problems.push(`${k}: source_family_kind "${u.source_family_kind}" is outside the frozen vocabulary`);
  if (u.documentary_object_kind !== 'interview') problems.push(`${k}: object kind ${u.documentary_object_kind}`);
  if (u.evidence_relationship !== REL) problems.push(`${k}: evidence_relationship ${u.evidence_relationship}`);
  if (u.discourse_mode !== MODE) problems.push(`${k}: discourse_mode ${u.discourse_mode}`);
  if (u.transcript_status !== 'untranscribed') problems.push(`${k}: transcript_status ${u.transcript_status}`);
  if (u.unit_number !== null) problems.push(`${k}: unit_number claimed but the source prints none`);
  if (u.object_testimony_span !== SPAN) problems.push(`${k}: object_testimony_span ${u.object_testimony_span}`);
  if (!(u.discovery_text || '').trim()) problems.push(`${k}: empty Gygax discovery text`);
  // dates: a year only where the unit itself evidences one
  if (u.testimony_date_value) {
    nDated++;
    if (!/^(2002|2003)$/.test(u.testimony_date_value)) problems.push(`${k}: date ${u.testimony_date_value} outside the attested span`);
    if (u.date_precision !== 'year') problems.push(`${k}: dated unit with precision ${u.date_precision}`);
    if (!(u.date_basis || '').trim()) problems.push(`${k}: dated unit with no stated basis`);
  } else if (u.date_precision !== 'unknown') problems.push(`${k}: undated unit with precision ${u.date_precision}`);

  if (u.evidence_asset_count !== 1 || u.evidence_assets.length !== 1) problems.push(`${k}: ${u.evidence_assets.length} assets; the visual rule is one card per unit`);
  const a = u.evidence_assets[0];
  const f = join(PKG, a.asset_path);
  if (!existsSync(f)) { problems.push(`${k}: missing card ${a.asset_path}`); continue; }
  const h = shaFile(f);
  if (h !== a.sha256 || h !== u.evidence_asset_sha256) problems.push(`${k}: card bytes do not match the manifest hash`);
  const ps = a.source_portions;
  if (ps.length > 1) { nStitch++; nJoin += ps.length - 1; } else nCrop++;
  if (u.reconstructed !== (ps.length > 1)) problems.push(`${k}: reconstructed=${u.reconstructed} contradicts ${ps.length} portion(s)`);
  // stitch geometry: the card is exactly its portions, so nothing was padded in
  const tot = ps.reduce((s, p) => s + p.trimmed_size[1], 0);
  if (tot !== a.height) problems.push(`${k}: card height ${a.height} != summed portion heights ${tot} (padding at a join?)`);
  for (const p of ps) {
    if (!Array.isArray(p.clip_pdf_points) || p.clip_pdf_points.length !== 4) problems.push(`${k}: portion ${p.order} has no clip box`);
    if ('source_asset_path' in p || 'source_asset_sha256' in p) problems.push(`${k}: portion ${p.order} still carries an unverifiable derivative reference`);
    if (!Number.isInteger(p.source_page)) problems.push(`${k}: portion ${p.order} without an integer source page`);
  }
  // attribution: no interviewer or heading wording inside Gygax discovery
  if (/(?:^|\n)\s*Q\s*:/.test(u.discovery_text)) problems.push(`${k}: Gygax discovery carries a question label`);
}
if (nCrop !== EXPECT.crops) problems.push(`crops ${nCrop} != expected ${EXPECT.crops}`);
if (nStitch !== EXPECT.stitched) problems.push(`stitched ${nStitch} != expected ${EXPECT.stitched}`);
if (nJoin !== EXPECT.joins) problems.push(`joins ${nJoin} != expected ${EXPECT.joins}`);
if (roleCount.answer !== EXPECT.answers || roleCount.intro !== EXPECT.intro || roleCount.section_headnote !== EXPECT.headnotes)
  problems.push(`unit roles ${JSON.stringify(roleCount)} != 50 answer + 1 intro + 9 section_headnote`);
if (nDated !== 2) problems.push(`${nDated} units carry a year; only the two internally evidenced units should`);

const ctxCount = {}; const ctxByUnit = new Map();
for (const c of ctxRows) {
  const k = `${c.testimony_unit}/${c.context_sequence}`;
  if (!CTX_VOCAB.has(c.context_type)) { problems.push(`${k}: context_type "${c.context_type}" outside the frozen vocabulary`); continue; }
  ctxCount[c.context_type] = (ctxCount[c.context_type] || 0) + 1;
  if (!byKey.has(c.testimony_unit)) problems.push(`${k}: context attached to an unknown unit`);
  if ((c.unit_context_text || '') !== '') problems.push(`${k}: context supplies verified text; nothing here is verified`);
  if (!(c.discovery_text || '').trim()) problems.push(`${k}: empty context discovery text`);
  if (c.context_type === 'interviewer_question' && c.speaker_label !== INTERVIEWER) problems.push(`${k}: question speaker ${c.speaker_label}`);
  if (c.context_type === 'editorial_framing' && c.speaker_label !== null) problems.push(`${k}: heading claims a speaker the source does not credit`);
  for (const a of c.evidence_assets || []) {
    const f = join(PKG, a.asset_path);
    if (!existsSync(f)) { problems.push(`${k}: missing context card ${a.asset_path}`); continue; }
    if (shaFile(f) !== a.sha256) problems.push(`${k}: context card bytes do not match the manifest hash`);
    if (!Array.isArray(a.clip_pdf_points)) problems.push(`${k}: context card without a clip box`);
  }
  const arr = ctxByUnit.get(c.testimony_unit) || []; arr.push(c); ctxByUnit.set(c.testimony_unit, arr);
}
for (const [t, n] of Object.entries({ interviewer_question: EXPECT.questions, editorial_framing: EXPECT.framing, headnote: EXPECT.headnote }))
  if (ctxCount[t] !== n) problems.push(`context_type ${t}: ${ctxCount[t] || 0} != expected ${n}`);
for (const [k, arr] of ctxByUnit) {
  const s = arr.map((c) => c.context_sequence).sort((a, b) => a - b);
  if (s.join(',') !== s.map((_, i) => i + 1).join(',')) problems.push(`${k}: context_sequence not contiguous (${s.join(',')})`);
}
// the republisher preface must NOT be attributed to Sacco
const pref = ctxRows.find((c) => /presented here with his permission/i.test(c.discovery_text));
if (!pref) problems.push('the republisher preface is not represented');
else if (pref.speaker_label !== REPUBLISHER) problems.push(`the republisher preface is attributed to "${pref.speaker_label}"; it speaks of Sacco in the third person`);

for (const a of unitAnns) {
  const u = byKey.get(a.testimony_unit);
  if (!u) { problems.push(`annotation for unknown unit ${a.testimony_unit}`); continue; }
  if (u.discovery_text.slice(a.start_offset, a.end_offset) !== a.text) problems.push(`${a.testimony_unit}: annotation offsets do not select the quoted interpolation`);
}
// the annotation set must be exhaustive
const ndr = units.filter((u) => /N\.?d\.?R\.?/.test(u.discovery_text)).map((u) => u.preparation_key);
if (ndr.length !== unitAnns.length) problems.push(`${ndr.length} units contain "N.d.R." but only ${unitAnns.length} are annotated`);

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
console.log(`Sacco "Ultimate Interview" — package verified under schema ${SCHEMA.version}`);
console.log(`  ${sums.size} files checksum-verified · ${units.length} units (50 answers + 1 Gygax intro + 9 interstitials) · ${nCrop} crops + ${nStitch} stitched over ${nJoin} joins`);
console.log(`  ${ctxRows.length} context rows: ${ctxCount.interviewer_question} question · ${ctxCount.editorial_framing} heading · ${ctxCount.headnote} headnote · ${unitAnns.length} inline interpolations annotated`);

// ---- ingest -----------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const B = (t) => g(`SELECT count(*) c FROM ${t}`).c;
const snap = () => ({ objects: B('documentary_objects'), units: B('testimony_units'), context: B('unit_context'),
  assets: B('evidence_assets'), sources: B('evidence_sources'), coverage: B('coverage'), persons: B('persons'),
  discovery: B('discovery_text'), families: B('source_families'), annotations: B('annotations'),
  verified: g(`SELECT count(*) c FROM testimony_units WHERE transcript_status='verified'`).c });
const before = snap();

db.exec('BEGIN');
const gygax = g(`SELECT id FROM persons WHERE name='Gary Gygax' AND identity_scope IS NULL`);
if (!gygax) { db.exec('ROLLBACK'); die('speaker "Gary Gygax" not found — run the v1 migration first.'); }

// Sacco is a NAMED individual (bylined interviewer), so a GLOBAL identity.
let sacco = g(`SELECT id FROM persons WHERE name=? AND identity_scope IS NULL`, INTERVIEWER);
const saccoIsNew = !sacco;
if (!sacco) sacco = { id: Number(db.prepare(`INSERT INTO persons(name,identity_scope,notes) VALUES (?,NULL,?)`)
  .run(INTERVIEWER, 'Named individual: of dungeons.it; conducted the "Ultimate Interview" questionnaire with Gygax and co-edited it with him. Globally identified, not a source-scoped handle.').lastInsertRowid) };

const m0 = units[0];
let fam = g(`SELECT id FROM source_families WHERE name=?`, FAMILY);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes) VALUES (?,?,?)`).run(
  FAMILY, FAMILY_KIND, `Ciro Alessandro Sacco's Italian gaming site, the interview's originating venue. Typed 'other': the frozen vocabulary has no 'website' term. First publication was in OD&DITIES; the surviving witness held here is a ${m0.preserved_manifestation}.`).lastInsertRowid) };

const TITLE = m0.documentary_object;
let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title=?`, fam.id, TITLE);
if (obj && !FORCE) { db.exec('ROLLBACK'); die(`object "${TITLE}" already present; use --force on a clean DB.`); }
const PUBS = m0.publication_manifestations.join('; ');
// The object's dates are the TESTIMONY span, which the source evidences at both ends.
// Publication and preservation dates are provenance and stay in citation/notes.
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,date_display,date_from_value,date_to_value,date_precision,date_timezone,venue,citation,identifier,notes)
  VALUES (?,?,'interview',?, '2002','2003','year',NULL,?,?,?,?)`).run(
  fam.id, TITLE, `answered ${SPAN}; published ${PUBS}`, FAMILY,
  `Ciro Alessandro Sacco, "${TITLE}", ${PUBS}.`, m0.preserved_manifestation,
  `Sacco put a written questionnaire to Gygax and the two of them edited the result together. Gygax's own introduction says he answered "in bits and pieces over a period of weeks", and the answers evidence both years: one places a Lejendary Adventure release "later this year, in 2003", another places a Comdex demonstration "this November" BEFORE an alpha test expected "early in 2003", so it was written before November 2002. Only those two units carry a year; the rest carry none. Publication was ${PUBS}; the surviving witness is a ${m0.preserved_manifestation} whose browser-print footer records ${m0.preservation_render_date} — a render date, not a testimony or publication date.`).lastInsertRowid) };
if (g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c > 0 && !FORCE) { db.exec('ROLLBACK'); die('this object already holds testimony units.'); }

const insUnit = db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
   speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
  VALUES (?,?,NULL,'unknown',?,?,?,NULL,?,?,?,?,'','untranscribed',?,'pdf_text_extraction',?)`);
const insCtx = db.prepare(`INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status,sequence) VALUES (?,?,?,'','untranscribed',?)`);
const insDisc = db.prepare(`INSERT INTO discovery_text(object_id,segment_label,source_type,source_locator,text,unit_id) VALUES (?,?,'pdf_text_extraction',?,?,?)`);
const insAsset = db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,?,?,?)`);
const insSrc = db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,capture_date_display,capture_date_value,capture_date_precision) VALUES (?,?,'pdf_page',?,?,'day')`);
const insAnn = db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?,?,?)`);

const DIR = 'evidence/dungeons-it/ultimate-interview/';
const ROLE = { answer: 'reply to interviewer question', intro: "Gygax's own introduction to the interview", section_headnote: 'Gygax interstitial statement under a section heading' };
const CTX_LABEL = {
  interviewer_question: `question put by ${INTERVIEWER} (NOT Gygax testimony)`,
  headnote: 'headnote (NOT Gygax testimony)',
  editorial_framing: 'printed section heading, credited to nobody in the source (NOT Gygax testimony)',
};
const stitched = []; const unitIds = new Map();
const stage = (rel, src) => { const d = join(EVID, rel); mkdirSync(dirname(d), { recursive: true }); copyFileSync(src, d); };

for (const u of [...units].sort((a, b) => a.sequence_in_object - b.sequence_in_object)) {
  const k = u.preparation_key;
  const pages = u.source_pages.join('-');
  const locator = `${m0.preserved_manifestation} of "${TITLE}", p.${pages}; ${ROLE[u.unit_role]} ${u.sequence_in_object} of ${units.length} in article order (the source prints no question numbers)`;
  const uid = Number(insUnit.run(obj.id, u.sequence_in_object,
    u.testimony_date_value ? `${u.testimony_date_value} (${u.date_basis})` : `answered ${SPAN}; this unit's year is not determinable`,
    u.testimony_date_value || null, u.date_precision, gygax.id, gygax.id, REL, MODE, u.completeness, locator).lastInsertRowid);
  unitIds.set(k, uid);
  insDisc.run(obj.id, k, `${locator}; Gygax words`, u.discovery_text.trim(), uid);

  let order = 1;
  const a = u.evidence_assets[0];
  const h = shaFile(join(PKG, a.asset_path));
  const aid = Number(insAsset.run(uid, DIR + basename(a.asset_path), order++, a.source_portions.length > 1 ? 'stitched' : 'crop', h).lastInsertRowid);
  for (const p of a.source_portions) {
    const what = a.source_portions.length > 1
      ? `portion ${p.order} of ${a.source_portions.length} — one testimony unit interrupted by preservation pagination; the browser-print footer is excluded at the join`
      : 'source-native crop of one preservation page region';
    insSrc.run(aid, `${m0.preserved_manifestation} PDF p.${p.source_page}, clip [${p.clip_pdf_points.join(', ')}] pt — ${what}`,
      m0.preservation_render_date, m0.preservation_render_date);
  }
  stage(DIR + basename(a.asset_path), join(PKG, a.asset_path));
  if (a.source_portions.length > 1) stitched.push({ unit: k, assetPath: DIR + basename(a.asset_path), sha: h, joins: a.source_portions.length - 1, pages });

  for (const c of (ctxByUnit.get(k) || []).sort((x, y) => x.context_sequence - y.context_sequence)) {
    // Sacco is a person; the republisher and the printed headings are not, and the
    // schema has no non-person speaker — so their identification stays in the
    // provenance label rather than becoming a fabricated persons row.
    const speaker = c.speaker_label === INTERVIEWER ? sacco.id : null;
    insCtx.run(uid, c.context_type, speaker, c.context_sequence);
    const who = c.speaker_label ? ` [${c.speaker_label}]` : ' [credited to nobody in the source]';
    insDisc.run(obj.id, k, `${locator}; ${CTX_LABEL[c.context_type]}${who}`, c.discovery_text.trim(), uid);
    for (const ca of c.evidence_assets || []) {
      const ch = shaFile(join(PKG, ca.asset_path));
      const caid = Number(insAsset.run(uid, DIR + basename(ca.asset_path), order++, 'crop', ch).lastInsertRowid);
      insSrc.run(caid, `${m0.preserved_manifestation} PDF p.${ca.source_page}, clip [${ca.clip_pdf_points.join(', ')}] pt — source-native crop of CONTEXT (${c.context_type}), not Gygax testimony`,
        m0.preservation_render_date, m0.preservation_render_date);
      stage(DIR + basename(ca.asset_path), join(PKG, ca.asset_path));
    }
  }
}

db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,coverage_status,known_loss,detail,sort_order)
  VALUES (?, 'Complete interview (preservation pp.1-60)','page_range','complete',0,?,1)`).run(obj.id,
  'The whole article is preserved: republisher preface, both introductions, all nine section headings with the Gygax statements under them, and all fifty question-and-answer exchanges. Complete AS PRESERVED — the underlying email questionnaire itself is not held, and Gygax remarks that he could not answer every question as fully as he wished.');

const u1 = unitIds.get(units[0].preparation_key);
insAnn.run(u1, 'date_limitation',
  `The interview spans ${SPAN} and no single date fits it. Gygax's introduction says he answered "in bits and pieces over a period of weeks". Two units date themselves and carry a year accordingly; the other 58 carry none, so no query can assign them a year the source does not give. February and July 2003 are PUBLICATION dates (${PUBS}) and ${m0.preservation_render_date} is the browser-print render date of the surviving copy — all provenance, none of it testimony dating.`);
insAnn.run(u1, 'attribution',
  `Four voices are kept apart. Fifty questions are Sacco's. The page-one preface — "This interview was conducted by Ciro Alessandro Sacco of www.dungeons.it. It is presented here with his permission." — speaks of Sacco in the THIRD PERSON and is the republisher's, not his; it is held as a separate headnote. Sacco's own first-person introduction is a second headnote. The eleven printed headings are credited to nobody and carry no speaker. Neither the republisher nor a printed heading is a person, and the schema has no non-person speaker, so those identifications live in the provenance labels rather than in invented persons rows.`);
insAnn.run(u1, 'unit_scope',
  'Sixty units, not fifty. Besides the 50 replies, Gygax wrote his own introduction and nine interstitial statements under Sacco\'s section headings — for example under "GARY GYGAX, THE MAN" he writes "Does that mean you think I have grown up? Wrong!" Those are his words and belong in the Gygax layer; the headings above them are context.');
insAnn.run(u1, 'unit_numbering',
  'The article prints no question numbers. The SACCO_* keys are preparation sequence, so unit_number is NULL and unit_number_status \'unknown\'; ordering lives in sequence_in_object, which the schema defines as an ordering key rather than a historical claim.');
insAnn.run(u1, 'evidence_relationship',
  'Gygax answered a written questionnaire that Sacco then edited jointly with him and published; what survives here is a later web republication of that. The relationship is therefore direct_quotation_by_intermediary, and word-for-word fidelity to whatever Gygax originally sent has not been independently collated.');
insAnn.run(u1, 'context_evidence',
  'Fourteen context cards (the republisher preface, both introduction headings, Sacco\'s introduction, and the nine section headings) are evidence for CONTEXT rows, not for Gygax testimony. The frozen schema binds evidence_assets to a testimony unit with no unit_context-scoped home, so each hangs off the unit it is documentarily adjacent to and says so in its provenance locator. Same gap already recorded for GameSpy, A&E #15 and Oerth Journal #12 — recorded, not amended.');
insAnn.run(u1, 'external_verification',
  `Publication in ${PUBS} is independently attested by preserved copies of those issues; the issue editorial states the interview is being published in two parts. Not independently verified: the exact dates of the underlying exchange, and fidelity of the republished text to what Gygax sent.`);
for (const a of unitAnns)
  insAnn.run(unitIds.get(a.testimony_unit), 'inline_editorial_interpolation',
    `${a.note} The bracketed aside is ${a.speaker_label}. Interpolated text, verbatim: "${a.text.replace(/\s+/g, ' ')}" (characters ${a.start_offset}-${a.end_offset} of this unit's discovery text). It is printed inside Gygax's answer and cannot be separated without departing from the source, so the card and discovery string stay verbatim; do not cite the parenthetical as Gygax's wording.`);

db.exec('COMMIT');

// ---- report -----------------------------------------------------------------
const after = snap();
const L = []; const P = (s) => { console.log(s); L.push(s); };
const inObj = `unit_id IN (SELECT id FROM testimony_units WHERE object_id=${obj.id})`;
P('\nReconciliation report — Sacco "The Ultimate Interview With Gary Gygax"');
P(`  source family        : +${after.families - before.families} (${FAMILY}, ${FAMILY_KIND})`);
P(`  documentary object   : +${after.objects - before.objects} (interview; testimony span ${SPAN})`);
P(`  testimony units      : +${after.units - before.units} (expected 60 = 50 answers + 1 intro + 9 interstitials)`);
P(`  unit_context rows    : +${after.context - before.context} (expected 63)`);
P(`  discovery_text rows  : +${after.discovery - before.discovery} (expected 123 = 60 Gygax + 63 context)`);
P(`  evidence assets      : +${after.assets - before.assets} (25 crop + 35 stitched + 14 context cards)`);
P(`  provenance rows      : +${after.sources - before.sources} (expected 124 = 110 unit portions + 14 context)`);
P(`  coverage segments    : +${after.coverage - before.coverage}`);
P(`  annotations          : +${after.annotations - before.annotations}`);
P(`  persons              : +${after.persons - before.persons} (${saccoIsNew ? INTERVIEWER + ', global' : 'none; ' + INTERVIEWER + ' already held'})`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nConfirmations:');
ok('60 Gygax units, intermediary-quoted, retrospective, untranscribed',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND speaker_id=? AND evidence_relationship=? AND discourse_mode=? AND transcript_status='untranscribed' AND transcript=''`, obj.id, gygax.id, REL, MODE).c === 60);
ok('no verified transcript was added anywhere in the corpus', after.verified === before.verified);
ok('no unit claims a source question number', g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND (unit_number IS NOT NULL OR unit_number_status<>'unknown')`, obj.id).c === 0);
ok('exactly 2 units carry a year, and only the two the source evidences',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND date_value IS NOT NULL`, obj.id).c === 2 &&
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND date_value IN ('2002','2003') AND date_precision='year'`, obj.id).c === 2 &&
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND date_value IS NULL AND date_precision='unknown'`, obj.id).c === 58);
ok('the object carries the 2002-2003 span, not a publication date',
   g(`SELECT count(*) c FROM documentary_objects WHERE id=? AND date_from_value='2002' AND date_to_value='2003' AND date_precision='year'`, obj.id).c === 1);
ok('63 context rows in the exact declared shape',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND context_type='interviewer_question'`).c === 50 &&
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND context_type='editorial_framing'`).c === 11 &&
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND context_type='headnote'`).c === 2);
ok('51 Sacco contexts; the 12 uncredited rows carry NO speaker',
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND speaker_id=?`, sacco.id).c === 51 &&
   g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND speaker_id IS NULL`).c === 12);
ok('the republisher preface is NOT attributed to Sacco',
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND text LIKE '%presented here with his permission%' AND source_locator LIKE '%The Kyngdoms (republisher)%'`, obj.id).c === 1 &&
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND text LIKE '%presented here with his permission%' AND source_locator LIKE '%question put by%'`, obj.id).c === 0);
ok('no context row attributes anything to Gygax', g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND speaker_id=?`, gygax.id).c === 0);
ok('every context row is empty and untranscribed', g(`SELECT count(*) c FROM unit_context WHERE ${inObj} AND (text<>'' OR text_status<>'untranscribed')`).c === 0);
ok('the interviewer is a GLOBAL identity, not a source-scoped handle', g(`SELECT count(*) c FROM persons WHERE id=? AND identity_scope IS NULL`, sacco.id).c === 1);
ok('123 discovery rows split 60 Gygax / 63 context',
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%Gygax words%'`, obj.id).c === 60 &&
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%NOT Gygax testimony%'`, obj.id).c === 63);
ok('25 crops + 35 stitched + 14 context cards; 50 joins recorded',
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='stitched'`).c === 35 &&
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='crop'`).c === 39 &&
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj} AND asset_type='stitched')`).c === 85);
ok('every provenance row carries a page and a PDF clip box',
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj}) AND original_locator NOT LIKE '%clip [%] pt%'`).c === 0);
ok('every asset hash in the DB matches the staged file bytes',
   db.prepare(`SELECT asset_path, sha256 FROM evidence_assets WHERE ${inObj}`).all()
     .every((a) => existsSync(join(EVID, a.asset_path)) && shaFile(join(EVID, a.asset_path)) === a.sha256));
ok('both inline N.d.R. interpolations are annotated as editorial, not Gygax',
   g(`SELECT count(*) c FROM annotations WHERE annotation_type='inline_editorial_interpolation' AND unit_id IN (SELECT id FROM testimony_units WHERE object_id=?)`, obj.id).c === 2);

P('\nFTS behaviour (the §8 guarantee):');
ok('Gygax wording IS discoverable', g(`SELECT count(*) c FROM discovery_fts WHERE discovery_fts MATCH 'Lejendary'`).c >= 1);
ok('the Gygax interstitial statements are in the Gygax layer, not context',
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%Gygax words%' AND text LIKE '%Does that mean you think I have grown up%'`, obj.id).c === 1);
ok('the section HEADING is context, not testimony',
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND text='GARY GYGAX, THE MAN' AND source_locator LIKE '%NOT Gygax testimony%'`, obj.id).c === 1 &&
   g(`SELECT count(*) c FROM discovery_text WHERE object_id=? AND source_locator LIKE '%Gygax words%' AND text LIKE 'GARY GYGAX, THE MAN%'`, obj.id).c === 0);
ok('interviewer wording is NOT in Gygax transcript FTS', g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH '"paranormal experiences"'`).c === 0);
ok('this object contributes no transcript text at all', g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND length(transcript)>0`, obj.id).c === 0);

P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('units_fts in sync with units', B('units_fts') === after.units);
ok('context_fts in sync with unit_context', B('context_fts') === after.context);
ok('discovery_fts in sync with discovery_text', B('discovery_fts') === after.discovery);

P(`\n${stitched.length} stitched cards (${stitched.reduce((s, x) => s + x.joins, 0)} joins) requiring eyes-on acceptance before the build gate passes.`);

db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
writeFileSync(join(dirname(DB_PATH), 'sacco-stitched.json'), JSON.stringify(stitched, null, 1));
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-sacco-interview.log';
writeFileSync(logPath, ['Gygax corpus v2 — Sacco / Dungeons.it "The Ultimate Interview With Gary Gygax"',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
