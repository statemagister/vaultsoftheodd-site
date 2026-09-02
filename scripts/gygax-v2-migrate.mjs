#!/usr/bin/env node
/*
 * gygax-v2-migrate.mjs — build a v2 corpus database from the v1 corpus.
 *
 *   node --experimental-sqlite scripts/gygax-v2-migrate.mjs <v1.sqlite> <out-v2.sqlite>
 *
 * This is a MODEL CHANGE, not a mechanical transform. v1 rows are PDF *page*
 * chunks, not testimony units. Splitting them into units automatically would
 * let extraction quality masquerade as verified transcript, so:
 *
 *   - the whole "Q&A with Gary Gygax" thread becomes ONE documentary object;
 *   - our Part I..XIII divisions become COVERAGE SEGMENTS within that object;
 *   - every v1 chunk becomes discovery_text (a finding aid, never quotable);
 *   - NO testimony units are created. Nothing in v1 is verified transcription.
 *
 * Units arrive later, one at a time, as transcriptions are verified.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSchemaFrozen } from './gygax-v2-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = assertSchemaFrozen();   // the v2 schema is frozen; refuse if it drifted
const [V1, OUT] = process.argv.slice(2);
if (!V1 || !OUT) {
  console.error('Usage: node --experimental-sqlite scripts/gygax-v2-migrate.mjs <v1.sqlite> <out-v2.sqlite>');
  process.exit(2);
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];

// v1 coverage_status prose -> controlled vocabulary + known_loss
function mapCoverage(status, knownLoss) {
  const s = (status || '').toLowerCase();
  let cs = 'unknown';
  if (s.includes('complete')) cs = 'complete';
  else if (s.includes('partial')) cs = 'partial';
  else if (s.includes('missing')) cs = 'missing';
  else if (s.includes('available')) cs = 'complete';
  return { coverage_status: cs, known_loss: knownLoss ? 1 : 0 };
}

if (existsSync(OUT)) rmSync(OUT);
const src = new DatabaseSync(V1, { readOnly: true });
const db = new DatabaseSync(OUT);
db.exec(readFileSync(join(HERE, 'gygax-v2-schema.sql'), 'utf8'));

db.exec('BEGIN');

// --- fixed spine -----------------------------------------------------------
db.prepare(`INSERT INTO persons(id,name,notes) VALUES (1,'Gary Gygax',NULL)`).run();
db.prepare(`INSERT INTO source_families(id,name,kind,notes)
  VALUES (1,'ENWorld Q&A','forum','The "Q&A with Gary Gygax" thread on ENWorld.')`).run();
db.prepare(`INSERT INTO documentary_objects(id,family_id,title,object_type,venue,notes)
  VALUES (1,1,'Q&A with Gary Gygax','forum_thread','ENWorld',
    'One continuous thread. Our Part I..XIII divisions are preservation segments recorded in coverage, not separate documentary objects: the numbering and conversation run continuously across those boundaries.')`).run();

// --- coverage: Parts become SEGMENTS within the single object --------------
const covRows = src.prepare(
  `SELECT thread_part, coverage_status, detail, known_loss FROM coverage
   ORDER BY CAST(thread_part AS INTEGER)`).all();
const insCov = db.prepare(`INSERT INTO coverage
  (object_id,segment_label,segment_kind,coverage_status,known_loss,detail,sort_order)
  VALUES (1,?,'preservation_part',?,?,?,?)`);
for (const r of covRows) {
  const n = parseInt(r.thread_part, 10);
  const label = 'Part ' + (ROMAN[n] || r.thread_part);
  const m = mapCoverage(r.coverage_status, r.known_loss);
  // Original v1 wording preserved in detail so nothing is lost in the mapping.
  const detail = `${r.detail || ''}${r.detail ? ' ' : ''}[v1 status: ${r.coverage_status}]`;
  insCov.run(label, m.coverage_status, m.known_loss, detail, n);
}

// --- every v1 chunk becomes discovery text (never quotable) ----------------
const chunks = src.prepare(`
  SELECT c.text, c.source_locator, d.thread_part, d.source_type
  FROM chunks c JOIN documents d ON d.id = c.document_id
  ORDER BY c.id`).all();
const insDisc = db.prepare(`INSERT INTO discovery_text
  (object_id,segment_label,source_type,source_locator,text) VALUES (1,?,?,?,?)`);
const okSourceTypes = new Set(['pdf_text_extraction', 'screenshot_ocr', 'compilation_quotation']);
for (const c of chunks) {
  const n = parseInt(c.thread_part, 10);
  const label = 'Part ' + (ROMAN[n] || c.thread_part);
  const st = okSourceTypes.has(c.source_type) ? c.source_type : 'other';
  insDisc.run(label, st, c.source_locator, c.text);
}

db.exec('COMMIT');

// --- verification ----------------------------------------------------------
const n = (t) => db.prepare(`SELECT count(*) c FROM ${t}`).get().c;
const v1Chunks = src.prepare('SELECT count(*) c FROM chunks').get().c;
const v1Cov = src.prepare('SELECT count(*) c FROM coverage').get().c;

// ---- migration log --------------------------------------------------------
// OPERATION 1 of 2. This migrates the v1 DISCOVERY corpus only. Ingesting
// testimony units (e.g. the 532 ENWorld evidence cards) is a SEPARATE, later
// operation. These two numbers describe different things and must never be
// read as one becoming the other.
const LOG = [
  'Gygax corpus v2 — migration log',
  `date            : ${new Date().toISOString().slice(0, 10)}`,
  `schema          : ${SCHEMA.version} (frozen, sha256 ${SCHEMA.sha256.slice(0, 16)}…)`,
  `source          : ${V1}`,
  '',
  'OPERATION: v1 discovery-corpus migration (operation 1 of 2)',
  '  What this operation does: carries the v1 page/chunk corpus across as',
  '  DISCOVERY TEXT, and records the ENWorld Parts as coverage segments of the',
  '  single "Q&A with Gary Gygax" documentary object.',
  '',
  `  documentary objects : ${n('documentary_objects')}  (the whole thread is ONE object)`,
  `  coverage segments   : ${n('coverage')}  (from ${v1Cov} v1 parts; Parts are segments, not objects)`,
  `  discovery_text rows : ${n('discovery_text')}  (from ${v1Chunks} v1 page chunks, 1:1)`,
  `  testimony units     : ${n('testimony_units')}  (correct: nothing in v1 is verified transcription)`,
  `  evidence assets     : ${n('evidence_assets')}`,
  '',
  '  NOT DONE BY THIS OPERATION: no testimony units are created here. v1 holds',
  '  PDF page chunks, not posts; converting them into units would let extraction',
  '  quality masquerade as verified transcript.',
  '',
  'OPERATION 2 of 2 (separate, later): testimony-unit ingestion.',
  '  The 532 ENWorld evidence cards are the first testimony-unit ingestion set.',
  '  They enter as untranscribed units with inferred post numbers, their',
  '  extracted text as additional discovery_text, and their crops as encrypted',
  '  evidence assets.',
  '',
  `  ${v1Chunks} discovery chunks and 532 evidence cards are DIFFERENT SETS,`,
  '  counted in different tables, produced by different operations. Neither',
  '  number becomes the other. Do not read "1,559 records became 532".',
];
console.log(LOG.join('\n'));

let fails = 0;
const VERIFY = [];
const ok = (name, cond, extra = '') => {
  const line = `  [${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`;
  console.log(line); VERIFY.push(line); if (!cond) fails++;
};
console.log('\nVerification:');
ok('all v1 chunks carried into discovery_text', n('discovery_text') === v1Chunks);
ok('all v1 parts carried into coverage segments', n('coverage') === v1Cov);
ok('exactly one documentary object', n('documentary_objects') === 1);
ok('no testimony units created', n('testimony_units') === 0);
ok('transcript index empty (nothing verified yet)',
   db.prepare('SELECT count(*) c FROM units_fts').get().c === 0);
ok('discovery index populated by trigger',
   db.prepare('SELECT count(*) c FROM discovery_fts').get().c === v1Chunks);
ok('integrity_check', db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
for (const t of ['units_fts', 'context_fts', 'discovery_fts']) {
  try { db.exec(`INSERT INTO ${t}(${t}) VALUES('integrity-check')`); ok(`${t} integrity-check`, true); }
  catch (e) { ok(`${t} integrity-check`, false, e.message); }
}
// a discovery search still works (the finding-aid net survives migration)
const g = db.prepare(`SELECT count(*) c FROM discovery_fts WHERE discovery_fts MATCH 'Greyhawk'`).get().c;
ok('discovery search still finds Greyhawk', g > 0, `${g} matches`);

src.close(); db.close();
const verdict = fails ? `${fails} FAILURE(S)` : 'MIGRATION OK';
console.log(`\n${verdict}`);

// Persist the log next to the output so the operation stays auditable and the
// discovery/testimony distinction survives beyond this terminal session.
const logPath = OUT.replace(/\.sqlite$/, '') + '.migration.log';
writeFileSync(logPath, [...LOG, '', 'Verification:', ...VERIFY, '', verdict, ''].join('\n'));
console.log(`migration log written: ${logPath}`);
process.exit(fails ? 1 : 0);
