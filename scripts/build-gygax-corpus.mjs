#!/usr/bin/env node
/*
 * build-gygax-corpus.mjs — produce the encrypted deployment asset for the
 * private Gary Gygax ENWorld Q&A research page.
 *
 * Pipeline (per approved design, option B):
 *   canonical SQLite  →  rollback-mode deployment copy (VACUUM INTO)
 *                     →  verification (abort on any failure)
 *                     →  gzip  →  PBKDF2-SHA-256(600k)  →  AES-256-GCM
 *                     →  static/research/gygax/gygax_enworld.enc
 *   then the derived plaintext copy is deleted.
 *
 * The canonical database is opened READ-ONLY and never modified.
 * The derived plaintext copy is written to the OS temp dir (never the repo)
 * and deleted after a successful build. Neither plaintext database nor the
 * passphrase is ever written into the repository or the deployed site.
 *
 * Crypto is Node's Web Crypto (node:crypto webcrypto), identical to the
 * browser's, so the page can always decrypt what this produces.
 *
 * Requirements: Node >= 22.5 with --experimental-sqlite, or Node >= 24.
 *   node --experimental-sqlite scripts/build-gygax-corpus.mjs <canonical.sqlite>
 *
 * Flags:
 *   --out <path>            output .enc (default static/research/gygax/gygax_enworld.enc)
 *   --regen-expectations    rewrite scripts/gygax-regression.v1.json from THIS database
 *                           (deliberate action when moving to a new corpus version)
 *   --allow-weak           permit a passphrase weaker than 6 words (testing only)
 *
 * Passphrase: read from the GYGAX_PASSPHRASE env var if set (non-interactive,
 * for automated tests), otherwise prompted with no echo. Never stored.
 */
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PBKDF2_ITER = 600000;
const REG_PATH = join(HERE, 'gygax-regression.v1.json');
const MAGIC = Uint8Array.from([0x47, 0x58, 0x45, 0x31]); // "GXE1"

const args = process.argv.slice(2);
// Take a valued flag exactly once (mutates args). Returns the value, true (bare), or null.
const takeFlag = (name) => { const i = args.indexOf(name); if (i < 0) return null; if (args[i + 1] && !args[i + 1].startsWith('--')) return args.splice(i, 2)[1]; args.splice(i, 1); return true; };
const outFlag = takeFlag('--out');
const OUT = (typeof outFlag === 'string' ? outFlag : null) || join(REPO, 'static/research/gygax/gygax_enworld.enc');
const REGEN = args.includes('--regen-expectations');
const ALLOW_WEAK = args.includes('--allow-weak');
const positional = args.filter((a) => !a.startsWith('--'));
const CANON = positional[0];
if (!CANON) { console.error('Usage: node --experimental-sqlite scripts/build-gygax-corpus.mjs <canonical.sqlite> [--out x.enc] [--regen-expectations]'); process.exit(2); }

const die = (msg) => { console.error('\nBUILD ABORTED: ' + msg); process.exit(1); };
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function counts(db) {
  const n = (t) => db.prepare(`SELECT count(*) c FROM ${t}`).get().c;
  return { documents: n('documents'), chunks: n('chunks'), coverage: n('coverage'), annotations: n('annotations') };
}
// Deterministic content hash over the SUBSTANTIVE data (not the file bytes),
// so canonical and derived can be proven content-identical despite VACUUM.
function contentHash(db) {
  const h = createHash('sha256');
  const feed = (label, rows) => { h.update('\x1d' + label); for (const r of rows) h.update('\x1e' + JSON.stringify(r)); };
  feed('documents', db.prepare('SELECT id,title,thread_part,source_type,source_file,authority,notes,sha256 FROM documents ORDER BY id').all());
  feed('chunks', db.prepare('SELECT id,document_id,source_locator,post_number,post_date,author,text,verification_status,completeness FROM chunks ORDER BY id').all());
  feed('coverage', db.prepare('SELECT id,thread_part,coverage_status,detail,known_loss FROM coverage ORDER BY id').all());
  feed('annotations', db.prepare('SELECT id,chunk_id,tag,note FROM annotations ORDER BY id').all());
  return h.digest('hex');
}
const ftsCount = (db, q) => db.prepare('SELECT count(*) c FROM chunks_fts WHERE chunks_fts MATCH ?').get(q).c;

async function promptPassphrase() {
  if (process.env.GYGAX_PASSPHRASE) return process.env.GYGAX_PASSPHRASE;
  process.stdout.write('Passphrase (input hidden): ');
  return await new Promise((res) => {
    const stdin = process.stdin; const chunks = [];
    const prev = stdin.isRaw; stdin.setRawMode && stdin.setRawMode(true); stdin.resume();
    stdin.on('data', function onData(d) {
      for (const ch of d) {
        if (ch === 3) { process.exit(130); }         // Ctrl-C
        if (ch === 13 || ch === 10) {                 // Enter
          stdin.setRawMode && stdin.setRawMode(prev); stdin.pause(); stdin.removeListener('data', onData);
          process.stdout.write('\n'); return res(Buffer.from(chunks).toString('utf8'));
        }
        if (ch === 127) { chunks.pop(); continue; }   // Backspace
        chunks.push(ch);
      }
    });
  });
}

