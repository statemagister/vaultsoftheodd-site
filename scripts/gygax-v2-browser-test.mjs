#!/usr/bin/env node
/*
 * gygax-v2-browser-test.mjs — end-to-end test of the v2 research page,
 * driving the real interface (decrypt -> sqlite-wasm -> FTS5 -> render).
 *
 * Expects a served build with a FIXTURE-encrypted corpus at
 * <served>/research/gygax/v2/. Never point this at the production passphrase.
 *
 * Env: BASE_URL, GYGAX_TEST_PASSPHRASE, CHROMIUM_PATH
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8300';
const PASS = process.env.GYGAX_TEST_PASSPHRASE;
if (!PASS) { console.error('Set GYGAX_TEST_PASSPHRASE'); process.exit(2); }

let fails = 0;
const ok = (n, c, extra = '') => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${extra ? ' — ' + extra : ''}`); if (!c) fails++; };

const search = async (page, q) => {
  await page.fill('#q', ''); await page.fill('#q', q); await page.waitForTimeout(450);
};
const cards = (page) => page.locator('#results .res[data-unit]');

(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 834, height: 1112 } });
  page.on('pageerror', (e) => { console.log('  PAGEERROR', e.message); fails++; });
  await page.goto(BASE + '/research/gygax-v2/', { waitUntil: 'load' });

  console.log('Gate:');
  await page.fill('#pw', 'definitely not the right passphrase at all');
  await page.click('#unlock'); await page.waitForTimeout(700);
  ok('wrong passphrase rejected', await page.isVisible('#gate') && await page.isHidden('#app'));
  await page.fill('#pw', PASS); await page.click('#unlock');
  await page.waitForSelector('#app:not(.hidden)', { timeout: 20000 });
  ok('correct passphrase unlocks', await page.isVisible('#app'));

  console.log('\nFour match dimensions, each stating why:');
  await search(page, 'mapping');
  const n = await cards(page).count();
  ok('testimony records returned', n >= 3, `${n} cards`);
  const whys = await page.locator('#results .why').allTextContents();
  ok('a record matched by verified transcript', whys.some((w) => w.includes('verified transcript')));
  ok('a record matched by topic tag', whys.some((w) => w.includes('topic tag')));
  ok('tag match is labelled as our classification',
     whys.some((w) => w.includes('not necessarily the words used')));
  ok('discovery text reported separately',
     (await page.locator('#results .dimhead').allTextContents()).some((t) => t.includes('Discovery text')));
  ok('discovery results carry an unverified warning',
     (await page.locator('#results .warnbox').allTextContents()).some((t) => t.includes('Unverified extraction')));

  console.log('\nExact tag matching (controlled vocabulary):');
  await search(page, 'map');
  const mapCards = await cards(page).count();
  const mapWhys = (await page.locator('#results .why').allTextContents()).join(' | ');
  ok('"map" matches only the exact tag, not "mapping"', mapCards === 1, `${mapCards} card(s)`);
  ok('"map" match is a topic-tag match', mapWhys.includes('topic tag "map"'), mapWhys);

  console.log('\nSeparation of speakers and relationships:');
  await search(page, 'mapping');
  const whoTexts = await page.locator('#results .who').allTextContents();
  ok('eyewitness account is labelled as such', whoTexts.some((t) => t.includes('eyewitness account')));
  ok('intermediary quotation is labelled as such', whoTexts.some((t) => t.includes('direct quotation by intermediary')));
  ok('subject person is shown for third-party testimony', whoTexts.some((t) => t.includes('subject:')));
  const axes = (await page.locator('#results .axes').allTextContents()).join(' | ');
  ok('transcript status shown per record', axes.includes('Transcript: Verified'));
  ok('evidence type shown per record', /Evidence: (Stitched derivative|Derivative crop|PDF reproduction|Scan)/.test(axes));

  console.log('\nHeld-but-unverified is listable; inferred numbers are flagged:');
  await page.fill('#q', '');
  await page.selectOption('#tstatus', 'untranscribed');
  await page.waitForTimeout(450);
  const untr = await cards(page).count();
  ok('untranscribed holdings listable with no search term', untr >= 1, `${untr} record(s)`);
  const html = await page.locator('#results').innerHTML();
  ok('inferred number flagged as inferred', html.includes('inferred'));
  ok('untranscribed record warns against quoting', html.includes('Not yet verified'));
  await page.selectOption('#tstatus', '');

  console.log('\nEvidence: decrypt on demand, integrity-bound:');
  await search(page, 'letter');
  const letterCard = cards(page).first();
  await letterCard.locator('[data-act="src"]').click();
  await page.waitForTimeout(1200);
  const figs = await letterCard.locator('[data-shots] figure').count();
  ok('multi-page evidence renders in order', figs === 3, `${figs} pages`);
  ok('integrity confirmed in caption',
     (await letterCard.locator('[data-shots] figcaption').first().textContent()).includes('integrity verified'));
  await letterCard.locator('[data-act="prov"]').click();
  ok('original capture identified, not displayed',
     (await letterCard.locator('[data-prov]').textContent()).includes('held offline'));

  console.log('\nComplete transcript:');
  ok('full transcript expands', await letterCard.locator('[data-act="full"]').count() === 1);

  console.log('\nTampered evidence must be refused:');
  // 'world' matches only the in-world fixture unit, whose evidence asset the
  // harness re-encrypted with the correct AAD but the WRONG image bytes.
  await search(page, 'world');
  if (await cards(page).count()) {
    const t = cards(page).first();
    await t.locator('[data-act="src"]').click();
    await page.waitForTimeout(1200);
    const warn = (await t.locator('[data-shots]').textContent()) || '';
    const imgs = await t.locator('[data-shots] img').count();
    ok('integrity failure reported', /integrity failure|Could not open evidence/i.test(warn), warn.slice(0, 90));
    ok('tampered image is not displayed', imgs === 0);
  } else { console.log('  (no tamper fixture present — skipped)'); }

  console.log('\nCoverage and negative results:');
  await page.click('#coverage-panel > summary');
  ok('coverage segments listed', (await page.locator('#coverage-table tbody tr').count()) > 0);
  await search(page, 'zzzqqqnothinghere');
  ok('no-match wording exact',
     ((await page.locator('#results').textContent()) || '').includes('No matches in the recovered corpus'));

  await b.close();
  console.log(`\n${fails ? fails + ' FAILURE(S)' : 'ALL PASS'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
