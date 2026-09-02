/*
 * gygax-v2-reconstruction.mjs — the evidence-reconstruction control.
 *
 * Learned from the Ward "Greyhawk #2" correction: a *reconstructed* evidence
 * asset (one produced by joining source pages, removing preservation artefacts,
 * repairing continuity, or any operation capable of omitting or obscuring
 * source content) can silently drop text while every hash still verifies. Its
 * SHA-256 proves the prepared bytes equal the ingested bytes; it says nothing
 * about whether those bytes faithfully carry all of the source's words.
 *
 * The control is deliberately NARROW. It attaches ONLY to reconstruction, not
 * to ordinary deterministic source-native crops. Source-native crops stay
 * governed by the existing integrity / provenance / reconciliation controls;
 * they are NOT required to carry an individual human certification.
 *
 * Two mechanisms, in order of authority:
 *   1. HUMAN EYES-ON ACCEPTANCE  — a hard gate. A reconstructed asset may not
 *      become canonical (be encrypted for deployment) until a human has
 *      compared the reconstructed asset against the source and recorded an
 *      acceptance keyed to that exact asset SHA-256. Change the bytes and the
 *      acceptance no longer applies — it must be re-done. This is the gate.
 *   2. OCR / SOURCE-TEXT RECONCILIATION  — a WARNING only. OCR of the asset is
 *      diffed against the unit's discovery/source text to flag runs of source
 *      words that appear to be missing from the reconstruction. It is a finding
 *      aid to focus the human's eyes; it is NOT evidence and NOT a gate. The
 *      preservation source remains authoritative. OCR being unavailable never
 *      blocks anything.
 *
 * The frozen schema is untouched. Acceptance lives in a sha256-keyed JSONL
 * registry beside this file, outside the database.
 */
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ACCEPTANCE_PATH = join(HERE, 'gygax-v2-reconstructed-acceptance.jsonl');

// --------------------------------------------------------------- classifier
//
// An asset is "reconstructed" — content-affecting, and therefore gated — when
// it JOINS source pages or is otherwise a stitched/repaired derivative. Two
// structurally detectable signals, which in the current corpus coincide exactly:
//   * asset_type = 'stitched'  (the ingest bucket for any join/repair/continuity
//                               operation, including single-page in-place repair)
//   * more than one distinct evidence source (a multi-page join)
// Single-source 'crop' / 'page' / 'scan' assets are source-native and exempt.
//
// CONVENTION (enforced at ingest, not by the schema): any operation capable of
// omitting or obscuring source content — even on a single page — MUST be
// ingested as asset_type='stitched' so this gate sees it. A deterministic crop
// that only selects a region of one page stays 'crop'.
export function isReconstructed(assetType, sourceCount) {
  return assetType === 'stitched' || Number(sourceCount) > 1;
}

export function reasonsFor(assetType, sourceCount) {
  const r = [];
  if (assetType === 'stitched') r.push('asset_type=stitched');
  if (Number(sourceCount) > 1) r.push(`joins ${sourceCount} sources`);
  return r;
}

// Returns every reconstructed asset with the data the gate and the reviewer
// need. Pure read; does not touch the schema.
export function listReconstructed(db) {
  const rows = db.prepare(`
    SELECT ea.id AS asset_id, ea.unit_id, ea.asset_path, ea.asset_type, ea.sha256,
           (SELECT count(*) FROM evidence_sources es WHERE es.asset_id = ea.id) AS source_count
      FROM evidence_assets ea
     ORDER BY ea.id`).all();
  return rows
    .filter((r) => isReconstructed(r.asset_type, r.source_count))
    .map((r) => ({ ...r, reasons: reasonsFor(r.asset_type, r.source_count) }));
}

// The source text a reconstructed asset is reconciled against: the unit's
// discovery text (the source's own extracted words) plus any question/context.
// This is the corpus's record of what the source said — the yardstick for
// "did the reconstruction drop anything".
export function sourceTextForUnit(db, unitId) {
  const disc = db.prepare(
    'SELECT text FROM discovery_text WHERE unit_id = ? ORDER BY id').all(unitId);
  const ctx = db.prepare(
    'SELECT text FROM unit_context WHERE unit_id = ? ORDER BY sequence').all(unitId);
  return [...disc.map((d) => d.text || ''), ...ctx.map((c) => c.text || '')]
    .filter(Boolean).join('\n').trim();
}

// ------------------------------------------------------------ acceptance registry
//
// One JSON object per line. Keyed by the asset SHA-256, so re-stitching (which
// changes the bytes and thus the hash) invalidates the old acceptance and forces
// a fresh eyes-on pass. Records are append-only; the LAST record for a given
// sha256 wins, so a mistaken entry can be superseded without editing history.
export function loadAcceptance(path = ACCEPTANCE_PATH) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; }
    if (rec && rec.sha256) map.set(rec.sha256, rec);
  }
  return map;
}

