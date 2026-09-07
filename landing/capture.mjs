/** Real UI screenshots; only the explicitly selected synthetic local fixture.
 * APP_URL=http://127.0.0.1:3118 SCREENSHOT_FIXTURE=ui-test-20260907 npm run screenshots
 * No seeds, profile edits, assignment approvals or message delivery.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const APP = process.env.APP_URL;
assert.ok(APP && ['localhost', '127.0.0.1'].includes(new URL(APP).hostname), 'Select a local APP_URL.');
assert.equal(process.env.SCREENSHOT_FIXTURE, 'ui-test-20260907', 'Explicit synthetic fixture confirmation required.');
const OUT = new URL('./img/', import.meta.url).pathname;
const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
const errors = [];
let currentPage;

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}${name}.png`, type: 'png', animations: 'disabled',
    style: 'nextjs-portal { visibility: hidden !important; }' });
  console.log(`Captured ${name}.png`);
}

async function session(email, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, locale: 'de-DE', colorScheme: 'light', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  currentPage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (!['GET', 'HEAD'].includes(request.method()) && !['/api/auth/login', '/api/batch-assign/preview'].includes(pathname)) return route.abort();
    return route.continue();
  });
  await page.goto(APP);
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill('Ui-Test-Reserve-2026!');
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/login'));
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  assert.equal((await responsePromise).status(), 200, 'Synthetic login must succeed.');
  await page.getByRole('button', { name: 'Abmelden', exact: true }).first().waitFor();
  return { page, context };
}

try {
  const authority = await session('schulamt@ui-test.local');
  await authority.page.goto(`${APP}/schulamt`);
  await authority.page.getByText('Heute im Überblick', { exact: true }).waitFor();
  await authority.page.waitForTimeout(1200);
  await capture(authority.page, 'schulamt-aktuell');
  await authority.page.goto(`${APP}/schulamt/idealbesetzung`);
  const until = new Date(); until.setDate(until.getDate() + 3);
  await authority.page.locator('#idealbesetzung-until').fill(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(until));
  await authority.page.getByRole('button', { name: 'Vorschlag berechnen', exact: true }).click();
  await authority.page.getByText('Momentaufnahme:', { exact: false }).waitFor();
  await capture(authority.page, 'idealbesetzung');
  await authority.context.close();

  const school = await session('schule1@ui-test.local');
  await school.page.waitForTimeout(1000);
  await capture(school.page, 'schule-aktuell');
  await school.page.goto(`${APP}/schule/profil`);
  await school.page.locator('.leaflet-container').first().waitFor();
  await school.page.waitForTimeout(1000);
  // Capture the entire arrival-point card, including BOTH pins and map credits.
  const arrivalCard = school.page.locator('[data-slot="card"]').filter({ hasText: 'Ankunftspunkte' });
  await arrivalCard.screenshot({ path: `${OUT}schulprofil-pins.png`, animations: 'disabled', style: 'nextjs-portal { visibility: hidden !important; }' });
  console.log('Captured schulprofil-pins.png');
  await school.context.close();

  const teacher = await session('reserve1@ui-test.local');
  await teacher.page.getByRole('button', { name: 'Einsätze aktualisieren' }).waitFor();
  await teacher.page.waitForTimeout(1000);
  await capture(teacher.page, 'lehrkraft-aktuell');
  await teacher.page.setViewportSize({ width: 390, height: 844 });
  await capture(teacher.page, 'lehrkraft-mobil-aktuell');
  await teacher.context.close();
  assert.deepEqual(errors, [], 'UI runtime errors');
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    console.error({ url: currentPage.url(), errors, visibleText: (await currentPage.locator('body').innerText()).slice(0, 5000) });
  }
  throw error;
} finally {
  await browser.close();
}
