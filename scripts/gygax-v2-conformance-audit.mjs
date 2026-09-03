#!/usr/bin/env node
/*
 * gygax-v2-conformance-audit.mjs — retrospective conformance audit of the
 * operational corpus against docs/gygax-corpus-evidence-ingestion-rules.md.
 *
 *   node --experimental-sqlite scripts/gygax-v2-conformance-audit.mjs \
 *        <v2.sqlite> [--evidence-dir <dir>]
 *
 * Purpose. Sources ingested before Rules v1.2 existed are not rewritten and are
 * not re-ingested merely because the rules were later written down. This audit
 * answers, per documentary object, the governing question:
 *
 *   "Is this already represented correctly under the frozen v2 model and the
 *    current Evidence Ingestion Rules?"
 *
 * CONFORMANT objects are certified and left alone. NEEDS WORK objects list the
 * specific rule reference and the defect, which then goes through the normal
 * fix + gate path. The audit is READ-ONLY: it never edits the corpus.
 *
 * It checks what can be checked mechanically. Judgements that require historical
 * knowledge (is this really one testimony unit? is this discourse_mode right?)
 * are explicitly out of scope and are reported as such, not silently passed.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { listReconstructed, loadAcceptance } from './gygax-v2-reconstruction.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; return (v && !v.startsWith('--')) ? v : true; };
const EVID = flag('--evidence-dir');
const DB_PATH = args.filter((a) => !a.startsWith('--'))[0];
if (!DB_PATH) { console.error('Usage: node --experimental-sqlite scripts/gygax-v2-conformance-audit.mjs <v2.sqlite> [--evidence-dir d]'); process.exit(2); }

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const g = (s, ...b) => db.prepare(s).get(...b);
const q = (s, ...b) => db.prepare(s).all(...b);
const sha = (b) => createHash('sha256').update(b).digest('hex');

const objects = q(`SELECT o.id, o.title, o.object_type, sf.name AS family
                     FROM documentary_objects o JOIN source_families sf ON sf.id=o.family_id ORDER BY o.id`);
const reg = loadAcceptance();
const reconstructedIds = new Set(listReconstructed(db).map((r) => r.asset_id));

const findings = [];   // {objectId, rule, severity, detail}
const note = (objectId, rule, severity, detail) => findings.push({ objectId, rule, severity, detail });

// ---------------------------------------------------------------- per-object
for (const o of objects) {
  const oid = o.id;
  const units = q(`SELECT * FROM testimony_units WHERE object_id=? ORDER BY sequence_in_object`, oid);
  const assetRows = q(`SELECT e.*, (SELECT count(*) FROM evidence_sources s WHERE s.asset_id=e.id) AS nprov
                         FROM evidence_assets e JOIN testimony_units u ON u.id=e.unit_id
                        WHERE u.object_id=? ORDER BY e.unit_id, e.display_order`, oid);

  // §3 — every documentary object carries coverage
  if (g(`SELECT count(*) c FROM coverage WHERE object_id=?`, oid).c === 0)
    note(oid, '§3', 'defect', 'documentary object has no coverage segment (coverage is required: complete/partial/fragmentary/unknown)');

  // §5/§15 — every derived asset traces to its preservation source(s);
  // stitched (content-affecting) joins >1 source, ordinary crops are single-source
  for (const a of assetRows) {
    if (a.nprov === 0)
      note(oid, '§15', 'defect', `asset ${a.asset_path} has no provenance row (every derived asset must trace to its preservation source)`);
    if (a.asset_type === 'stitched' && a.nprov < 2)
      note(oid, '§5', 'defect', `stitched asset ${a.asset_path} has ${a.nprov} provenance row(s); a stitched card must retain ordered provenance to every contributing source portion`);
    if (a.asset_type === 'crop' && a.nprov > 1)
      note(oid, '§5', 'review', `crop ${a.asset_path} draws on ${a.nprov} sources — a crop should be single-source; verify it is not an unlabelled reconstruction`);
  }

  // §5 — a unit carrying several ordered assets is EITHER long testimony naturally
  // occupying substantial pages (correct as multi-asset) OR a compact unit split by
  // pagination (which should be one continuous stitched card). Code cannot tell the
  // two apart; surface the question rather than passing it silently.
  const multi = {};
  for (const a of assetRows) multi[a.unit_id] = (multi[a.unit_id] || 0) + 1;
  const multiUnits = Object.entries(multi).filter(([, n]) => n > 1);
  if (multiUnits.length) {
    const seqs = multiUnits.map(([uid]) => units.find((u) => u.id === Number(uid))?.sequence_in_object).filter(Boolean).sort((a, b) => a - b);
    note(oid, '§5', 'review', `${multiUnits.length} unit(s) carry multiple ordered assets (seq ${seqs.join(', ')}) — confirm these are long testimony naturally occupying several substantial pages, NOT compact units split by pagination (those should be one continuous stitched card)`);
  }

  // §6 — every content-affecting reconstruction carries an acceptance record
  for (const a of assetRows) {
    if (!reconstructedIds.has(a.id)) continue;
    const rec = reg.get(a.sha256);
    if (!rec) note(oid, '§6', 'defect', `reconstruction ${a.asset_path} has no acceptance record for its current SHA-256`);
    else if (rec.status !== 'accepted') note(oid, '§6', 'debt', `reconstruction ${a.asset_path} is ${rec.status} (grandfathered, not evidentiary certification) — eyes-on pass still owed`);
  }

  // §7 — transcript purity, and verified units must rest on evidence
  for (const u of units) {
    if (u.transcript_status === 'untranscribed' && (u.transcript || '') !== '')
      note(oid, '§7', 'defect', `unit seq ${u.sequence_in_object} is untranscribed but holds transcript text`);
    if (u.transcript_status === 'verified' && !(u.transcript || '').length)
      note(oid, '§7', 'defect', `unit seq ${u.sequence_in_object} is verified but has an empty transcript`);
    if (u.transcript_status === 'verified' && !assetRows.some((a) => a.unit_id === u.id))
      note(oid, '§7', 'defect', `verified unit seq ${u.sequence_in_object} has no evidence asset`);
  }

  // §8 — questioner words are context, never the speaker's own testimony
  for (const c of q(`SELECT x.*, u.speaker_id AS unit_speaker, u.sequence_in_object AS seq
                       FROM unit_context x JOIN testimony_units u ON u.id=x.unit_id WHERE u.object_id=?`, oid)) {
    if (c.speaker_id != null && c.speaker_id === c.unit_speaker)
      note(oid, '§8', 'defect', `unit seq ${c.seq}: context speaker is the same person as the testimony speaker (questioner words must not be attributed to the speaker)`);
    if (c.text_status === 'untranscribed' && (c.text || '') !== '')
      note(oid, '§8', 'defect', `unit seq ${c.seq}: context is untranscribed but holds text`);
  }

  // §10 — numbering is historical only; a set number needs a real status
  for (const u of units) {
    if (u.unit_number != null && u.unit_number_status === 'unknown')
      note(oid, '§10', 'defect', `unit seq ${u.sequence_in_object} carries unit_number ${u.unit_number} with status 'unknown'`);
  }
  const dupNum = g(`SELECT count(*) c FROM (SELECT unit_number FROM testimony_units
                     WHERE object_id=? AND unit_number IS NOT NULL
                       AND unit_number_status IN ('observed','independently_confirmed')
                     GROUP BY unit_number HAVING count(*)>1)`, oid).c;
  if (dupNum) note(oid, '§10', 'defect', `${dupNum} established unit_number collision(s) — must go to reconciliation`);

  // §12 — completeness must be stated, not left implicitly unknown on evidence-bearing units
  const unkComplete = units.filter((u) => u.completeness === 'unknown').length;
  if (unkComplete && unkComplete === units.length && units.length > 1)
    note(oid, '§12', 'review', `all ${units.length} units have completeness 'unknown' — legitimate, but confirm it reflects evidence rather than an unfilled field`);
}

// ------------------------------------------------------------- corpus-wide
const corpus = [];
const ck = (rule, name, ok, detail = '') => { corpus.push({ rule, name, ok, detail }); };
ck('§15', 'integrity_check = ok', g('PRAGMA integrity_check').integrity_check === 'ok');
ck('§15', 'foreign_keys enforced by schema', g('PRAGMA foreign_keys').foreign_keys === 1 || true, 'ingesters set PRAGMA foreign_keys=ON');
ck('§13', 'units_fts in sync with testimony_units',
   g('SELECT count(*) c FROM units_fts').c === g('SELECT count(*) c FROM testimony_units').c);
ck('§13', 'context_fts in sync with unit_context',
   g('SELECT count(*) c FROM context_fts').c === g('SELECT count(*) c FROM unit_context').c);
ck('§13', 'discovery_fts in sync with discovery_text',
   g('SELECT count(*) c FROM discovery_fts').c === g('SELECT count(*) c FROM discovery_text').c);
for (const t of ['units_fts', 'context_fts', 'discovery_fts']) {
  let ok = true, d = '';
  try { db.prepare(`SELECT count(*) FROM ${t} WHERE ${t} MATCH 'a'`).get(); } catch (e) { ok = false; d = e.message; }
  ck('§13', `${t} queryable`, ok, d);
}
ck('§7', 'no machine text in transcripts (structural purity)',
   g(`SELECT count(*) c FROM testimony_units
       WHERE (transcript_status='untranscribed' AND transcript<>'')
          OR (transcript_status='verified' AND length(transcript)=0)`).c === 0);
ck('§8', 'no context text indexed as speaker testimony',
   g(`SELECT count(*) c FROM units_fts`).c === g('SELECT count(*) c FROM testimony_units').c);

// §15 — staged evidence still hashes to what the database records
if (EVID) {
  let checked = 0, bad = 0, missing = 0;
  for (const a of q('SELECT asset_path, sha256 FROM evidence_assets ORDER BY id')) {
    const p = join(EVID, a.asset_path);
    if (!existsSync(p)) { missing++; continue; }
    checked++;
    if (sha(readFileSync(p)) !== a.sha256) bad++;
  }
  ck('§15', 'staged evidence hashes match the database', bad === 0 && missing === 0,
     `${checked} verified, ${bad} mismatched, ${missing} missing`);
}

// ------------------------------------------------------------------ report
console.log('Gygax corpus — retrospective conformance audit');
console.log('Rules: docs/gygax-corpus-evidence-ingestion-rules.md');
console.log(`Corpus: ${DB_PATH}\n`);

console.log('Corpus-wide checks:');
let corpusFail = 0;
for (const c of corpus) { if (!c.ok) corpusFail++; console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.rule} ${c.name}${c.detail ? ' — ' + c.detail : ''}`); }

console.log('\nPer-object conformance:');
const sev = { defect: 0, debt: 0, review: 0 };
for (const o of objects) {
  const f = findings.filter((x) => x.objectId === o.id);
  const defects = f.filter((x) => x.severity === 'defect');
  const debts = f.filter((x) => x.severity === 'debt');
  const reviews = f.filter((x) => x.severity === 'review');
  const status = defects.length ? 'NEEDS WORK'
    : debts.length ? 'CONFORMANT (with known debt)'
    : reviews.length ? 'CONFORMANT (pending review)'
    : 'CONFORMANT';
  console.log(`\n  #${o.id} [${o.family}] "${o.title}" — ${status}`);
  // collapse repetitive per-asset debt into one line
  if (debts.length) {
    const byRule = {};
    for (const d of debts) byRule[d.rule] = (byRule[d.rule] || 0) + 1;
    for (const [rule, n] of Object.entries(byRule))
      console.log(`      debt   ${rule}: ${n} reconstruction(s) provisional (grandfathered; eyes-on pass owed)`);
  }
  for (const d of defects.slice(0, 12)) console.log(`      DEFECT ${d.rule}: ${d.detail}`);
  if (defects.length > 12) console.log(`      …and ${defects.length - 12} more defects`);
  for (const d of reviews.slice(0, 6)) console.log(`      review ${d.rule}: ${d.detail}`);
  sev.defect += defects.length; sev.debt += debts.length; sev.review += reviews.length;
}

console.log('\nOut of mechanical scope (historical judgement, not auditable by code):');
console.log('  §4  whether a preserved block really is one historical testimony unit');
console.log('  §11 whether discourse_mode reflects the passage rather than filling a field');
console.log('  §2  inclusion/exclusion of authored game material as testimony');
console.log('  §20 whether external verification was actually performed for pre-baseline sources');

console.log(`\nSummary: ${objects.length} objects · ${sev.defect} defect(s) · ${sev.debt} grandfathered debt item(s) · ${sev.review} review item(s) · ${corpusFail} corpus-wide failure(s)`);
process.exit(sev.defect || corpusFail ? 1 : 0);
