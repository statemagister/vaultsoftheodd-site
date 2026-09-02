#!/usr/bin/env node
/*
 * gygax-v2-accept-reconstructed.mjs — the reviewer's side of the reconstruction
 * control. It never deploys and never touches the frozen schema or the database
 * contents; it only reads the canonical DB and writes the sha256-keyed
 * acceptance registry (gygax-v2-reconstructed-acceptance.jsonl).
 *
 * Reconstructed = asset_type='stitched' OR joins >1 source (see
 * gygax-v2-reconstruction.mjs). Source-native crops are exempt and never listed.
 *
 * Actions:
 *   (default)                     list every reconstructed asset + acceptance status
 *   --sweep                       run OCR reconciliation over all reconstructed assets
 *   --review <asset_path|sha>     OCR-reconcile ONE asset and copy it out for eyes-on
 *   --accept <asset_path|sha>     record eyes-on ACCEPTED (human compared asset to source)
 *   --provisional <asset_path|all>  record ACKNOWLEDGED backlog (not yet eyes-on certified)
 *
 * Common flags:
 *   --db <v2.sqlite>          (required)   canonical database, opened read-only
 *   --evidence-dir <dir>      (required for sweep/review/accept) plaintext originals
 *   --note "..."             annotation stored with an accept/provisional record
 *   --by <id>                accepter identity (defaults to $GYGAX_ACCEPTER or "operator")
 *   --out-dir <dir>          where --review copies the image (default: alongside the DB)
 *
 * Usage:
 *   node --experimental-sqlite scripts/gygax-v2-accept-reconstructed.mjs --db corpus.sqlite
 *   node --experimental-sqlite ... --db c.sqlite --evidence-dir ev --sweep
 *   node --experimental-sqlite ... --db c.sqlite --evidence-dir ev --review evidence/x.jpg
 *   node --experimental-sqlite ... --db c.sqlite --evidence-dir ev --accept evidence/x.jpg --note "eyes-on: join clean, no dropped text"
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import {
  listReconstructed, sourceTextForUnit, ocrReconcile,
  loadAcceptance, appendAcceptance, ACCEPTANCE_PATH,
} from './gygax-v2-reconstruction.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; return (v && !v.startsWith('--')) ? v : true; };
const DB = flag('--db');
const EVID = flag('--evidence-dir');
const NOTE = typeof flag('--note') === 'string' ? flag('--note') : '';
const BY = (typeof flag('--by') === 'string' ? flag('--by') : null) || process.env.GYGAX_ACCEPTER || 'operator';
const OUTDIR = typeof flag('--out-dir') === 'string' ? flag('--out-dir') : (DB ? dirname(DB) : '.');
const doSweep = args.includes('--sweep');
const review = flag('--review');
const accept = flag('--accept');
const provisional = flag('--provisional');

if (!DB) { console.error('required: --db <v2.sqlite>'); process.exit(2); }
const sha = (b) => createHash('sha256').update(b).digest('hex');
const db = new DatabaseSync(DB, { readOnly: true });
const recon = listReconstructed(db);
const reg = loadAcceptance();
const byPath = new Map(recon.map((r) => [r.asset_path, r]));
const bySha = new Map(recon.map((r) => [r.sha256, r]));
const resolve = (sel) => byPath.get(sel) || bySha.get(sel) || null;

const statusOf = (a) => { const r = reg.get(a.sha256); return r ? r.status : 'UNCERTIFIED'; };

function needEvid() {
  if (!EVID) { console.error('required for this action: --evidence-dir <dir>'); process.exit(2); }
}
function assetPathOnDisk(a) {
  const p = join(EVID, a.asset_path);
  if (!existsSync(p)) { console.error(`missing evidence file: ${a.asset_path}`); process.exit(1); }
  const disk = sha(readFileSync(p));
  if (disk !== a.sha256) { console.error(`SHA-256 mismatch for ${a.asset_path}: disk ${disk.slice(0,12)} vs db ${a.sha256.slice(0,12)}`); process.exit(1); }
  return p;
}

// ---------------------------------------------------------------- actions
if (accept || provisional) {
  needEvid();
  const status = accept ? 'accepted' : 'provisional';
  const sel = accept || provisional;
  let targets;
  if (status === 'provisional' && sel === 'all') targets = recon;
  else { const a = resolve(sel); if (!a) { console.error(`not a reconstructed asset: ${sel}`); process.exit(1); } targets = [a]; }

  for (const a of targets) {
    assetPathOnDisk(a); // verifies file present and matches DB hash before recording
    let ocr = null;
    if (status === 'accepted') {
      // capture the OCR signal alongside the human decision (informational)
      ocr = await ocrReconcile(join(EVID, a.asset_path), sourceTextForUnit(db, a.unit_id));
    }
    const rec = {
      sha256: a.sha256, asset_path: a.asset_path, unit_id: a.unit_id,
      asset_type: a.asset_type, reasons: a.reasons, status,
      by: BY, at: new Date().toISOString(), note: NOTE || (status === 'provisional' ? 'acknowledged pre-existing reconstruction; eyes-on pending' : ''),
      ...(ocr ? { ocr: { available: ocr.available, coverage: ocr.coverage ?? null, missing_runs: ocr.missingRunCount ?? null } } : {}),
    };
    appendAcceptance(rec);
    console.log(`recorded ${status.toUpperCase()}: ${a.asset_path}  sha ${a.sha256.slice(0,12)}  (${a.reasons.join('; ')})`);
    if (ocr && ocr.available && ocr.missingRunCount)
      console.log(`  NOTE: OCR flagged ${ocr.missingRunCount} missing run(s), coverage ${(ocr.coverage*100).toFixed(1)}% — accepted anyway per human review`);
  }
  console.log(`\nregistry: ${ACCEPTANCE_PATH}`);
  process.exit(0);
}

if (review) {
  needEvid();
  const a = resolve(review);
  if (!a) { console.error(`not a reconstructed asset: ${review}`); process.exit(1); }
  const disk = assetPathOnDisk(a);
  mkdirSync(OUTDIR, { recursive: true });
  const outCopy = join(OUTDIR, 'review-' + basename(a.asset_path));
  copyFileSync(disk, outCopy);
  const src = sourceTextForUnit(db, a.unit_id);
  console.log(`Reconstructed asset : ${a.asset_path}`);
  console.log(`  reasons           : ${a.reasons.join('; ')}`);
  console.log(`  unit_id           : ${a.unit_id}`);
  console.log(`  sha256            : ${a.sha256}`);
  console.log(`  current status    : ${statusOf(a)}`);
  console.log(`  copied for eyes-on: ${outCopy}`);
  console.log(`  source words on file: ${src ? src.split(/\s+/).length : 0}`);
  const ocr = await ocrReconcile(disk, src);
  console.log('\nOCR / source-text reconciliation (WARNING only, not a gate):');
  if (!ocr.available) { console.log('  ' + ocr.note); }
  else {
    console.log(`  OCR confidence   : ${ocr.ocrConfidence != null ? ocr.ocrConfidence.toFixed(1) : 'n/a'}`);
    console.log(`  source coverage  : ${ocr.coverage != null ? (ocr.coverage*100).toFixed(1)+'%' : 'n/a'} (${ocr.matched ?? '?'}/${ocr.total ?? '?'} source words found in asset)`);
    console.log(`  ${ocr.note}`);
    for (const r of ocr.missingRuns) console.log(`    • missing run: "${r}"`);
  }
  console.log('\nEyes-on the copied image against the source, then record with:');
  console.log(`  --accept ${a.asset_path} --note "…"     (content faithfully preserved)`);
  console.log(`  --provisional ${a.asset_path} --note "…" (acknowledge, certify later)`);
  process.exit(0);
}

if (doSweep) {
  needEvid();
  console.log(`OCR reconciliation sweep over ${recon.length} reconstructed assets`);
  console.log('(coverage = fraction of source words found in the asset OCR; low coverage or missing runs = inspect)\n');
  const worrying = [];
  let done = 0;
  for (const a of recon) {
    const p = join(EVID, a.asset_path);
    if (!existsSync(p)) { console.log(`  [MISSING FILE] ${a.asset_path}`); continue; }
    const ocr = await ocrReconcile(p, sourceTextForUnit(db, a.unit_id));
    done++;
    if (!ocr.available) { console.log(`  [OCR n/a] ${a.asset_path} — ${ocr.note}`); continue; }
    const cov = ocr.coverage != null ? (ocr.coverage*100).toFixed(1)+'%' : 'n/a';
    const tag = (ocr.missingRunCount || (ocr.coverage != null && ocr.coverage < 0.85)) ? 'INSPECT' : 'ok';
    if (tag === 'INSPECT') worrying.push({ a, ocr });
    console.log(`  [${tag}] ${a.asset_path}  cov ${cov}  missingRuns ${ocr.missingRunCount ?? '?'}  status ${statusOf(a)}`);
    for (const r of ocr.missingRuns) console.log(`        • "${r}"`);
  }
  console.log(`\nsweep complete: ${done} OCR'd, ${worrying.length} flagged for eyes-on inspection`);
  process.exit(0);
}

// ---- default: status listing ------------------------------------------------
const counts = { accepted: 0, provisional: 0, UNCERTIFIED: 0 };
console.log(`Reconstructed evidence assets: ${recon.length}  (source-native crops are exempt and not listed)\n`);
const fam = db.prepare(`
  SELECT sf.name AS family FROM evidence_assets ea
   JOIN testimony_units tu ON tu.id = ea.unit_id
   JOIN documentary_objects o ON o.id = tu.object_id
   JOIN source_families sf ON sf.id = o.family_id
  WHERE ea.id = ?`);
for (const a of recon) {
  const s = statusOf(a); counts[s] = (counts[s] || 0) + 1;
  const family = fam.get(a.asset_id)?.family || '?';
  console.log(`  [${s.padEnd(11)}] ${family.padEnd(14)} ${a.asset_path}  (${a.reasons.join('; ')})`);
}
console.log(`\n  accepted ${counts.accepted} · provisional ${counts.provisional} · UNCERTIFIED ${counts.UNCERTIFIED}`);
if (counts.UNCERTIFIED)
  console.log(`\n  ${counts.UNCERTIFIED} UNCERTIFIED reconstruction(s) would ABORT a build. Run --review then --accept, or --provisional to acknowledge.`);
console.log(`\nregistry: ${ACCEPTANCE_PATH}`);
