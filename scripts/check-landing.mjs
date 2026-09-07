// Local visual regression checks for the standalone landing page.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = process.env.LANDING_URL || 'http://127.0.0.1:3119';
const baseUrl = new URL(base);
assert.ok(['localhost', '127.0.0.1'].includes(baseUrl.hostname), 'LANDING_URL must be a local URL');
assert.ok(process.env.PLAYWRIGHT_MODULE, 'Set PLAYWRIGHT_MODULE to the Playwright package entry point.');

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const output = path.resolve(process.env.LANDING_AUDIT_DIR || 'output/landing-audit');
await mkdir(output, { recursive: true });

const expectedAssets = new Set([
  '/img/schulamt-aktuell.png',
  '/img/schule-aktuell.png',
  '/img/lehrkraft-aktuell.png',
  '/img/lehrkraft-mobil-aktuell.png',
  '/img/idealbesetzung.png',
  '/img/schulprofil-pins.png',
]);

const browser = await chromium.launch();
const errors = [];

async function checkViewport(name, viewport, { mobile = false, colorScheme = 'light' } = {}) {
  const context = await browser.newContext({ viewport, colorScheme, locale: 'de-DE', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
  await page.goto(baseUrl.href, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('h1').count(), 1, `${name}: one primary heading`);
  assert.equal(await page.locator('main').count(), 1, `${name}: main landmark`);
  const badAnchors = await page.locator('a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute('href')).filter(href => !document.getElementById(href.slice(1))));
  assert.deepEqual(badAnchors, [], `${name}: broken section links`);

  const screenshots = page.locator('img.shotimg');
  const foundAssets = await screenshots.evaluateAll(images => images.map(image => new URL(image.src).pathname));
  for (const asset of expectedAssets) assert.ok(foundAssets.includes(asset), `${name}: missing landing screenshot ${asset}`);
  for (let index = 0; index < await screenshots.count(); index += 1) {
    const image = screenshots.nth(index);
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(element => new Promise((resolve, reject) => {
      if (element.complete && element.naturalWidth > 0) return resolve();
      element.addEventListener('load', resolve, { once: true });
      element.addEventListener('error', () => reject(new Error(`could not load ${element.currentSrc}`)), { once: true });
    }));
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow`);
  await page.locator('.faq summary').first().click();
  assert.ok(await page.locator('.faq').first().evaluate(element => element.open), `${name}: FAQ opens`);
  await page.locator('.faq summary').first().click();

  if (mobile) {
    const menu = page.locator('details.mobile-nav nav[aria-label="Seitennavigation"]');
    const summary = page.getByLabel('Seitennavigation öffnen');
    await summary.focus();
    await page.keyboard.press('Space');
    await assert.doesNotReject(menu.locator('a').first().waitFor({ state: 'visible' }));
    assert.ok(await page.locator('details.mobile-nav').evaluate(element => element.open), `${name}: keyboard did not open menu`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: overflow after menu opened`);
  }

  if (mobile) await page.locator('details.mobile-nav summary').click();
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
  if (name === 'landing-desktop') {
    await page.screenshot({ path: path.join(output, 'landing-hero.png'), animations: 'disabled' });
    await page.locator('#idealbesetzung').screenshot({ path: path.join(output, 'landing-idealbesetzung.png'), animations: 'disabled', style: 'header,.skip-link{visibility:hidden!important}' });
  }
  if (name === 'landing-mobile-390') await page.locator('.hero').screenshot({ path: path.join(output, 'landing-hero-mobile.png'), animations: 'disabled', style: 'header,.skip-link{visibility:hidden!important}' });
  for (const legalPage of ['impressum.html', 'datenschutz.html']) {
    const response = await page.goto(new URL(legalPage, baseUrl).href);
    assert.equal(response.status(), 200, `${legalPage} reachable`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: ${legalPage} overflow`);
  }
  await context.close();
}

try {
  await checkViewport('landing-desktop', { width: 1440, height: 1000 });
  await checkViewport('landing-mobile-390', { width: 390, height: 844 }, { mobile: true });
  await checkViewport('landing-mobile-320', { width: 320, height: 800 }, { mobile: true });
  await checkViewport('landing-tablet-820', { width: 820, height: 1100 }, { mobile: true });
  await checkViewport('landing-desktop-dark', { width: 1440, height: 1000 }, { colorScheme: 'dark' });
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(`Landing checks passed; screenshots written to ${output}.`);
} finally {
  await browser.close();
}