(async () => {
  console.log('Gygax corpus build');
  console.log('  canonical : ' + CANON);
  const canonSha = sha256File(CANON);
  console.log('  canonical SHA-256 : ' + canonSha);

  // 1. Derived rollback-mode copy in the OS temp dir (never the repo).
  const tmp = mkdtempSync(join(tmpdir(), 'gygax-'));
  const derived = join(tmp, 'gygax_enworld.deploy.sqlite');
  const src = new DatabaseSync(CANON, { readOnly: true });
  src.exec(`VACUUM INTO '${derived.replace(/'/g, "''")}'`);
  // Canonical checks read from the same read-only handle.
  const canonCounts = counts(src), canonContent = contentHash(src);
  src.close();

  const ddb = new DatabaseSync(derived, { readOnly: true });
  let fail = null;
  const check = (name, ok, detail = '') => { console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); if (!ok && !fail) fail = name; };

  console.log('\nVerification (derived vs canonical):');
  check('integrity_check = ok', ddb.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
  const dCounts = counts(ddb);
  for (const k of ['documents', 'chunks', 'coverage', 'annotations'])
    check(`${k} count matches`, dCounts[k] === canonCounts[k], `${dCounts[k]} vs ${canonCounts[k]}`);
  check('content hash matches (substantive data)', contentHash(ddb) === canonContent);
  let ftsOk = true; try { ftsCount(ddb, 'Greyhawk'); } catch { ftsOk = false; }
  check('FTS5 available', ftsOk);
  try { ddb.prepare("SELECT bm25(chunks_fts) FROM chunks_fts WHERE chunks_fts MATCH 'Greyhawk' LIMIT 1").get(); check('bm25() available', true); } catch { check('bm25() available', false); }
  try { ddb.prepare("SELECT snippet(chunks_fts,0,'[',']','…',8) FROM chunks_fts WHERE chunks_fts MATCH 'Greyhawk' LIMIT 1").get(); check('snippet() available', true); } catch { check('snippet() available', false); }

  // Regression searches (versioned; corpus-specific).
  if (REGEN) {
    const reg = JSON.parse(readFileSync(REG_PATH, 'utf8'));
    const fresh = {};
    for (const q of Object.keys(reg.search_expectations)) fresh[q] = ftsCount(ddb, q);
    reg.search_expectations = fresh; reg.generated = new Date().toISOString().slice(0, 10);
    writeFileSync(REG_PATH, JSON.stringify(reg, null, 2) + '\n');
    console.log('\n  --regen-expectations: rewrote ' + REG_PATH + ' from this database. Review and commit deliberately.');
  } else {
    const reg = JSON.parse(readFileSync(REG_PATH, 'utf8'));
    console.log(`\nRegression searches (expectations ${reg.corpus_version}):`);
    for (const [q, exp] of Object.entries(reg.search_expectations)) {
      let n; try { n = ftsCount(ddb, q); } catch (e) { n = 'ERR'; }
      check(`  ${JSON.stringify(q)} = ${exp}`, n === exp, `got ${n}`);
    }
  }
  ddb.close();

  const derivedSha = sha256File(derived);
  console.log('\n  derived SHA-256 : ' + derivedSha + '  (rollback-mode deployment copy)');

  if (fail) { rmSync(tmp, { recursive: true, force: true }); die(`verification failed at "${fail}" — no encrypted asset produced.`); }

  // 2. Passphrase.
  const pass = await promptPassphrase();
  const words = pass.trim().split(/\s+/).filter(Boolean).length;
  if (words < 6 && !ALLOW_WEAK) { rmSync(tmp, { recursive: true, force: true }); die('passphrase has fewer than 6 words. Use a randomly generated 6+ word Diceware passphrase (or --allow-weak for testing).'); }

  // 3. gzip → PBKDF2 → AES-256-GCM.
  const plain = gzipSync(readFileSync(derived));
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const baseKey = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));

  const iterBytes = new Uint8Array(4); new DataView(iterBytes.buffer).setUint32(0, PBKDF2_ITER, true);
  const header = new Uint8Array([...MAGIC, 1 /*version*/, 1 /*kdf=PBKDF2-SHA256*/, 1 /*cipher=AES-256-GCM*/, 1 /*comp=gzip*/, ...iterBytes, ...salt, ...iv]);
  const asset = new Uint8Array(header.length + ct.length); asset.set(header, 0); asset.set(ct, header.length);
  writeFileSync(OUT, asset);

  // 4. Delete derived plaintext.
  rmSync(tmp, { recursive: true, force: true });

  console.log('\nEncrypted asset written:');
  console.log('  ' + OUT + '  (' + asset.length.toLocaleString() + ' bytes)');
  console.log('\nAudit trail (safe to keep in local notes; not shown on the page):');
  console.log('  canonical SHA-256 : ' + canonSha);
  console.log('  derived   SHA-256 : ' + derivedSha);
  console.log('  KDF: PBKDF2-HMAC-SHA-256 x ' + PBKDF2_ITER + '  cipher: AES-256-GCM  compression: gzip');
  console.log('  derived plaintext copy deleted; canonical untouched.');
  console.log('\nCommit the .enc and deploy when ready. The passphrase is not stored anywhere.');
})().catch((e) => die(e.stack || String(e)));