export function appendAcceptance(rec, path = ACCEPTANCE_PATH) {
  appendFileSync(path, JSON.stringify(rec) + '\n');
}

// The gate decision for a single reconstructed asset, given the loaded registry.
// requireAccepted=false (default): an entry of any status (accepted|provisional)
// satisfies the gate; a MISSING entry fails (the Ward-failure guard — a new or
// changed reconstruction that no human has acknowledged).
// requireAccepted=true (strict): only status='accepted' satisfies.
export function gateAsset(rec, { requireAccepted = false } = {}) {
  if (!rec) return { ok: false, reason: 'no acceptance record for this asset SHA-256' };
  if (requireAccepted && rec.status !== 'accepted')
    return { ok: false, reason: `status is "${rec.status}", strict build requires "accepted"` };
  return { ok: true, status: rec.status };
}

// ------------------------------------------------------------- OCR reconciliation
//
// WARNING mechanism only — never a gate. Diffs OCR of the reconstructed asset
// against the source text and reports runs of source words the OCR did not find.
// Missing runs are a prompt for the human's eyes, not a verdict.
const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/[‘’“”]/g, "'")
  .replace(/[^a-z0-9']+/g, ' ')
  .split(/\s+/).filter(Boolean);

// Longest runs of consecutive source words absent from the OCR word multiset.
// A run of >= minRun missing words is what we surface (isolated single-word
// misses are usually OCR noise, not dropped content).
function missingRuns(sourceWords, ocrWords, minRun = 4) {
  const ocr = new Map();
  for (const w of ocrWords) ocr.set(w, (ocr.get(w) || 0) + 1);
  const avail = new Map(ocr);
  const present = sourceWords.map((w) => {
    const n = avail.get(w) || 0;
    if (n > 0) { avail.set(w, n - 1); return true; }
    return false;
  });
  const runs = [];
  let i = 0;
  while (i < present.length) {
    if (present[i]) { i++; continue; }
    let j = i;
    while (j < present.length && !present[j]) j++;
    if (j - i >= minRun) runs.push(sourceWords.slice(i, j).join(' '));
    i = j;
  }
  const matched = present.filter(Boolean).length;
  return {
    runs,
    matched,
    total: sourceWords.length,
    coverage: sourceWords.length ? matched / sourceWords.length : 1,
  };
}

// Lazily load tesseract.js. It is a developer-time dependency for the
// acceptance workflow, NOT a build or deploy dependency, and is not committed
// to the repo (large WASM). Resolve order: normal import, then
// GYGAX_TESSERACT_DIR/node_modules/tesseract.js. If it cannot be loaded, OCR
// is reported as unavailable and the caller proceeds without a warning.
let _tess;
async function getTesseract() {
  if (_tess !== undefined) return _tess;
  const tries = ['tesseract.js'];
  if (process.env.GYGAX_TESSERACT_DIR)
    tries.push(join(process.env.GYGAX_TESSERACT_DIR, 'node_modules/tesseract.js/src/index.js'));
  for (const spec of tries) {
    try { _tess = await import(spec); return _tess; } catch { /* next */ }
  }
  _tess = null;
  return _tess;
}

// Runs OCR (if available) and reconciles it against sourceText.
// Returns { available, coverage, missingRuns, missingRunCount, ocrConfidence,
//           note } — always a soft report, never throws for a bad image.
export async function ocrReconcile(imagePath, sourceText, { minRun = 4 } = {}) {
  const src = norm(sourceText);
  const t = await getTesseract();
  if (!t || !t.createWorker) {
    return { available: false, note: 'tesseract.js not installed; OCR warning skipped (not a gate)' };
  }
  let text = '', confidence = null;
  const worker = await t.createWorker('eng');
  try {
    const { data } = await worker.recognize(imagePath);
    text = data.text || '';
    confidence = typeof data.confidence === 'number' ? data.confidence : null;
  } catch (e) {
    await worker.terminate();
    return { available: false, note: 'OCR failed (' + (e.message || e) + '); warning skipped' };
  }
  await worker.terminate();
  if (!src.length)
    return { available: true, ocrConfidence: confidence, coverage: null,
             missingRuns: [], missingRunCount: 0, note: 'no source text on file to reconcile against' };
  const m = missingRuns(src, norm(text), minRun);
  return {
    available: true,
    ocrConfidence: confidence,
    coverage: m.coverage,
    matched: m.matched,
    total: m.total,
    missingRuns: m.runs,
    missingRunCount: m.runs.length,
    note: m.runs.length
      ? `${m.runs.length} run(s) of source words not found in the asset OCR — inspect for dropped/obscured text`
      : 'OCR found every run of source words; no omission signal',
  };
}
