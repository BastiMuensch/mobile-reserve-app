// Synthetic local accounts only. No assignment, email or profile is changed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3118';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = path.resolve('output/document-downloads');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [];
async function login(role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(`${role}@ui-test.local`);
  await page.getByLabel('Passwort', { exact: true }).fill('Ui-Test-Reserve-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).filter({ visible: true }).waitFor();
  return { context, page };
}
async function pdf(context, url) {
  const response = await context.request.get(`${base}${url}`);
  assert.equal(response.status(), 200, url);
  assert.match(response.headers()['content-type'], /application\/pdf/);
  assert.equal((await response.body()).subarray(0, 5).toString(), '%PDF-');
}
async function screenshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no horizontal overflow`);
  // Tab decorations intentionally extend beyond their box; check text geometry,
  // not scrollHeight (which includes the decorative pseudo-element).
  const clipped = await page.locator('[data-slot="button"]:visible, [role="tab"]:visible').evaluateAll(elements => elements.filter(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const content = range.getBoundingClientRect(), box = el.getBoundingClientRect();
    return content.left < box.left - 1 || content.right > box.right + 1 || content.top < box.top - 1 || content.bottom > box.bottom + 1;
  }).map(el => el.textContent));
  assert.deepEqual(clipped, [], `${name}: no clipped controls`);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}
try {
  const teacher = await login('reserve1');
  const { page, context } = teacher;
  const me = await (await context.request.get(`${base}/api/auth/me`)).json();
  const profile = me.user.teachers.find(row => row.schoolYear === '2026/2027');
  assert.ok(profile, 'Synthetic current-year profile exists');
  const api = `/api/teachers/${profile.id}/assignments`;
  const rows = await (await context.request.get(`${base}${api}`)).json();
  assert.ok(rows.length > 0, 'Synthetic fixture has an assignment');
  const proofUrl = `/api/assignments/${rows[0].id}/pdf`;
  await page.getByRole('tab', { name: 'Pro Einsatz', exact: true }).waitFor();
  await page.getByRole('list', { name: 'Einsatznachweise' }).waitFor();
  await pdf(context, proofUrl);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('list', { name: 'Einsatznachweise' }).getByRole('link').first().click();
  assert.equal(await (await downloadEvent).failure(), null);
  await page.getByRole('tab', { name: 'Pro Einsatz', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.getByLabel('Monat für die Abrechnung').waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Pro Monat', exact: true }).getAttribute('aria-selected'), 'true');
  const month = rows[0].date.slice(0, 7);
  await page.getByLabel('Monat für die Abrechnung').fill(month);
  await pdf(context, `/api/teachers/${profile.id}/export-monthly?month=${month}`);
  const monthlyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Monatsübersicht herunterladen' }).click();
  assert.equal(await (await monthlyDownload).failure(), null);
  await screenshot(page, 'teacher-month-desktop');
  await page.getByLabel('Monat für die Abrechnung').fill('');
  assert.equal(await page.getByRole('button', { name: 'Monatsübersicht herunterladen' }).isDisabled(), true);
  await page.getByLabel('Monat für die Abrechnung').fill(month);
  await page.getByRole('tab', { name: 'Pro Einsatz', exact: true }).click();
  await page.getByRole('tab', { name: 'Pro Monat', exact: true }).click();
  assert.equal(await page.getByLabel('Monat für die Abrechnung').inputValue(), month);
  let mocked = [
    { ...rows[0], id: 'mock-a', date: '2026-09-07T00:00:00.000Z', status: 'ACCEPTED', hours: 3 },
    { ...rows[0], id: 'mock-b', date: '2026-09-08T00:00:00.000Z', status: 'ACCEPTED', hours: 3 },
    { ...rows[0], id: 'mock-c', date: '2026-09-09T00:00:00.000Z', status: 'REJECTED', hours: 3 },
    { ...rows[0], id: 'mock-d', date: '2026-09-10T00:00:00.000Z', status: 'PENDING', hours: 3 },
  ];
  await page.route(`${base}${api}`, route => route.fulfill({ json: mocked }));
  await page.reload();
  const list = page.getByRole('list', { name: 'Einsatznachweise' });
  await list.waitFor();
  assert.equal(await list.locator(':scope > li').count(), 3);
  await list.getByText('2 Einsatztage · 6 Unterrichtsstunden', { exact: true }).waitFor();
  assert.equal(await list.getByRole('link', { name: /Stornierten Nachweis/ }).count(), 1);
  assert.equal(await list.locator('a[href="/api/assignments/mock-a/pdf"]').count(), 1);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await screenshot(page, `teacher-assignment-${width}`);
    await page.getByRole('tab', { name: 'Pro Monat', exact: true }).click();
    await screenshot(page, `teacher-month-${width}`);
    await page.getByRole('tab', { name: 'Pro Einsatz', exact: true }).click();
  }
  await page.evaluate(() => { localStorage.theme = 'dark'; });
  await page.reload();
  await list.waitFor();
  await screenshot(page, 'teacher-assignment-dark');
  mocked = [];
  await page.reload();
  await page.getByText('Noch keine Einsatznachweise vorhanden.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('list', { name: 'Einsatznachweise' }).count(), 0);

  const office = await login('schulamt');
  await office.page.goto(`${base}/schulamt/reserven`);
  async function openArchive(name) {
    await office.page.getByRole('button', { name: `Aktionen für ${name}`, exact: true }).click();
    await office.page.getByRole('menuitem', { name: 'Archiv', exact: true }).click();
    await office.page.getByRole('dialog').waitFor();
  }
  await openArchive(profile.name);
  const dialog = office.page.getByRole('dialog');
  await dialog.getByRole('list', { name: 'Einsatznachweise' }).waitFor();
  assert.equal(await dialog.locator(`a[href="${proofUrl}"]`).count(), 1);
  await pdf(office.context, proofUrl);
  for (const width of [1440, 320]) {
    await office.page.setViewportSize({ width, height: 1000 });
    await screenshot(office.page, `office-archive-${width}`);
  }
  await office.page.keyboard.press('Escape');
  await office.page.route(`${base}${api}`, route => route.fulfill({ status: 503, json: { error: 'Synthetic failure' } }));
  await openArchive(profile.name);
  await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByRole('link').count(), 0, 'No stale links after fetch failure');
  await office.page.unroute(`${base}${api}`);
  await dialog.getByRole('button', { name: 'Erneut laden' }).click();
  await dialog.getByRole('list', { name: 'Einsatznachweise' }).waitFor();
  await office.page.keyboard.press('Escape');
  await office.page.route('**/api/teachers/*/assignments', route => route.fulfill({ json: [] }));
  await openArchive('Lukas Muster');
  await dialog.getByText('Noch keine Einsatznachweise vorhanden.', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('link').count(), 0, 'No links from previous teacher');
  for (const role of ['reserve2', 'schule1']) {
    const other = await login(role);
    const response = await other.context.request.get(`${base}${proofUrl}`);
    assert.equal(response.status(), 403, `${role} cannot download this teacher's PDF`);
    await other.context.close();
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(`PDF access, actual downloads, tabs/keyboard, month validation, grouping, cancellations, empty/error/retry and responsive layout passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
