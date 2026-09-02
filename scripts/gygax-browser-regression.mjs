#!/usr/bin/env node
/*
 * gygax-browser-regression.mjs — end-to-end regression test for the private
 * Gygax research page, driving the real interface (decrypt → sqlite-wasm → FTS5).
 *
 * Preconditions:
 *   - A built site is being served, with a test-encrypted corpus present at
 *     <served>/research/gygax/gygax_enworld.enc (produced by build-gygax-corpus.mjs
 *     with a KNOWN test passphrase — never the production passphrase/asset).
 *   - Playwright is available: npm i -D playwright-core (and a Chromium).
 *
 * Env:
 *   BASE_URL               default http://127.0.0.1:8200
 *   GYGAX_TEST_PASSPHRASE  the test passphrase used to encrypt the test asset
 *   CHROMIUM_PATH          optional explicit Chromium executable
 *   REG_FILE               default ./gygax-regression.v1.json (versioned expectations)
 *
 * Exit code 0 = all pass, 1 = failure. Expected counts come from the versioned
 * regression file, so they are corpus-version-specific by construction.
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8200';
const PASS = process.env.GYGAX_TEST_PASSPHRASE;
const REG = JSON.parse(readFileSync(process.env.REG_FILE || join(HERE, 'gygax-regression.v1.json'), 'utf8'));
if (!PASS) { console.error('Set GYGAX_TEST_PASSPHRASE (the test asset passphrase).'); process.exit(2); }

let failures = 0;
const ok = (name, cond, extra = '') => { console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`); if (!cond) failures++; };

async function totalFor(page, query, { part = '', auth = '1' } = {}) {
  await page.selectOption('#part', part);
  await page.selectOption('#auth', auth);
  await page.fill('#q', '');
  await page.fill('#q', query);
  await page.waitForFunction(() => document.getElementById('rescount').dataset.total !== undefined, null, { timeout: 8000 })
    .catch(() => {});
  // settle debounce then read the deterministic true-count hook
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const t = document.getElementById('rescount').dataset.total;
    return t === undefined ? null : parseInt(t, 10);
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 834, height: 1112 } }); // iPad-ish
  page.on('pageerror', (e) => { console.log('  PAGEERROR', e.message); failures++; });
  await page.goto(BASE + '/research/gygax/', { waitUntil: 'load' });

  console.log('Gate:');
  await page.fill('#pw', 'wrong words that will not decrypt anything');
  await page.click('#unlock');
  await page.waitForTimeout(600);
  ok('wrong passphrase rejected, gate stays', await page.isVisible('#gate') && await page.isHidden('#app'),
     await page.textContent('#gate-msg'));

  await page.fill('#pw', PASS);
  await page.click('#unlock');
  await page.waitForSelector('#app:not(.hidden)', { timeout: 20000 });
  ok('correct passphrase unlocks', await page.isVisible('#app'));

  console.log(`\nRegression searches (expectations ${REG.corpus_version}):`);
  for (const [q, exp] of Object.entries(REG.search_expectations)) {
    const got = await totalFor(page, q);
    ok(`${JSON.stringify(q)} = ${exp}`, got === exp, `got ${got}`);
  }

  console.log('\nUI behaviours:');
  // no-match message wording
  await totalFor(page, 'Tamoachan');
  const nomatch = (await page.textContent('#results')) || '';
  ok('no-match shows exact wording', nomatch.includes('No matches in the recovered corpus'));
  ok('no-match does not imply Gygax never said it', nomatch.toLowerCase().includes('not') && nomatch.toLowerCase().includes('evidence'));

  // highlight (snippet) renders
  await totalFor(page, 'Greyhawk');
  ok('snippet highlight renders (<mark>)', (await page.locator('#results mark').count()) > 0);

  // authority-1 OCR warning within Part 3
  await totalFor(page, 'Gygax', { part: '3', auth: '1' });
  ok('authority-1 badge shown', (await page.locator('#results .badge.a1').count()) > 0);
  ok('authority-1 OCR warning shown', (await page.locator('#results .ocrwarn').count()) > 0);

  // coverage panel populated from the coverage table
  await page.click('#coverage-panel > summary');
  const covRows = await page.locator('#coverage-table tbody tr').count();
  ok('coverage panel has all parts', covRows === 13, `${covRows} rows`);

  await browser.close();
  console.log(`\n${failures ? failures + ' FAILURE(S)' : 'ALL PASS'}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
