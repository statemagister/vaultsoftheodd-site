#!/usr/bin/env node
/*
 * gygax-v2-ingest-wargamers-digest-1974.mjs — ingest Gary Gygax, "Swords and
 * Sorcery - In Wargaming" (Wargamer's Digest, Vol. 1 No. 7, May 1974) under the
 * frozen v2 schema and Evidence Ingestion Rules v1.2.
 *
 *   node --experimental-sqlite scripts/gygax-v2-ingest-wargamers-digest-1974.mjs \
 *        <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]
 *
 * First 1974 print-periodical source and the first Gygax-AUTHORED article. New
 * evidentiary condition, represented WITHIN the frozen schema without loss:
 *
 *   - Testimony relationship is DIRECT: Gygax authored the whole article (§9 —
 *     the source role and the testimony relationship are separate questions).
 *   - The supplied preservation is an INTERMEDIARY REPRODUCTION (the "Axe &
 *     Hammer: Gygax Legendarium" reprint), NOT the original 1974 printing.
 *     Historical identity/authorship/date are independently verified; word-for-
 *     word fidelity to the 1974 original is NOT collated. That status is carried
 *     as PRESERVATION provenance (evidence_sources locators + object notes) and
 *     by transcript_status='untranscribed' + an explicit annotation — never by
 *     claiming a verified transcript (§7, §20).
 *
 * Three historical testimony units (§4, §5, §15):
 *   u01 opening/contemporary commentary  -> 3 ordered page crops (pp.1-3)
 *   u02 long dramatic play report        -> 6 ordered page crops (pp.3-8)
 *   u03 closing commentary               -> 1 single-page crop (p.8)
 * Long testimony occupying several substantial pages is represented as multiple
 * ordered single-source crops within one unit, NOT stitched — so every asset is
 * an ordinary single-source crop and is gate-exempt (no reconstruction here).
 *
 * The unchanged reproduction PDF and its 8 page renders are preservation sources:
 * hash-recorded, retained for audit, left OFFLINE. Only the crops are staged.
 * Transcripts stay untranscribed; the package supplies no discovery text.
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
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-ingest-wargamers-digest-1974.mjs <v2.sqlite> <package-dir> <evidence-staging-dir> [--force]');
  process.exit(2);
}
const die = (m) => { console.error('\nINGEST ABORTED: ' + m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(readFileSync(p));

const man = JSON.parse(readFileSync(join(PKG, 'manifest.json'), 'utf8'));
const dobj = man.documentary_object, units = man.units, prov = man.asset_provenance, exp = man.ingestion_expectations;

// ---- validate the package (report mismatches, do not compensate) -----------
const problems = [];
if (units.length !== exp.units) problems.push(`expected ${exp.units} units, found ${units.length}`);
let nAssets = 0;
const pageSha = new Map();
for (const u of units) {
  const pr = prov[u.unit_key] || [];
  if (pr.length !== u.assets.length) problems.push(`${u.unit_key}: assets ${u.assets.length} != provenance ${pr.length}`);
  nAssets += u.assets.length;
  for (const p of pr) {
    const f = join(PKG, p.asset);
    if (!existsSync(f)) problems.push(`missing crop: ${p.asset}`);
    const pf = join(PKG, 'source_pages', `page-${p.source_page}.png`);
    if (!existsSync(pf)) problems.push(`missing source page render: page-${p.source_page}.png`);
    else if (!pageSha.has(p.source_page)) pageSha.set(p.source_page, shaFile(pf));
  }
  if (u.evidence_relationship !== 'direct') problems.push(`${u.unit_key}: unexpected evidence_relationship ${u.evidence_relationship}`);
  if (u.transcript_status !== 'untranscribed') problems.push(`${u.unit_key}: transcript_status ${u.transcript_status} (package supplies no verified transcript)`);
}
if (nAssets !== exp.assets) problems.push(`asset total ${nAssets} != expected ${exp.assets}`);
if (exp.reconstructed_assets !== 0) problems.push(`package declares ${exp.reconstructed_assets} reconstructed assets; expected 0 (all ordinary crops)`);
// preservation reproduction PDF present (kept offline)
const pdfName = 'Axe and Hammer_ Gygax Legendarium_ Swords & Sorcery - In Wargaming (May 1974).pdf';
if (!existsSync(join(PKG, 'source', pdfName))) problems.push('reproduction PDF missing under source/');
const pdfSha = existsSync(join(PKG, 'source', pdfName)) ? shaFile(join(PKG, 'source', pdfName)) : null;
if (problems.length) { problems.slice(0, 20).forEach((p) => console.error('  ' + p)); die(`${problems.length} package problem(s); nothing ingested.`); }
console.log(`Wargamer's Digest 1974 — package verified under schema ${SCHEMA.version}`);
console.log(`  ${units.length} units · ${nAssets} single-source crops (0 reconstructed) · reproduction PDF ${pdfSha.slice(0, 16)}… (offline, intermediary)`);

// ---- ingest -----------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const g = (s, ...b) => db.prepare(s).get(...b);
const B = (t) => g(`SELECT count(*) c FROM ${t}`).c;
const before = { objects: B('documentary_objects'), units: B('testimony_units'), assets: B('evidence_assets'),
  sources: B('evidence_sources'), discovery: B('discovery_text'), coverage: B('coverage'), families: B('source_families') };

db.exec('BEGIN');
const gygax = g(`SELECT id FROM persons WHERE name='Gary Gygax'`);
if (!gygax) { db.exec('ROLLBACK'); die('speaker "Gary Gygax" not found — run the v1 migration first.'); }
let fam = g(`SELECT id FROM source_families WHERE name='Wargamer''s Digest'`);
if (!fam) fam = { id: Number(db.prepare(`INSERT INTO source_families(name,kind,notes) VALUES ('Wargamer''s Digest','periodical','1970s wargaming periodical. This object is preserved via an intermediary reproduction, not an original print scan.')`).run().lastInsertRowid) };

let obj = g(`SELECT id FROM documentary_objects WHERE family_id=? AND title=?`, fam.id, dobj.title);
if (obj && !FORCE) { db.exec('ROLLBACK'); die(`object "${dobj.title}" already present; use --force on a clean DB.`); }
if (!obj) obj = { id: Number(db.prepare(`INSERT INTO documentary_objects
  (family_id,title,object_type,date_display,date_from_value,date_precision,venue,citation,identifier,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
  fam.id, dobj.title, dobj.object_type, 'May 1974', dobj.publication_date, dobj.date_precision, "Wargamer's Digest",
  `Gary Gygax, "${dobj.title}", Wargamer's Digest, Vol. ${dobj.volume} No. ${dobj.number}, May 1974.`,
  `Vol. ${dobj.volume} No. ${dobj.number}`,
  `INTERMEDIARY REPRODUCTION. ${dobj.source_status} Preservation chain: ${dobj.preservation_chain} External verification: historical identity/authorship/venue/date independently verified (reprinted Dungeon #112, 2004); word-for-word fidelity of the reproduction to the original 1974 printing NOT collated, so no transcript is verified. 2017 PDF footer is preservation metadata, not a publication date.`).lastInsertRowid) };
if (g('SELECT count(*) c FROM testimony_units WHERE object_id=?', obj.id).c > 0 && !FORCE) { db.exec('ROLLBACK'); die('this object already holds testimony units.'); }

const uidByKey = new Map();
for (const u of units) {
  const uid = Number(db.prepare(`INSERT INTO testimony_units
    (object_id,sequence_in_object,unit_number,unit_number_status,date_display,date_value,date_precision,date_timezone,
     speaker_id,subject_person_id,evidence_relationship,discourse_mode,transcript,transcript_status,completeness,source_type,source_locator)
    VALUES (?,?,NULL,'unknown','May 1974',?,?,NULL,?,?, 'direct', ?, '', 'untranscribed', ?, 'pdf_text_extraction', ?)`).run(
    obj.id, u.sequence_in_object, u.date, u.date_precision || 'month', gygax.id, gygax.id,
    u.discourse_mode, u.completeness || 'complete',
    `Wargamer's Digest Vol. ${dobj.volume} No. ${dobj.number} (May 1974), via Axe & Hammer reproduction; reproduction pages ${u.source_pages.join(', ')}`).lastInsertRowid);
  uidByKey.set(u.unit_key, uid);

  // ordered evidence: one single-source crop per contributing page (NOT stitched)
  let order = 0;
  for (const p of prov[u.unit_key]) {
    order++;
    const cropFile = join(PKG, p.asset);
    const assetSha = shaFile(cropFile);
    const assetPath = 'evidence/wargamers-digest/' + basename(p.asset);
    const aid = Number(db.prepare(`INSERT INTO evidence_assets(unit_id,asset_path,display_order,asset_type,sha256) VALUES (?,?,?, 'crop', ?)`)
      .run(uid, assetPath, order, assetSha).lastInsertRowid);
    db.prepare(`INSERT INTO evidence_sources(asset_id,original_locator,original_type,original_sha256,capture_date_precision) VALUES (?,?,'pdf_page',?, 'unknown')`)
      .run(aid, `Axe & Hammer "Gygax Legendarium" reproduction of Wargamer's Digest Vol.${dobj.volume} No.${dobj.number}, reproduction PDF page ${p.source_page}, crop box ${JSON.stringify(p.crop_box)} on the page render — INTERMEDIARY REPRODUCTION (fidelity to the 1974 original not collated); reproduction PDF + renders held offline`, pageSha.get(p.source_page));
    const dest = join(EVID, assetPath); mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(cropFile, dest);  // stage ONLY the crop
  }
}

// coverage: whole reproduced article preserved complete
db.prepare(`INSERT INTO coverage(object_id,segment_label,segment_kind,locator_from,locator_to,coverage_status,known_loss,detail,sort_order)
  VALUES (?, 'Reproduced article (8 pages)','page_range','reproduction p.1','reproduction p.8','complete',0, ?, 1)`).run(
  obj.id, 'Complete as preserved in the 8-page Axe & Hammer reproduction. Original 1974 Wargamer\'s Digest printing not held; reproduction PDF and page renders held offline for audit.');

// object-level external-verification + intermediary-reproduction annotation
db.prepare(`INSERT INTO annotations(unit_id,annotation_type,note) VALUES (?, 'external_verification', ?)`).run(
  uidByKey.get(units[0].unit_key),
  'Historical identity and substantive authenticity independently verified: Gygax authorship, title, Wargamer\'s Digest Vol.1 No.7, May 1974; reprinted Dungeon #112 (2004); the long central passage is independently described as a game Gygax played in rather than judged; the Mordenkainen/Bigby/Yrag/Felnorith/Raunalf iron-golem episode is independently identified, later linked by Rob Kuntz to Castle El Raja Key / WG5 Maure Castle. NOT verified: word-for-word fidelity of the Axe & Hammer reproduction to the original 1974 printing has not been collated; therefore no transcript is marked verified and no claim of diplomatic textual identity with the 1974 original is made.');

db.exec('COMMIT');

// ---- reconciliation report -------------------------------------------------
const A = (t) => B(t);
const after = { objects: A('documentary_objects'), units: A('testimony_units'), assets: A('evidence_assets'),
  sources: A('evidence_sources'), discovery: A('discovery_text'), coverage: A('coverage'), families: A('source_families') };
const oid = obj.id;
const inObj = `unit_id IN (SELECT id FROM testimony_units WHERE object_id=${oid})`;
const L = []; const P = (s) => { console.log(s); L.push(s); };
P('\nReconciliation report — Wargamer\'s Digest 1974');
P(`  documentary object   : +${after.objects - before.objects} (expected 1, article)`);
P(`  source family        : ${after.families - before.families ? '+1 (Wargamer\'s Digest, periodical)' : 'existing'}`);
P(`  testimony units      : +${after.units - before.units} (expected 3)`);
P(`  evidence assets      : +${after.assets - before.assets} (expected 10, all crop)`);
P(`  provenance rows      : +${after.sources - before.sources} (expected 10)`);
P(`  coverage segments    : +${after.coverage - before.coverage} (expected 1)`);
P(`  discovery records    : +${after.discovery - before.discovery} (expected 0; package supplies no discovery text)`);

let fails = 0;
const ok = (n, c, x = '') => { const l = `  [${c ? 'PASS' : 'FAIL'}] ${n}${x ? ' — ' + x : ''}`; console.log(l); L.push(l); if (!c) fails++; };
P('\nConfirmations:');
ok('3 Gygax direct units, all untranscribed (0 verified)',
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND speaker_id=? AND evidence_relationship='direct' AND transcript_status='untranscribed'`, oid, gygax.id).c === 3 &&
   g(`SELECT count(*) c FROM testimony_units WHERE object_id=? AND transcript_status='verified'`, oid).c === 0);
ok('10 evidence assets, all crop, single-source (gate-exempt, 0 reconstructed)',
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='crop'`).c === 10 &&
   g(`SELECT count(*) c FROM evidence_assets WHERE ${inObj} AND asset_type='stitched'`).c === 0 &&
   g(`SELECT count(*) c FROM (SELECT asset_id FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj}) GROUP BY asset_id HAVING count(*)>1)`).c === 0);
ok('unit asset counts: u01=3, u02=6, u03=1 (ordered multi-asset, not stitched)',
   g(`SELECT count(*) c FROM evidence_assets e JOIN testimony_units u ON u.id=e.unit_id WHERE u.object_id=? AND u.sequence_in_object=1`, oid).c === 3 &&
   g(`SELECT count(*) c FROM evidence_assets e JOIN testimony_units u ON u.id=e.unit_id WHERE u.object_id=? AND u.sequence_in_object=2`, oid).c === 6 &&
   g(`SELECT count(*) c FROM evidence_assets e JOIN testimony_units u ON u.id=e.unit_id WHERE u.object_id=? AND u.sequence_in_object=3`, oid).c === 1);
ok('shared source pages (p3, p8) carried by separate per-unit crops',
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj}) AND original_locator LIKE '%PDF page 3,%'`).c === 2 &&
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj}) AND original_locator LIKE '%PDF page 8,%'`).c === 2);
ok('intermediary-reproduction status recorded in provenance + annotation',
   g(`SELECT count(*) c FROM evidence_sources WHERE asset_id IN (SELECT id FROM evidence_assets WHERE ${inObj}) AND original_locator LIKE '%INTERMEDIARY REPRODUCTION%'`).c === 10 &&
   g(`SELECT count(*) c FROM annotations WHERE ${inObj} AND annotation_type='external_verification'`).c === 1);
P('\nFTS behaviour:');
ok('no Wargamer\'s Digest text in Gygax transcript FTS (all untranscribed)', g(`SELECT count(*) c FROM units_fts WHERE units_fts MATCH 'Mordenkainen OR golem'`).c === 0);
ok('no discovery text added for this object (evidence-only units)', g(`SELECT count(*) c FROM discovery_text WHERE object_id=?`, oid).c === 0);
P('\nIntegrity:');
ok('integrity_check', g('PRAGMA integrity_check').integrity_check === 'ok');
ok('units_fts in sync with units', A('units_fts') === after.units);
ok('discovery_fts in sync with discovery_text', A('discovery_fts') === after.discovery);

P('\nEvidentiary distinctions preserved (nothing required outside the frozen schema):');
P('  - Testimony relationship = direct (Gygax authored the article); preservation = intermediary reproduction, recorded as provenance + object notes (§9 separation).');
P('  - Textual fidelity to the 1974 original NOT collated -> transcript_status untranscribed + external_verification annotation; no verified transcript, no claim of diplomatic identity (§7, §20).');
P('  - Long testimony over several pages -> ordered multi-asset units, not stitched; all single-source crops, gate-exempt (§5, §15).');
P('  - discourse_mode per package: u01/u03 commentary, u02 retrospective_commentary (§16 — historical decisions made in the package).');
P('  - unit_number NULL/unknown; source_locator holds reproduction page positions; completeness=complete for the reproduced article object (§10, §12).');

db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'INGEST OK';
console.log(`\n${verdict}`);
const logPath = DB_PATH.replace(/\.sqlite$/, '') + '.ingest-wargamers-digest-1974.log';
writeFileSync(logPath, ['Gygax corpus v2 — Wargamer\'s Digest 1974 "Swords and Sorcery - In Wargaming" ingestion',
  `date   : ${new Date().toISOString().slice(0, 10)}`, `schema : ${SCHEMA.version} (${SCHEMA.sha256.slice(0, 16)}…)`,
  `source : ${PKG}`, `reproduction PDF (offline, intermediary) sha256 : ${pdfSha}`, '', ...L, '', verdict, ''].join('\n'));
console.log(`ingestion log written: ${logPath}`);
process.exit(fails ? 1 : 0);
