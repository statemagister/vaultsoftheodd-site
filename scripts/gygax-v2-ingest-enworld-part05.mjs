#!/usr/bin/env node
/*
 * gygax-v2-ingest-enworld-part05.mjs — ingest the complete Part V preservation
 * segment of the ENWorld "Q&A with Gary Gygax" thread (Col_Pladoh), 10 December
 * 2003 to 9 February 2004.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-enworld-part05.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * This EXTENDS an object the corpus already holds. Part V is a coverage
 * SEGMENT of the single "Q&A with Gary Gygax" thread, not a new documentary
 * object, so the ingester refuses to run unless the existing family and object
 * are found — creating a second "EN World" family or "Gary Gygax Q&A" object
 * would split the corpus's largest thread in two. New units continue the
 * existing sequence_in_object; the Part V coverage row (v1 status: "No complete
 * local source ingested") is rewritten to what is now held.
 *
 * NEW IN THIS SEGMENT: where the preserved antecedent post header and the
 * source-native vBulletin quote label DISAGREE, the antecedent is canonical and
 * the label is kept only as linkage evidence. Two cases here, both verified
 * against the PDF: the quoted words appear verbatim under the antecedent header
 * at an earlier timestamp, and neither phrase appears anywhere in the corpus
 * attributed to the label handle. Attributing to the label would have credited
 * a prompt to the wrong participant.
 *
 * Established Part-V-specific facts, each verified before this ran:
 *
 *   - 97 Gary posts out of 214 printable-view posts; the rest are participants'.
 *   - No overlap with the corpus: no existing unit cites Part V, and none falls
 *     inside the 10 Dec 2003 - 9 Feb 2004 window. Part IV ends 9 Dec 00:14.
 *   - The thread prints no post numbers usable as historical numbering, so
 *     unit_number stays NULL / 'unknown' and the printable-view position is a
 *     LOCATOR only. Current-site numbers are deferred to a later reconciliation.
 *   - Gary's own text is often NON-CONTIGUOUS in the source: a post may carry
 *     several quote boxes with his replies between them. Discovery holds his
 *     words only; each quoted prompt gets its own context row.
 *   - Handles are source-scoped identities (identity_scope 'ENWorld Q&A'), reused
 *     where already held. An unattributed quote-back carries NO speaker.
 *
 * 97 cards = 71 source-native crops + 26 stitched across printable pagination
 * (26 joins). The stitches are content-affecting reconstructions and must pass
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
const [DB_PATH, PKG, EVID] = args.filter((a) => !a.startsWith('--'));
if (!DB_PATH || !PKG || !EVID) {
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-enworld-part05.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const NUL = String.fromCharCode(0), REPLACEMENT = String.fromCharCode(0xfffd);
// Defensive only: this package sanitised its two control characters upstream. A NUL
// binds to SQLite TEXT as a terminator and would silently truncate the rest of a row.
const clean = (s) => String(s || '').split(NUL).join(REPLACEMENT);

const units = jsonl(join(PKG, 'cards', 'manifest.jsonl'));
const ctxRows = jsonl(join(PKG, 'context_segments.jsonl'));
const COV = JSON.parse(readFileSync(join(PKG, 'COVERAGE.json'), 'utf8'));

// ---- validate ---------------------------------------------------------------
const problems = [];
const EXPECT = { units: 97, contexts: 121, crops: 71, stitched: 26, portions: 123, posts: 214 };
const FAMILY = 'ENWorld Q&A', TITLE = 'Q&A with Gary Gygax', SEGMENT = 'Part V';
const HANDLE_SCOPE = FAMILY;
const MONTH = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
// "Sunday, 6th April, 2003, 06:29 PM" -> "2003-04-06T18:29"
function isoDate(display) {
  const m = /^\w+day,\s*(\d{1,2})\w*\s+(\w+),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(String(display || '').trim());
  if (!m) return null;
  const mo = MONTH[m[2].toLowerCase()]; if (!mo) return null;
  let h = Number(m[4]) % 12; if (/pm/i.test(m[6])) h += 12;
  return `${m[3]}-${mo}-${String(m[1]).padStart(2, '0')}T${String(h).padStart(2, '0')}:${m[5]}`;
}

if (units.length !== EXPECT.units) problems.push(`expected ${EXPECT.units} units, found ${units.length}`);
if (ctxRows.length !== EXPECT.contexts) problems.push(`expected ${EXPECT.contexts} context rows, found ${ctxRows.length}`);
if (COV.printable_posts_total !== EXPECT.posts) problems.push(`coverage claims ${COV.printable_posts_total} printable posts, expected ${EXPECT.posts}`);

const byKey = new Map(units.map((u) => [u.preparation_key, u]));
const seenLoc = new Set();
let nCrop = 0, nStitch = 0, nPort = 0, nJoin = 0;
for (const u of units) {
  const k = u.preparation_key;
  if (u.source_family !== FAMILY) problems.push(`${k}: source_family "${u.source_family}" — Part V must extend the existing family, not create one`);
  if (u.documentary_object !== TITLE) problems.push(`${k}: documentary_object "${u.documentary_object}" — Part V must extend the existing object, not create one`);
  if (u.preservation_segment !== SEGMENT) problems.push(`${k}: preservation_segment ${u.preservation_segment}`);
  if (u.account_or_byline !== 'Col_Pladoh') problems.push(`${k}: byline ${u.account_or_byline}`);
  if (u.speaker_display !== 'Gary Gygax') problems.push(`${k}: speaker_display ${u.speaker_display}`);
  if (u.evidence_relationship !== 'direct') problems.push(`${k}: evidence_relationship ${u.evidence_relationship}`);
  if (u.discourse_mode !== 'commentary') problems.push(`${k}: discourse_mode ${u.discourse_mode}`);
  if (u.transcript_status !== 'untranscribed') problems.push(`${k}: transcript_status ${u.transcript_status}`);
  // the package may express "no number" as an absent key or an explicit null; either
  // is fine, but a VALUE would be a historical claim the printable view cannot support
  if (u.unit_number != null || u.external_record_number != null)
    problems.push(`${k}: a post number is claimed, but the printable view prints none usable as historical numbering`);
  if (u.external_record_number_status !== 'unknown_pending_current_site_reconciliation')
    problems.push(`${k}: external_record_number_status ${u.external_record_number_status}`);
  if (!isoDate(u.testimony_date_value)) problems.push(`${k}: unparseable date "${u.testimony_date_value}"`);
  if (u.date_precision !== 'minute') problems.push(`${k}: date_precision ${u.date_precision}`);
  if (!(u.discovery_text || '').trim()) problems.push(`${k}: empty Gygax discovery text`);
  if (!/^P05:post\d{4}$/.test(u.source_locator)) problems.push(`${k}: unrecognised locator ${u.source_locator}`);
  if (seenLoc.has(u.source_locator)) problems.push(`${k}: duplicate locator ${u.source_locator}`); seenLoc.add(u.source_locator);

  if (u.evidence_asset_count !== 1 || u.evidence_assets.length !== 1) problems.push(`${k}: ${u.evidence_assets.length} assets; one Gary post is one card`);
  const a = u.evidence_assets[0];
  const f = join(PKG, a.asset_path);
  if (!existsSync(f)) { problems.push(`${k}: missing card ${a.asset_path}`); continue; }
  const h = shaFile(f);
  if (h !== a.sha256 || h !== u.evidence_asset_sha256) problems.push(`${k}: card bytes do not match the manifest hash`);
  const ps = a.source_portions;
  nPort += ps.length;
  if (ps.length > 1) { nStitch++; nJoin += ps.length - 1; } else nCrop++;
  if (u.reconstructed !== (ps.length > 1)) problems.push(`${k}: reconstructed=${u.reconstructed} contradicts ${ps.length} portion(s)`);
  const wantRep = ps.length > 1 ? 'source_native_stitch' : 'source_native_crop';
  if (u.representation !== wantRep) problems.push(`${k}: representation ${u.representation} contradicts ${ps.length} portion(s)`);
  // geometry: the card IS its portions, so nothing was padded in at a join
  const tot = ps.reduce((s, p) => s + p.trimmed_size[1], 0);
  if (tot !== a.height) problems.push(`${k}: card height ${a.height} != summed portion heights ${tot}`);
  for (const p of ps) {
    if (!Array.isArray(p.clip_pdf_points) || p.clip_pdf_points.length !== 4) problems.push(`${k}: portion ${p.order} has no clip box`);
    if (!Number.isInteger(p.source_page)) problems.push(`${k}: portion ${p.order} without an integer source page`);
  }
  // attribution: Gary's discovery must not carry a quoted prompt or forum furniture
  if (/(?:^|\n)\s*Quote:\s*$/m.test(u.discovery_text)) problems.push(`${k}: Gygax discovery carries a vBulletin "Quote:" marker`);
  if (/Originally posted by/i.test(u.discovery_text)) problems.push(`${k}: Gygax discovery carries a quote-back attribution line`);
  if (/(?:^|\n)\s*Page \d+ of \d+\s*(?:\n|$)/.test(u.discovery_text)) problems.push(`${k}: Gygax discovery carries printable-page navigation`);
}
if (nCrop !== EXPECT.crops) problems.push(`crops ${nCrop} != expected ${EXPECT.crops}`);
if (nStitch !== EXPECT.stitched) problems.push(`stitched ${nStitch} != expected ${EXPECT.stitched}`);
if (nPort !== EXPECT.portions) problems.push(`portions ${nPort} != expected ${EXPECT.portions}`);

const ctxByUnit = new Map();
let nAttr = 0, nUnattr = 0;
for (const c of ctxRows) {
  const k = c.preparation_key;
  if (!byKey.has(k)) { problems.push(`context for unknown unit ${k}`); continue; }
  if (c.context_type !== 'quoted_question') problems.push(`${k}: context_type ${c.context_type} — ENWorld prompts are quoted_question, read functionally`);
  if (!(c.context_text || '').trim()) problems.push(`${k}: empty context text`);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(c.context_text)) problems.push(`${k}: context text still carries a control character`);
  if (/&(?:amp|lt|gt|quot|nbsp|apos|#\d+);/i.test(String(c.speaker_display || ''))) problems.push(`${k}: handle "${c.speaker_display}" carries an undecoded HTML entity`);
  // A handle becomes a persons row, i.e. an IDENTITY. U+FFFD is the right repair for a
  // failed glyph in prose, but in a handle it silently forks one person into two — and
  // the glyph IS legible on the evidence card, so it must be read there, upstream.
  if (String(c.speaker_display || '').includes(REPLACEMENT))
    problems.push(`${k}: handle "${c.speaker_display}" still carries U+FFFD; read the glyph from the evidence card rather than substituting it`);
  if (c.speaker_display) nAttr++; else nUnattr++;
  if (c.quote_back_speaker_display && !c.speaker_display)
    problems.push(`${k}: a quote label is recorded but no antecedent speaker; the antecedent is what attributes a prompt`);
  const arr = ctxByUnit.get(k) || []; arr.push(c); ctxByUnit.set(k, arr);
}
// Gary's own quoted-back words must never be re-attributed to a participant
for (const c of ctxRows) {
  const u = byKey.get(c.preparation_key); if (!u) continue;
  const frag = (c.quote_back_fragment || '').trim();
  if (frag.length > 40 && u.discovery_text.includes(frag)) problems.push(`${c.preparation_key}: quote-back fragment also appears inside Gygax discovery`);
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
else if (shaFile(join(PKG, PDF)) !== COV.source_pdf_sha256) problems.push('source PDF hash disagrees with COVERAGE.json');

if (problems.length) { problems.slice(0, 20).forEach((p) => console.error('  ' + p)); die(`${problems.length} package problem(s); nothing ingested.`); }
console.log(`ENWorld Part V (complete) — package verified under schema ${SCHEMA.version}`);
console.log(`  ${sums.size} files checksum-verified · ${units.length} Gygax units of ${COV.printable_posts_total} printable posts · ${nCrop} crops + ${nStitch} stitched over ${nJoin} joins`);
console.log(`  ${ctxRows.length} quoted prompts: ${nAttr} attributed · ${nUnattr} unattributed (no speaker inferred)`);

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
// EXTEND, never create: a second family or object would split the thread.
const fam = g(`SELECT id FROM source_families WHERE name=?`, FAMILY);
if (!fam) { db.exec('ROLLBACK'); die(`source family "${FAMILY}" not found; Part V extends it and must not create a new one.`); }
const obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title=?`, fam.id, TITLE);
if (!obj) { db.exec('ROLLBACK'); die(`documentary object "${TITLE}" not found; Part V is a coverage segment of it, not a new object.`); }
const existing = g(`SELECT count(*) c, coalesce(max(sequence_in_object),0) hi FROM testimony_units WHERE object_id=?`, obj.id);
// The locator wraps the segment label in parentheses, and the label must be matched
// EXACTLY: a bare LIKE '%Part V%' also matches Part VI, VII and VIII, which made this
// guard fire against 157 Part VIII units on the first run.
const already = g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND (source_locator LIKE ? OR source_locator LIKE '%enweggqa05%')`, obj.id, `%(${SEGMENT})%`).c;
if (already && !FORCE) { db.exec('ROLLBACK'); die(`the object already holds ${already} Part V unit(s); use --force on a clean DB.`); }
// no historical overlap: this segment's window must be empty in the corpus
const first = isoDate(units[0].testimony_date_value), last = isoDate(units[units.length - 1].testimony_date_value);
const clash = g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND date_value BETWEEN ? AND ?`, obj.id, first, last).c;
if (clash && !FORCE) { db.exec('ROLLBACK'); die(`${clash} existing unit(s) already fall inside ${first}..${last}; refusing to double-ingest.`); }

const insUnit = db.prepare(`INSERT INTO testimony_units
  (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
   speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
  VALUES (?,?,NULL,'unknown',?,?,'minute',NULL,?,?, 'direct','commentary','','untranscribed','unknown','pdf_text_extraction',?)`);
const insCtx = db.prepare(`INSERT INTO unit_context(unit_id,context_type,speaker_id,text,text_status,sequence)
  VALUES (?,'quoted_question',?,'','untranscribed',?)`);
const insDisc = db.prepare(`INSERT INTO discovery_text(object_id,segment_label,source_type,source_locator,text,unit_id)
  VALUES (?,?,'pdf_text_extraction',?,?,?)`);
const insAsset = db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,1,?,?)`);
const insSrc = db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,capture_date_precision) VALUES (?,?,'pdf_page','unknown')`);

// Handles are SOURCE-SCOPED: an identical string in another forum is a separate
// unresolved identity. Existing ENWorld handles are reused, never duplicated.
const findPerson = db.prepare(`SELECT id FROM persons WHERE name=? AND identity_scope=?`);
const addPerson = db.prepare(`INSERT INTO persons(name,identity_scope,notes) VALUES (?,?,?)`);
const pcache = new Map(); let handlesCreated = 0, handlesReused = 0;
function personIdForHandle(handle) {
  if (pcache.has(handle)) return pcache.get(handle);
  const found = findPerson.get(handle, HANDLE_SCOPE);
  let id;
  if (found) { id = found.id; handlesReused++; }
  else {
    id = Number(addPerson.run(handle, HANDLE_SCOPE,
      'Forum handle, recorded exactly as the source renders it; the scope, not the name, records where it is attested. Pseudonymous: the real-world identity is unverified and is NOT inferred. An identical handle in another source family is a separate unresolved identity until sameness is independently established.').lastInsertRowid);
    handlesCreated++;
  }
  pcache.set(handle, id);
  return id;
}

const DIR = 'evidence/enworld/part05/';
const stitched = []; let seq = existing.hi; let nuls = 0, nCtxRows = 0, nDisc = 0;
const labelMismatches = [];
for (const u of units) {
  const k = u.preparation_key;
  const a = u.evidence_assets[0];
  const pages = a.source_portions.map((p) => p.source_page);
  const lo = Math.min(...pages), hi = Math.max(...pages);
  // locator follows the format Parts I/II/VIII-XII already use in this object
  const locator = `enweggqa05.pdf PDF pages ${lo}-${hi}; printable-view position ${u.printable_view_position} (${SEGMENT})`;
  seq += 1;
  const uid = Number(insUnit.run(obj.id, seq, u.testimony_date_value, isoDate(u.testimony_date_value), gygax.id, gygax.id, locator).lastInsertRowid);

  const raw = u.discovery_text || '';
  nuls += raw.split(NUL).length - 1;
  insDisc.run(obj.id, SEGMENT, `${locator}; Gygax reply (newly authored)`, clean(raw).trim(), uid); nDisc++;

  let seqNo = 0;
  for (const c of ctxByUnit.get(k) || []) {
    seqNo++;
    const handle = c.speaker_display || null;
    const pid = handle ? personIdForHandle(handle) : null;
    insCtx.run(uid, pid, seqNo); nCtxRows++;
    // The antecedent post header is canonical. Where the vBulletin quote label
    // disagrees with it, the label is kept in the locator as LINKAGE EVIDENCE —
    // never as the speaker — so a later reconciliation can weigh it without the
    // corpus having credited the prompt to the wrong participant in the meantime.
    const label = c.quote_back_speaker_display || null;
    const mismatch = handle && label && label !== handle;
    if (mismatch) labelMismatches.push({ key: k, seq: seqNo, antecedent: handle, label, ante: c.antecedent_printable_locator });
    const who = (handle || 'speaker not named in this quote-back')
      + (mismatch ? ` (antecedent header; the vBulletin quote label reads "${label}" — recorded as linkage evidence, NOT as the speaker)` : '');
    nuls += (c.context_text || '').split(NUL).length - 1;
    insDisc.run(obj.id, SEGMENT, `${locator}; quoted prompt ${seqNo} — ${who} (quoted by Gygax, NOT Gygax-authored)`, clean(c.context_text).trim(), uid); nDisc++;
  }

  const h = shaFile(join(PKG, a.asset_path));
  const aid = Number(insAsset.run(uid, DIR + basename(a.asset_path), a.source_portions.length > 1 ? 'stitched' : 'crop', h).lastInsertRowid);
  for (const p of a.source_portions) {
    const what = a.source_portions.length > 1
      ? `portion ${p.order} of ${a.source_portions.length} — one post interrupted by printable-view pagination; navigation, header and footer furniture excluded at the join`
      : 'source-native crop of one printable-view post';
    insSrc.run(aid, `enweggqa05.pdf p.${p.source_page}, clip [${p.clip_pdf_points.join(', ')}] pt — ${what}`);
  }
  const dest = join(EVID, DIR + basename(a.asset_path)); mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(PKG, a.asset_path), dest);
  if (a.source_portions.length > 1) stitched.push({ unit: k, loc: u.source_locator, assetPath: DIR + basename(a.asset_path), sha: h, pages: `${lo}-${hi}` });
}

// The Part V coverage row described v1-era screenshots that never reached v2:
// the object held ZERO Part V units before this run. Rewrite it to what is held.
db.prepare(`UPDATE coverage SET segment_kind='preservation_part', coverage_status='complete', known_loss=0,
   number_from=NULL, number_to=NULL, locator_from=?, locator_to=?, detail=? WHERE object_id=? AND segment_label=?`).run(
  COV.first_locator, COV.last_locator,
  `Complete Part V printable-view preservation PDF (enweggqa05.pdf, 96 pages) ingested post by post: ${units.length} Gygax posts out of ${COV.printable_posts_total} printable-view posts, ${COV.first_locator} to ${COV.last_locator}, ${COV.first_date} to ${COV.last_date}. Complete AS PRESERVED for Gygax's own posts in this segment; the other ${COV.printable_posts_total - units.length} posts are participants' and are held only where Gygax quoted them back. Supersedes the v1 description of selected screenshots around ENWorld pages 103-110, none of which reached the v2 corpus.`,
  obj.id, SEGMENT);

const u1 = g(`SELECT id FROM testimony_units WHERE object_id=? AND sequence_in_object=?`, obj.id, existing.hi + 1).id;
const insAnn = db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?,?,?)`);
insAnn.run(u1, 'segment_scope',
  `Part V is a COVERAGE SEGMENT of this thread, not a separate documentary object: it extends "${TITLE}" rather than creating one. ${units.length} Gygax posts were added, continuing sequence_in_object from ${existing.hi}. Verified before ingest that the corpus held no Part V unit and none dated inside ${first}..${last}, so nothing is double-ingested; Part II ends 2003-04-06T14:19 and this segment opens 2003-04-06T18:29.`);
insAnn.run(u1, 'unit_numbering',
  'The printable view prints no post numbering usable as historical numbering, so unit_number is NULL and unit_number_status \'unknown\'. The printable-view position is recorded in source_locator as a LOCATOR only. Reconciliation against current ENWorld post numbers, and real-name enrichment of handles, are deliberately deferred.');
insAnn.run(u1, 'attribution',
  `Gygax's words in this segment are frequently NON-CONTIGUOUS: a single post may carry several quote boxes with his replies between them. Discovery holds his own words only; each quoted prompt is a separate context row (${ctxRows.length} across ${ctxByUnit.size} units, up to twelve on one post), attributed to the handle the source names and left with NO speaker on the ${nUnattr} quote-backs the source does not attribute. Handles are source-scoped to "${HANDLE_SCOPE}"; an identical string in another forum stays a separate unresolved identity.`);
insAnn.run(u1, 'quote_label_mismatch',
  `Two quote-backs in this segment carry a vBulletin label that disagrees with the preserved antecedent post header: at ${labelMismatches.map((m) => `${m.ante} the header reads "${m.antecedent}" while the quote label reads "${m.label}"`).join(', and at ')}. The ANTECEDENT is canonical in both, and each was verified independently before ingestion: the quoted words appear verbatim under the antecedent header at an earlier timestamp in the same preservation PDF, and neither phrase appears anywhere else in the corpus attributed to the label handle. Both label handles are nonetheless genuine ENWorld identities held from other segments, so this is consistent with an account rename rendered inconsistently by the printable view rather than with a phantom label. The labels are preserved in the provenance locator as linkage evidence only. Attributing the prompts to them would have credited two prompts to the wrong participants; treating the labels as proof of a rename would merge identities the corpus has not established. Neither was done.`);

db.exec('COMMIT');

// ---- report -----------------------------------------------------------------
const after = snap();
const L = []; const P = (s) => { console.log(s); L.push(s); };
const newUnits = `SELECT id FROM testimony_units WHERE object_id=${obj.id} AND sequence_in_object>${existing.hi}`;
const inNew = `unit_id IN (${newUnits})`;
P('\nReconciliation report — ENWorld Part V (complete segment)');
P(`  documentary objects  : +${after.objects - before.objects} (0 expected — Part V EXTENDS "${TITLE}")`);
P(`  source families      : +${after.families - before.families} (0 expected — extends "${FAMILY}")`);
P(`  testimony units      : +${after.units - before.units} (expected 97; sequence ${existing.hi + 1}..${seq})`);
P(`  unit_context rows    : +${after.context - before.context} (expected 121 quoted prompts)`);
P(`  discovery_text rows  : +${after.discovery - before.discovery} (expected 218 = 97 replies + 121 prompts)`);
P(`  evidence assets      : +${after.assets - before.assets} (71 crop + 26 stitched)`);
P(`  provenance rows      : +${after.sources - before.sources} (expected 123 portions)`);
P(`  persons              : +${after.persons - before.persons} (${handlesCreated} new handles; ${handlesReused} existing reused)`);
P(`  annotations          : +${after.annotations - before.annotations}`);
P(`  coverage segments    : +${after.coverage - before.coverage} (0 expected — the Part V row was REWRITTEN, not added)`);
if (nuls) P(`  NUL bytes sanitised  : ${nuls}`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nConfirmations:');
ok('the thread is still ONE object and ONE family', after.objects === before.objects && after.families === before.families);
ok('97 Gygax units, direct commentary, untranscribed',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND sequence_in_object>? AND speaker_id=? AND evidence_relationship='direct' AND discourse_mode='commentary' AND transcript_status='untranscribed' AND transcript=''`, obj.id, existing.hi, gygax.id).c === 97);
ok('no verified transcript was added anywhere in the corpus', after.verified === before.verified);
ok('no new unit claims a post number', g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND sequence_in_object>? AND (unit_number IS NOT NULL OR unit_number_status<>'unknown')`, obj.id, existing.hi).c === 0);
ok('every new unit carries a minute-precision date inside the segment window',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND sequence_in_object>? AND date_precision='minute' AND date_value BETWEEN ? AND ?`, obj.id, existing.hi, first, last).c === 97);
ok('dates are strictly ascending with the printable-view order',
   g(`SELECT count(*) c FROM (SELECT date_value, lag(date_value) OVER (ORDER BY sequence_in_object) prev FROM testimony_units WHERE object_id=${obj.id} AND sequence_in_object>${existing.hi}) WHERE prev IS NOT NULL AND date_value < prev`).c === 0);
ok('121 quoted_question contexts, contiguous per unit',
   g(`SELECT count(*) c FROM unit_context WHERE ${inNew} AND context_type='quoted_question'`).c === 121 &&
   g(`SELECT count(*) c FROM (SELECT unit_id, count(*) n, max(sequence) m FROM unit_context WHERE ${inNew} GROUP BY unit_id HAVING n<>m)`).c === 0);
ok(`${nAttr} prompts attributed to a scoped handle; ${nUnattr} carry NO speaker`,
   g(`SELECT count(*) c FROM unit_context WHERE ${inNew} AND speaker_id IS NOT NULL`).c === nAttr &&
   g(`SELECT count(*) c FROM unit_context WHERE ${inNew} AND speaker_id IS NULL`).c === nUnattr);
ok('no context row attributes a prompt to Gygax', g(`SELECT count(*) c FROM unit_context WHERE ${inNew} AND speaker_id=?`, gygax.id).c === 0);
ok('every context row is empty and untranscribed', g(`SELECT count(*) c FROM unit_context WHERE ${inNew} AND (text<>'' OR text_status<>'untranscribed')`).c === 0);
ok('every quote-back handle is scoped to this family, never global',
   g(`SELECT count(*) c FROM persons WHERE id IN (SELECT DISTINCT speaker_id FROM unit_context WHERE ${inNew} AND speaker_id IS NOT NULL) AND identity_scope<>?`, HANDLE_SCOPE).c === 0);
ok('218 discovery rows split 97 replies / 121 prompts',
   g(`SELECT count(*) c FROM discovery_text WHERE unit_id IN (${newUnits}) AND source_locator LIKE '%Gygax reply%'`).c === 97 &&
   g(`SELECT count(*) c FROM discovery_text WHERE unit_id IN (${newUnits}) AND source_locator LIKE '%NOT Gygax-authored%'`).c === 121);
// Furniture and control characters are tested in JS: SQL LIKE would match Gygax's own
// prose ("equippage ... of ...") and char(0) returns an EMPTY STRING in SQLite, which
// silently turns '%'||char(0)||'%' into '%%' — an assertion that matches everything.
const newDisc = db.prepare(`SELECT source_locator loc, text FROM discovery_text WHERE unit_id IN (${newUnits})`).all();
const replyRows = newDisc.filter((r) => r.loc.includes('Gygax reply'));
ok('no Gygax reply row carries forum furniture',
   replyRows.every((r) => !/Originally posted by/i.test(r.text)
     && !/(?:^|\n)[ \t]*Page \d+ of \d+[ \t]*(?:\n|$)/.test(r.text)
     && !/(?:^|\n)[ \t]*Quote:[ \t]*(?:\n|$)/.test(r.text)));
ok('71 crops + 26 stitched; 123 provenance portions',
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inNew} AND asset_type='crop'`).c === 71 &&
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inNew} AND asset_type='stitched'`).c === 26 &&
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inNew})`).c === 123);
ok('every provenance row names a page and a PDF clip box',
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inNew}) AND original_locator NOT LIKE '%clip [%] pt%'`).c === 0);
ok('every asset hash in the DB matches the staged file bytes',
   db.prepare(`SELECT asset_path, sha256 FROM evidence_assets WHERE ${inNew}`).all()
     .every((a) => existsSync(join(EVID, a.asset_path)) && shaFile(join(EVID, a.asset_path)) === a.sha256));
ok('the Part V coverage row now describes what is held',
   g(`SELECT count(*) c FROM coverage WHERE object_id=? AND segment_label=? AND coverage_status='complete' AND locator_from=? AND detail LIKE '%${units.length} Gygax posts%'`, obj.id, SEGMENT, COV.first_locator).c === 1);
// Part V needed no glyph substitution: the three failed handle glyphs were read off
// the evidence cards upstream, so NO U+FFFD should remain anywhere in this segment.
ok('no control character and no substituted glyph survived into any new row',
   newDisc.every((r) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(r.text) && !r.text.includes(REPLACEMENT)));

P('\nFTS behaviour (the §8 guarantee):');
ok('Gygax wording IS discoverable',
   g(`SELECT count(*) c FROM discovery_text d JOIN discovery_fts f ON f.rowid=d.id WHERE d.unit_id IN (${newUnits}) AND discovery_fts MATCH 'Gygaxian' AND d.source_locator LIKE '%Gygax reply%'`).c >= 1);
// The probe phrase is taken from THIS segment's own data at run time. A phrase copied
// from another segment cannot appear here, so the assertion would test nothing.
const probeRow = db.prepare(`SELECT text FROM discovery_text WHERE unit_id IN (${newUnits}) AND source_locator LIKE '%NOT Gygax-authored%' ORDER BY length(text) DESC LIMIT 1`).get().text;
const probe = '"' + (probeRow.toLowerCase().match(/[a-z0-9]+/g) || []).slice(4, 9).join(' ') + '"';
const probeHits = db.prepare(`SELECT d.source_locator loc FROM discovery_fts f JOIN discovery_text d ON d.id=f.rowid WHERE discovery_fts MATCH ? AND d.unit_id IN (${newUnits})`).all(probe);
ok(`a quoted prompt from this segment is discoverable as CONTEXT only  ${probe}`,
   probeHits.length >= 1 && probeHits.every((h) => h.loc.includes('NOT Gygax-authored')));
ok('that same participant wording is NOT in Gygax transcript FTS',
   db.prepare(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH ?`).get(probe).c === 0);
ok('this segment contributes no transcript text at all',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND sequence_in_object>? AND length(transcript)>0`, obj.id, existing.hi).c === 0);

P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('units_fts in sync with units', B('units_fts') === after.units);
ok('context_fts in sync with unit_context', B('context_fts') === after.context);
ok('discovery_fts in sync with discovery_text', B('discovery_fts') === after.discovery);

P(`\n${stitched.length} stitched cards (${nJoin} joins) requiring eyes-on acceptance before the build gate passes.`);

db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
writeFileSync(join(dirname(DB_PATH), 'p5-stitched.json'), JSON.stringify(stitched, null, 1));
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-enworld-part05.log';
writeFileSync(logPath, ['Gygax corpus v2 — ENWorld "Q&A with Gary Gygax", Part V (complete preservation segment)',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
