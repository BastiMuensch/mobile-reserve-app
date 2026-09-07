// Focused regression checks for the September audit, synthetic local instance only.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3117';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = path.resolve('output/ui-audit');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE', colorScheme: 'light' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function login(email) {
  await page.goto(base);
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill('Ui-Test-Reserve-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
}
async function logout() {
  await page.getByRole('button', { name: 'Abmelden', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
}
async function shot(name) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (overflow) {
    await page.screenshot({ path: path.join(output, `${name}-overflow.png`), fullPage: false });
    const elements = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
      const rect = el.getBoundingClientRect(); return rect.right > innerWidth + 1 && !el.closest('.leaflet-container');
    }).slice(0, 12).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent?.slice(0, 70) })));
    assert.fail(`${name} overflow: ${JSON.stringify(elements)}`);
  }
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false, animations: 'disabled' });
}
try {
  await page.goto(base);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
  await shot('login-desktop');
  await page.setViewportSize({ width: 320, height: 800 });
  await shot('login-small-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login('reserve1@ui-test.local');
  await page.getByRole('button', { name: 'Einsätze aktualisieren' }).waitFor();
  await shot('lehrkraft-desktop');
  await page.goto(`${base}/lehrkraft/profil`);
  await page.getByLabel('Telefon (optional)').waitFor();
  const oldPhone = await page.getByLabel('Telefon (optional)').inputValue();
  await page.getByLabel('Telefon (optional)').fill('01234 998877');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Zum Einsatzplan' }).click();
  assert.equal(new URL(page.url()).pathname, '/lehrkraft/profil');
  await page.getByLabel('Telefon (optional)').fill(oldPhone);
  await shot('lehrkraft-profil');
  await page.route('**/api/teacher/profile', route => route.fulfill({ status: 503, json: { error: 'Profil-Testausfall' } }));
  await page.reload();
  await page.getByRole('button', { name: 'Erneut laden' }).waitFor();
  assert.equal(await page.getByLabel('Telefon (optional)').count(), 0, 'Failed fetch must not expose blank editable form');
  await page.unroute('**/api/teacher/profile');
  await page.getByRole('button', { name: 'Erneut laden' }).click();
  await page.getByLabel('Telefon (optional)').waitFor();
  await page.getByRole('button', { name: 'Zum Einsatzplan' }).click();
  await page.getByRole('button', { name: 'Einsätze aktualisieren' }).waitFor();
  const response = await page.evaluate(async () => {
    const me = await (await fetch('/api/auth/me')).json();
    const row = me.user.teachers.find(item => item.status === 'ACTIVE') || me.user.teachers[0];
    return { teacherId: row.id, assignments: await (await fetch(`/api/teachers/${row.id}/assignments`)).json() };
  });
  const exemplar = response.assignments[0];
  assert.ok(exemplar, 'Fixture teacher needs an assignment');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const later = new Date(); later.setDate(later.getDate() + 2);
  const incoming = [
    { ...exemplar, id: 'ui-cancelled', status: 'REJECTED', date: tomorrow.toISOString(), request: { ...exemplar.request, school: { ...exemplar.request.school, name: 'Stornierter Prüfeinsatz' } } },
    { ...exemplar, id: 'ui-active', status: 'PENDING', date: later.toISOString(), request: { ...exemplar.request, school: { ...exemplar.request.school, name: 'Aktiver Prüfeinsatz' } } },
  ];
  await page.route('**/api/teachers/*/assignments', route => route.fulfill({ json: incoming }));
  // Real AutoRefresh path, no manual reload and no push subscription.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('heading', { name: 'Aktiver Prüfeinsatz', exact: true }).waitFor();
  await page.getByText('Storniert', { exact: true }).waitFor();
  await page.unroute('**/api/teachers/*/assignments');
  await page.route('**/api/auth/me?**', route => route.fulfill({ status: 401, json: { error: 'Session revoked' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
  await page.unroute('**/api/auth/me?**');
  // Clear fixture cookie explicitly after simulated (not actual) server revocation.
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await login('schule1@ui-test.local');
  await page.getByRole('link', { name: /Schulprofil/ }).waitFor();
  await shot('schule-desktop');
  await page.goto(`${base}/schule/profil`);
  await page.getByRole('heading', { name: 'Eingang', exact: true }).waitFor();
  const entrance = page.getByRole('region', { name: 'Eingang', exact: true });
  await entrance.getByLabel('Eingang Breitengrad').fill('');
  await entrance.getByLabel('Eingang Längengrad').fill('');
  await entrance.getByRole('button', { name: 'Koordinaten verwenden' }).click();
  await entrance.getByRole('alert').waitFor();
  await entrance.getByLabel('Eingang Breitengrad').fill('48.');
  assert.equal(await entrance.getByLabel('Eingang Breitengrad').inputValue(), '48.', 'Incomplete decimal stays editable');
  await entrance.getByLabel('Eingang Breitengrad').fill('48,141');
  await entrance.getByLabel('Eingang Längengrad').fill('11,571');
  await entrance.getByRole('button', { name: 'Koordinaten verwenden' }).click();
  const parking = page.getByRole('region', { name: 'Parkplatz (optional)', exact: true });
  await parking.getByLabel('Parkplatz (optional) Breitengrad').fill('48,1414');
  await parking.getByLabel('Parkplatz (optional) Längengrad').fill('11,5715');
  await parking.getByRole('button', { name: 'Koordinaten verwenden' }).click();
  const saveResponse = page.waitForResponse(r => r.url().endsWith('/api/schools') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Profil speichern' }).click();
  const savedPins = await saveResponse;
  assert.equal(savedPins.status(), 200, await savedPins.text());
  await page.getByText('Schulprofil gespeichert.', { exact: true }).waitFor();
  // Directly exercise the real PATCH semantics without changing the visible
  // fixture: a parking-only patch merges with the saved entrance, omitted
  // profile fields survive, and an entrance cannot be removed below parking.
  const pinPatchProbe = await page.evaluate(async () => {
    const schoolsResponse = await fetch('/api/schools');
    const schools = await schoolsResponse.json();
    const school = schools[0];
    const before = { generalInfo: school.generalInfo, imageUrl: school.imageUrl };
    const sameParking = await fetch('/api/schools', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateInfo', schoolId: school.id, parkingLat: school.parkingLat, parkingLng: school.parkingLng }),
    });
    const sameParkingBody = await sameParking.json();
    const invalidEntranceRemoval = await fetch('/api/schools', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateInfo', schoolId: school.id, entranceLat: null, entranceLng: null }),
    });
    return {
      sameParkingStatus: sameParking.status,
      generalInfoPreserved: sameParkingBody.school?.generalInfo === before.generalInfo,
      imageUrlPreserved: sameParkingBody.school?.imageUrl === before.imageUrl,
      invalidEntranceRemovalStatus: invalidEntranceRemoval.status,
    };
  });
  assert.equal(pinPatchProbe.sameParkingStatus, 200, 'Parking-only PATCH merges with the saved entrance');
  assert.equal(pinPatchProbe.generalInfoPreserved, true, 'Omitted generalInfo must remain unchanged');
  assert.equal(pinPatchProbe.imageUrlPreserved, true, 'Omitted imageUrl must remain unchanged');
  assert.equal(pinPatchProbe.invalidEntranceRemovalStatus, 400, 'Entrance removal must fail while parking remains');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#school-lat')?.value === '48.141');
  assert.equal(await page.getByLabel('Eingang Breitengrad').inputValue(), '48.141');
  assert.equal(await page.getByLabel('Parkplatz (optional) Breitengrad').inputValue(), '48.1414');
  // Both remove controls affect only local drafts until the user saves. Verify
  // that a confirmed discard reload restores the persisted points.
  await page.getByRole('button', { name: 'Parkplatz entfernen' }).click();
  await page.waitForFunction(() => document.querySelector('#parking-lat')?.value === '');
  assert.equal(await page.getByLabel('Parkplatz (optional) Breitengrad').inputValue(), '');
  await page.getByRole('button', { name: 'Eingang entfernen' }).click();
  await page.waitForFunction(() => document.querySelector('#school-lat')?.value === '');
  assert.equal(await page.getByLabel('Eingang Breitengrad').inputValue(), '');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#school-lat')?.value === '48.141');
  assert.equal(await page.getByLabel('Eingang Breitengrad').inputValue(), '48.141');
  assert.equal(await page.getByLabel('Parkplatz (optional) Breitengrad').inputValue(), '48.1414');
  await shot('schule-profil-desktop');
  await page.setViewportSize({ width: 320, height: 800 });
  await shot('schule-profil-small-mobile');
  await logout();
  await login('reserve1@ui-test.local');
  await page.locator('[title="Eingang"]').waitFor();
  await page.locator('[title="Parkplatz"]').waitFor();
  await shot('lehrkraft-pins-mobile');
  // Fail logout once: reload must not silently log the person back in.
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503, json: { error: 'Offline simulation' } }));
  await logout();
  await page.getByText(/Die Abmeldung konnte vom Server noch nicht bestätigt werden/).waitFor();
  await page.reload();
  await page.getByText(/Die Abmeldung konnte vom Server noch nicht bestätigt werden/).waitFor();
  await page.unroute('**/api/auth/logout');
  await page.getByRole('button', { name: 'Abmeldung erneut versuchen' }).click();
  await page.getByText(/Die Abmeldung konnte vom Server noch nicht bestätigt werden/).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log('Audit UI regressions passed: refresh, cancellation, revoked auth, self-profile, school pins, offline logout.');
} finally { await browser.close(); }
