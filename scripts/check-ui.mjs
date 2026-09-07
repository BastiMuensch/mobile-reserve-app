// Browser smoke checks against the synthetic fixture server only.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright index.mjs.');
const { chromium } = await import(pathToFileURL(modulePath).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3101';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'UI tests require a loopback origin');
const output = path.resolve('output/ui-audit');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1536, height: 1040 }, colorScheme: 'light', locale: 'de-DE' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));


async function login(email) {
  await page.goto(base);
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill('Ui-Test-Reserve-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
}
async function screenshot(name) {
  await page.getByText(/^Karte wird geladen\s*(?:…|\.\.\.)$/).waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  if (await page.locator('.leaflet-tile').count()) {
    await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile')].every(image => image.complete && image.naturalWidth > 0), null, { timeout: 15000 }).catch(() => {});
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow`);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
  if (name === 'schulamt-desktop') {
    await page.screenshot({ path: path.join(output, 'schulamt-vorschau.png'), fullPage: false, animations: 'disabled' });
  }
}
try {
  await login('schulamt@ui-test.local');
  await page.getByRole('heading', { name: 'Heute im Überblick' }).waitFor();
  await page.getByRole('button', { name: /^Bedarf Grundschule am Park/ }).first().waitFor();
  await page.locator('.leaflet-container').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile')].some(image => image.complete && image.naturalWidth > 0), null, { timeout: 15000 }).catch(() => console.warn('Background map tiles not loaded; markers remain testable.'));
  await screenshot('schulamt-desktop');

  // Future requests start collapsed, but search and direct links reveal them.
  const laterGroup = page.locator('details').filter({ has: page.getByRole('heading', { name: /^Später/ }) });
  if (await laterGroup.count()) {
    assert.equal(await laterGroup.getAttribute('open'), null);
    const laterSummary = laterGroup.locator('summary');
    await laterSummary.focus();
    await page.keyboard.press('Enter');
    assert.notEqual(await laterGroup.getAttribute('open'), null);
    await page.keyboard.press('Enter');
    assert.equal(await laterGroup.getAttribute('open'), null);
    const search = page.getByRole('textbox', { name: 'Bedarfe nach Schule oder Grund durchsuchen' });
    await search.fill('Grundschule');
    assert.notEqual(await laterGroup.getAttribute('open'), null, 'Search reveals future matches');
    await search.fill('');
    assert.equal(await laterGroup.getAttribute('open'), null);

    const requests = await page.evaluate(async () => {
      const response = await fetch('/api/requests');
      if (!response.ok) throw new Error(`Unable to load fixture demands: ${response.status}`);
      return response.json();
    });
    const future = requests.find(request => ['PENDING', 'PARTIALLY_FILLED'].includes(request.status) && new Date(request.date) > new Date(Date.now() + 7 * 86400000));
    if (future) {
      await page.goto(`${base}/schulamt?matchRequestId=${encodeURIComponent(future.id)}`);
      await page.getByText(`Passende Reserven für ${future.school.name}`, { exact: true }).waitFor();
      assert.notEqual(await laterGroup.getAttribute('open'), null, 'Direct link reveals selected future demand');
      assert.ok(await laterGroup.locator('[role="button"][aria-expanded="true"]').isVisible());
      await page.goto(`${base}/schulamt`);
      await page.getByRole('button', { name: /^Bedarf Grundschule am Park/ }).first().waitFor();
    }
  }

  // Optional profile outages must not hide operational school/year data.
  await page.route('**/api/schulamt/profile?**', route => route.fulfill({ status: 503, json: { error: 'UI test outage' } }));
  await page.getByRole('button', { name: 'Daten aktualisieren', exact: true }).click();
  await page.getByText('Die Schulamts-Einstellungen konnten nicht aktualisiert werden.', { exact: false }).waitFor();
  assert.ok(await page.getByRole('button', { name: /^Bedarf Grundschule am Park/ }).first().isVisible());
  await page.unroute('**/api/schulamt/profile?**');

  const selectedYear = await page.getByLabel('Schuljahr', { exact: true }).inputValue();
  await page.getByLabel('Schuljahr', { exact: true }).selectOption({ index: 0 });
  await page.getByText('Keine ausstehenden Anfragen gefunden.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Bedarf Grundschule am Park/ }).first().count(), 0);
  await page.reload();
  await page.getByText('Keine ausstehenden Anfragen gefunden.', { exact: true }).waitFor();
  assert.notEqual(await page.getByLabel('Schuljahr', { exact: true }).inputValue(), selectedYear, 'School year survives reload');
  await page.getByLabel('Schuljahr', { exact: true }).selectOption(selectedYear);
  await page.getByRole('button', { name: /^Bedarf Grundschule am Park/ }).first().waitFor();

  // A failed new-year fetch must never publish data from the preceding year.
  await page.route('**/api/teachers?**', route => route.fulfill({ status: 503, json: { error: 'Core data outage' } }));
  await page.getByLabel('Schuljahr', { exact: true }).selectOption({ index: 0 });
  await page.getByText('Für dieses Schuljahr sind noch keine verlässlichen Daten geladen.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Bedarf Grundschule am Park/ }).first().count(), 0);
  await page.unroute('**/api/teachers?**');
  await page.getByLabel('Schuljahr', { exact: true }).selectOption(selectedYear);
  await page.getByRole('button', { name: /^Bedarf Grundschule am Park/ }).first().waitFor();

  await page.getByRole('button', { name: /^Bedarf Grundschule am Park/ }).first().click();
  await page.getByText('Passende Reserven für Grundschule am Park', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Zuweisen', exact: true }).first().waitFor();
  await screenshot('schulamt-matching');
  await page.getByRole('button', { name: 'Karte vergrößern', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');

  for (const [route, name] of [['reserven', 'Mobile Reserven'], ['schulen', 'Schulen'], ['idealbesetzung', 'Idealbesetzung'], ['statistiken', 'Statistiken'], ['dokumentation', 'Dokumentation'], ['einstellungen', 'Einstellungen']]) {
    await page.goto(`${base}/schulamt/${route}`);
    await page.getByRole('heading', { level: 1, name, exact: true }).waitFor();
    await page.getByText('Daten für das ausgewählte Schuljahr werden geladen …', { exact: true }).waitFor({ state: 'hidden' });
    await screenshot(`schulamt-${route}`);
  }
  await page.goto(`${base}/schulamt`);
  await page.getByRole('button', { name: /^Bedarf Grundschule am Park/ }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('schulamt-mobile');
  await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  await page.locator('#mobile-authority-nav').getByRole('link', { name: /Mobile Reserven/ }).click();
  await page.getByRole('heading', { level: 1, name: 'Mobile Reserven', exact: true }).waitFor();
  await screenshot('reserven-mobile');
  await page.setViewportSize({ width: 320, height: 740 });
  await screenshot('reserven-small-mobile');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abmelden', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Mobile Reserven', exact: true }).count(), 0);
  await login('reserve1@ui-test.local');
  await page.getByText('Grundschule am Park', { exact: false }).first().waitFor();
  await screenshot('lehrkraft-mobile');
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
  await login('schule1@ui-test.local');
  await page.getByRole('link', { name: /Schulprofil/ }).waitFor();
  await screenshot('schule-mobile');
  assert.deepEqual(pageErrors, [], 'Browser runtime errors');
  console.log('UI smoke checks passed. Screenshots:', output);
} finally { await browser.close(); }
