// Shared guard: the v2 schema is frozen. Any script that creates a database
// from gygax-v2-schema.sql must call assertSchemaFrozen() first, so the schema
// cannot drift silently underneath an ingestion.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export function assertSchemaFrozen() {
  const schemaPath = join(HERE, 'gygax-v2-schema.sql');
  const lockPath = join(HERE, 'gygax-v2-schema.lock');
  const actual = createHash('sha256').update(readFileSync(schemaPath)).digest('hex');
  const lock = readFileSync(lockPath, 'utf8');
  const expected = (lock.match(/^sha256\s*=\s*([0-9a-f]{64})/m) || [])[1];
  const version = (lock.match(/^schema_version\s*=\s*(\S+)/m) || [])[1] || 'unknown';
  if (!expected) throw new Error('gygax-v2-schema.lock has no sha256 value.');
  if (actual !== expected) {
    console.error(`\nSCHEMA FROZEN — refusing to proceed.
  expected ${expected}
  actual   ${actual}
The v2 schema (${version}) has changed since it was frozen. If the change is
deliberate: re-run scripts/gygax-v2-schema-tests.mjs, then update the sha256 in
gygax-v2-schema.lock in the same commit. Never update it to silence this.`);
    process.exit(1);
  }
  return { version, sha256: actual, schemaPath };
}
