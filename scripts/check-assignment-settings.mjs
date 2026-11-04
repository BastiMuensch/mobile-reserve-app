// Start: node scripts/preview-ui-regressions.mjs --assignment-settings
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE.');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = 'http://127.0.0.1:3148';
await mkdir('output/assignment-settings', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'de-DE' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/schulamt/districts' && route.request().method() === 'GET') return route.fulfill({ json: { usage: [{ value: 'BAYREUTHLAND'.repeat(4), schools: 2, teachers: 3 }] } });
      return url.origin === base && route.request().method() === 'GET' ? route.continue() : route.abort();
    });
    await page.goto(base);
    await page.getByText('Abweichende Angaben (1)').waitFor();
    const request = page.getByRole('region', { name: 'Bedarfsmeldung' });
    await request.getByRole('radio', { name: 'Fachlehrkraft', exact: true }).check();
    await request.getByLabel('Fachrichtung', { exact: true }).selectOption('M/T');
    const profile = page.getByRole('region', { name: 'Reserveprofil' });
    assert.equal(await profile.locator('form').evaluate(el => el.checkValidity()), false);
    await profile.getByRole('checkbox', { name: 'Fachlehrkraft M/T', exact: true }).check();
    assert.equal(await profile.locator('form').evaluate(el => el.checkValidity()), true);
    assert.equal(await profile.getByRole('checkbox', { name: 'Fachlehrkraft E/G', exact: true }).isChecked(), false);
    await page.getByLabel('Bezirke Ihres Schulamts', { exact: true }).fill('Neu');
    await page.getByLabel('Bezirke Ihres Schulamts', { exact: true }).press('Enter');
    await page.getByRole('button', { name: 'NEU entfernen', exact: true }).waitFor();
    assert.equal(await page.getByLabel(/^Zielbezirk/).isDisabled(), true, 'save edited list before merging');
    for (const section of [page.getByRole('region', { name: 'Einstellungen' }), profile, request]) {
      assert.ok(await section.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Section must fit at ${width}px: ${await section.getAttribute('aria-label')}`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px page must not overflow`);
    await page.screenshot({ fullPage: true, animations: 'disabled', path: `output/assignment-settings/${width}.png` });
    await page.getByRole('switch', { name: 'Fachlehrkräfte gesondert abfragen', exact: true }).uncheck();
    assert.equal(await profile.getByRole('checkbox').count(), 0);
    assert.equal(await request.getByRole('radio', { name: 'Fachlehrkraft', exact: true }).count(), 0);
    assert.equal(await request.getByLabel('Fachrichtung', { exact: true }).count(), 0);
    await page.getByRole('switch', { name: 'Fachlehrkräfte gesondert abfragen', exact: true }).check();
    assert.equal(await request.getByLabel('Fachrichtung', { exact: true }).inputValue(), 'M/T', 'draft survives temporarily disabled module');
    assert.equal(await profile.getByRole('checkbox', { name: 'Fachlehrkraft M/T', exact: true }).isChecked(), true);
    assert.deepEqual(errors, []);
    console.log(`Assignment settings, specialist profile and requests: ${width}px passed`);
    await page.close();
  }
} finally { await browser.close(); }
