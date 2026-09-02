#!/usr/bin/env node
/*
 * build-gygax-v2.mjs — produce the encrypted v2 deployment assets.
 *
 *   canonical v2 SQLite
 *     -> rollback-mode deployment copy (VACUUM INTO)
 *     -> verification (abort on integrity failure; report curation states)
 *     -> gzip -> PBKDF2-SHA-256(600k) -> AES-256-GCM  -> corpus.enc
 *     -> every evidence asset encrypted individually  -> <asset>.enc
 *   then all derived plaintext is deleted.
 *
 * One key derivation for the whole corpus. The database asset carries the salt
 * and iteration count; every asset gets its OWN fresh random IV, and AES-GCM
 * associated data binds each ciphertext to its logical identity.
 *
 * Container (41-byte header, identical for both kinds):
 *   magic "GXE1" | version=2 | kind(1=db,2=asset) | kdf | cipher | comp
 *                | iterations(u32 LE) | salt(16) | iv(12) | ciphertext‖tag
 *
 * Usage:
 *   node --experimental-sqlite scripts/build-gygax-v2.mjs <v2.sqlite> \
 *        [--evidence-dir <plaintext dir>] [--out-dir <deploy dir>] [--allow-weak]
 */
import { DatabaseSync } from 'node:sqlite';
import { webcrypto, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const ITER = 600000;
const MAGIC = [0x47, 0x58, 0x45, 0x31]; // "GXE1"
const AAD_DB = 'gygax-v2:db';
const aadAsset = (p) => 'gygax-v2:asset:' + p;

const args = process.argv.slice(2);
const takeFlag = (n) => { const i = args.indexOf(n); if (i < 0) return null; if (args[i + 1] && !args[i + 1].startsWith('--')) return args.splice(i, 2)[1]; args.splice(i, 1); return true; };
const EVID = takeFlag('--evidence-dir');
const OUTDIR = takeFlag('--out-dir') || join(REPO, 'static/research/gygax/v2');
const ALLOW_WEAK = args.includes('--allow-weak');
const DB_PATH = args.filter((a) => !a.startsWith('--'))[0];
if (!DB_PATH) { console.error('Usage: node --experimental-sqlite scripts/build-gygax-v2.mjs <v2.sqlite> [--evidence-dir d] [--out-dir d]'); process.exit(2); }

const die = (m) => { console.error('\nBUILD ABORTED: ' + m); process.exit(1); };
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const shaFile = (p) => sha(readFileSync(p));

async function promptPassphrase() {
  if (process.env.GYGAX_PASSPHRASE) return process.env.GYGAX_PASSPHRASE;
  process.stdout.write('Passphrase (input hidden): ');
  return await new Promise((res) => {
    const si = process.stdin, buf = [];
    si.setRawMode && si.setRawMode(true); si.resume();
    si.on('data', function h(d) {
      for (const ch of d) {
        if (ch === 3) process.exit(130);
        if (ch === 13 || ch === 10) { si.setRawMode && si.setRawMode(false); si.pause(); si.removeListener('data', h); process.stdout.write('\n'); return res(Buffer.from(buf).toString('utf8')); }
        if (ch === 127) { buf.pop(); continue; }
        buf.push(ch);
      }
    });
  });
}

function header(kind, comp, salt, iv) {
  const h = new Uint8Array(41);
  h.set(MAGIC, 0); h[4] = 2; h[5] = kind; h[6] = 1; h[7] = 1; h[8] = comp;
  new DataView(h.buffer).setUint32(9, ITER, true);
  h.set(salt, 13); h.set(iv, 29);
  return h;
}

(async () => {
  console.log('Gygax v2 corpus build');
  console.log('  canonical v2 : ' + DB_PATH);
  const canonSha = shaFile(DB_PATH);
  console.log('  canonical SHA-256 : ' + canonSha);

  // ---- derived rollback-mode copy (canonical opened read-only) -------------
  const tmp = mkdtempSync(join(tmpdir(), 'gygaxv2-'));
  const derived = join(tmp, 'corpus.deploy.sqlite');
  const srcDb = new DatabaseSync(DB_PATH, { readOnly: true });
  srcDb.exec(`VACUUM INTO '${derived.replace(/'/g, "''")}'`);
  const canonCounts = counts(srcDb), canonHash = contentHash(srcDb);
  srcDb.close();

  // The derived copy is our own disposable artifact and is opened read-write:
  // FTS5 'integrity-check' is issued as a write and needs a writable handle.
  // The canonical database was opened read-only above and is never modified.
  const db = new DatabaseSync(derived);
  let fail = null;
  const check = (n, ok, extra = '') => { console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${extra ? ' — ' + extra : ''}`); if (!ok && !fail) fail = n; };

  console.log('\nVerification (derived vs canonical):');
  check('integrity_check = ok', db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
  const dCounts = counts(db);
  for (const k of Object.keys(canonCounts))
    check(`${k} count matches`, dCounts[k] === canonCounts[k], `${dCounts[k]} vs ${canonCounts[k]}`);
  check('content hash matches (substantive data)', contentHash(db) === canonHash);
  for (const t of ['units_fts', 'context_fts', 'discovery_fts']) {
    try { db.exec(`INSERT INTO ${t}(${t}) VALUES('integrity-check')`); check(`${t} integrity-check`, true); }
    catch (e) { check(`${t} integrity-check`, false, e.message); }
  }
  // FTS must reflect its content table exactly
  check('units_fts row count matches verified units',
    db.prepare('SELECT count(*) c FROM units_fts').get().c ===
    db.prepare('SELECT count(*) c FROM testimony_units').get().c);
  check('no machine text in transcripts (structural)',
    db.prepare(`SELECT count(*) c FROM testimony_units
                WHERE (transcript_status='untranscribed' AND transcript<>'')
                   OR (transcript_status='verified' AND length(transcript)=0)`).get().c === 0);

  // ---- reconciliation work-list (reported, never fatal) --------------------
  console.log('\nReconciliation work-list (curation states, not failures):');
  const rep = (label, rows) => console.log(`  ${String(rows).padStart(5)}  ${label}`);
  rep('inferred numbers colliding with an observed number', db.prepare(`
      SELECT count(*) c FROM testimony_units a JOIN testimony_units b
        ON a.object_id=b.object_id AND a.unit_number=b.unit_number AND a.id<>b.id
      WHERE a.unit_number_status='inferred'
        AND b.unit_number_status IN ('observed','independently_confirmed')`).get().c);
  rep('duplicate inferred numbers', db.prepare(`
      SELECT count(*) c FROM testimony_units a JOIN testimony_units b
        ON a.object_id=b.object_id AND a.unit_number=b.unit_number AND a.id<b.id
      WHERE a.unit_number_status='inferred' AND b.unit_number_status='inferred'`).get().c);
  rep('units with evidence but no transcript', db.prepare(`
      SELECT count(DISTINCT u.id) c FROM testimony_units u JOIN evidence_assets e ON e.unit_id=u.id
      WHERE u.transcript_status='untranscribed'`).get().c);
  rep('verified units with no evidence asset', db.prepare(`
      SELECT count(*) c FROM testimony_units u
      WHERE u.transcript_status='verified'
        AND NOT EXISTS (SELECT 1 FROM evidence_assets e WHERE e.unit_id=u.id)`).get().c);
  rep('units with unknown discourse_mode', db.prepare(
      `SELECT count(*) c FROM testimony_units WHERE discourse_mode='unknown'`).get().c);
  rep('documentary objects with no coverage segment', db.prepare(`
      SELECT count(*) c FROM documentary_objects o
      WHERE NOT EXISTS (SELECT 1 FROM coverage v WHERE v.object_id=o.id)`).get().c);

  if (fail) { db.close(); rmSync(tmp, { recursive: true, force: true }); die(`verification failed at "${fail}" — no assets produced.`); }

  // ---- passphrase + single key derivation ---------------------------------
  const pass = await promptPassphrase();
  if (pass.trim().split(/\s+/).filter(Boolean).length < 6 && !ALLOW_WEAK) {
    db.close(); rmSync(tmp, { recursive: true, force: true });
    die('passphrase has fewer than 6 words. Use a randomly generated 6+ word Diceware passphrase.');
  }
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const baseKey = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

  const enc = async (bytes, kind, comp, aad, path) => {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));   // FRESH per asset
    const ct = new Uint8Array(await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, bytes));
    const h = header(kind, comp, salt, iv);
    const out = new Uint8Array(h.length + ct.length); out.set(h, 0); out.set(ct, h.length);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, out);
    return { iv, bytes: out.length };
  };

  // ---- database asset ------------------------------------------------------
  // The deployed image must be rollback-mode: an in-memory database opened from
  // bytes has no -wal file, so a WAL-mode image cannot be opened in the browser.
  const hdr = readFileSync(derived).subarray(0, 20);
  if (hdr[18] !== 1 || hdr[19] !== 1)
    die(`derived image is not rollback-mode (header ${hdr[18]}/${hdr[19]}); it would not open in the browser.`);
  mkdirSync(OUTDIR, { recursive: true });
  const dbOut = join(OUTDIR, 'corpus.enc');
  const dbInfo = await enc(gzipSync(readFileSync(derived)), 1, 1, AAD_DB, dbOut);
  const derivedSha = shaFile(derived);

  // ---- evidence assets: fresh IV each, AAD-bound, hash-verified ------------
  const assets = db.prepare('SELECT asset_path, sha256 FROM evidence_assets ORDER BY id').all();
  console.log(`\nEvidence assets: ${assets.length}`);
  const ivsSeen = new Set([Buffer.from(dbInfo.iv).toString('hex')]);
  let encrypted = 0;
  for (const a of assets) {
    if (!EVID) { db.close(); rmSync(tmp, { recursive: true, force: true }); die('evidence assets present but --evidence-dir not given.'); }
    const srcPath = join(EVID, a.asset_path);
    if (!existsSync(srcPath)) { db.close(); rmSync(tmp, { recursive: true, force: true }); die(`missing evidence file: ${a.asset_path}`); }
    const plain = readFileSync(srcPath);
    if (sha(plain) !== a.sha256) { db.close(); rmSync(tmp, { recursive: true, force: true }); die(`SHA-256 mismatch for ${a.asset_path} (file does not match the database record).`); }
    const outPath = join(OUTDIR, a.asset_path + '.enc');
    const info = await enc(plain, 2, 0, aadAsset(a.asset_path), outPath);
    const ivHex = Buffer.from(info.iv).toString('hex');
    if (ivsSeen.has(ivHex)) { db.close(); rmSync(tmp, { recursive: true, force: true }); die('IV reuse detected — aborting.'); }
    ivsSeen.add(ivHex);
    // round-trip: decrypt under its AAD and confirm the hash still matches
    const back = new Uint8Array(await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: info.iv, additionalData: new TextEncoder().encode(aadAsset(a.asset_path)) },
      key, readFileSync(outPath).subarray(41)));
    if (sha(Buffer.from(back)) !== a.sha256) { db.close(); rmSync(tmp, { recursive: true, force: true }); die(`round-trip failed for ${a.asset_path}`); }
    encrypted++;
  }
  console.log(`  ${encrypted} encrypted, fresh IV each, AAD-bound, round-trip verified`);

  db.close();
  rmSync(tmp, { recursive: true, force: true });   // delete derived plaintext

  console.log('\nDeployment assets written:');
  console.log(`  ${dbOut}  (${dbInfo.bytes.toLocaleString()} bytes)`);
  if (encrypted) console.log(`  ${join(OUTDIR, 'evidence')}/…  (${encrypted} encrypted assets)`);
  console.log('\nAudit trail:');
  console.log('  canonical v2 SHA-256 : ' + canonSha);
  console.log('  derived     SHA-256 : ' + derivedSha);
  console.log('  KDF PBKDF2-HMAC-SHA-256 x' + ITER + ' · AES-256-GCM · one key, fresh IV per asset');
  console.log('  derived plaintext deleted; canonical untouched.');
})().catch((e) => die(e.stack || String(e)));

// ---------------------------------------------------------------- helpers
function counts(db) {
  const n = (t) => db.prepare(`SELECT count(*) c FROM ${t}`).get().c;
  return {
    persons: n('persons'), families: n('source_families'), objects: n('documentary_objects'),
    units: n('testimony_units'), context: n('unit_context'), assets: n('evidence_assets'),
    sources: n('evidence_sources'), tags: n('tags'), unit_tags: n('unit_tags'),
    annotations: n('annotations'), relations: n('testimony_relations'),
    discovery: n('discovery_text'), coverage: n('coverage'),
  };
}
function contentHash(db) {
  const h = createHash('sha256');
  const feed = (label, rows) => { h.update('\x1d' + label); for (const r of rows) h.update('\x1e' + JSON.stringify(r)); };
  feed('persons', db.prepare('SELECT id,name,notes FROM persons ORDER BY id').all());
  feed('families', db.prepare('SELECT id,name,kind,notes FROM source_families ORDER BY id').all());
  feed('objects', db.prepare('SELECT * FROM documentary_objects ORDER BY id').all());
  feed('units', db.prepare('SELECT * FROM testimony_units ORDER BY id').all());
  feed('context', db.prepare('SELECT * FROM unit_context ORDER BY id').all());
  feed('assets', db.prepare('SELECT * FROM evidence_assets ORDER BY id').all());
  feed('sources', db.prepare('SELECT * FROM evidence_sources ORDER BY id').all());
  feed('tags', db.prepare('SELECT id,name FROM tags ORDER BY id').all());
  feed('unit_tags', db.prepare('SELECT unit_id,tag_id FROM unit_tags ORDER BY unit_id,tag_id').all());
  feed('annotations', db.prepare('SELECT * FROM annotations ORDER BY id').all());
  feed('relations', db.prepare('SELECT * FROM testimony_relations ORDER BY id').all());
  feed('discovery', db.prepare('SELECT * FROM discovery_text ORDER BY id').all());
  feed('coverage', db.prepare('SELECT * FROM coverage ORDER BY id').all());
  return h.digest('hex');
}
