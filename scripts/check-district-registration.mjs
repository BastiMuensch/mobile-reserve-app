// Start: node scripts/preview-ui-regressions.mjs --district-registration
import assert from 'node:assert/strict';
import { registrationPrivacyNotice } from '../src/lib/registrationPrivacy.ts';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE.');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = 'http://127.0.0.1:3147';
await mkdir('output/district-registration', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'de-DE' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/setup/register-teacher') return route.fulfill({ json: { schools: [{ id: 'fixture-school', name: 'Grundschule Beispiel' }], recipientEmail: 'reserve@example.invalid', privacyNotice: registrationPrivacyNotice('Erfundener Betreibertext für diesen UI-Test.') } });
      return url.origin === base && route.request().method() === 'GET' ? route.continue() : route.abort();
    });
    await page.goto(base);
    for (const view of ['edit', 'add']) {
      if (view === 'add') {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'add', exact: true }).click();
      }
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const school = dialog.locator(view === 'edit' ? '#edit-stammschule' : '#stammschule');
      assert.match(await school.innerText(), /Grundschule Bayreuth-Herzoghöhe/);
      await school.click();
      const popup = page.locator('[data-slot="select-content"]');
      await popup.waitFor();
      const box = await popup.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `Menu must fit ${width}px viewport`);
      assert.ok(box.height <= 321, 'Long list must have bounded height');
      assert.ok(await popup.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'School names must wrap without horizontal clipping');
      assert.ok(await popup.evaluate(el => el.scrollHeight > el.clientHeight), 'Long list scrolls');
      const longOption = page.getByRole('option', { name: 'Alexander-von-Humboldt Grundschule Goldkronach', exact: true });
      await longOption.scrollIntoViewIfNeeded();
      await page.screenshot({ animations: 'disabled', path: path.resolve(`output/district-registration/${view}-${width}.png`) });
      await longOption.click();
      assert.match(await school.innerText(), /Alexander-von-Humboldt Grundschule Goldkronach/);
      assert.doesNotMatch(await school.innerText(), /7693d52e/);
      await school.focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Form must fit dialog');
      await dialog.getByLabel('Schulamtsbezirk', { exact: true }).fill('BTL');
    }
    await page.keyboard.press('Escape');
    await page.getByLabel('Nach Schulamtsbezirk filtern').selectOption('district:BT');
    assert.equal(await page.getByTestId('filtered-count').innerText(), '10');
    await page.getByLabel('Nach Schulamtsbezirk filtern').selectOption('UNASSIGNED');
    assert.equal(await page.getByTestId('filtered-count').innerText(), '10');
    await page.getByRole('button', { name: 'registration', exact: true }).click();
    const notice = page.getByRole('dialog', { name: 'Hinweis zur Datenspeicherung' });
    await notice.waitFor();
    assert.match(await notice.innerText(), /Art und Zweck der Datenspeicherung/);
    await notice.getByRole('button', { name: 'Schließen', exact: true }).first().click();
    assert.equal(await page.getByRole('button', { name: 'Hier registrieren', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Datenschutzhinweis öffnen' }).click();
    await notice.getByRole('button', { name: 'Gelesen und zur Kenntnis genommen' }).click();
    assert.equal(await page.getByRole('button', { name: 'Hier registrieren', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: 'Datenschutzhinweis öffnen' }).click();
    await notice.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ animations: 'disabled', path: path.resolve(`output/district-registration/privacy-${width}.png`) });
    assert.deepEqual(errors, []);
    console.log(`School selection, district filter and privacy acknowledgement: ${width}px passed`);
    await page.close();
  }
} finally { await browser.close(); }
