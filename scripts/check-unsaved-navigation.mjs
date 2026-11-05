// Real App Router navigation against scripts/seed-ui-test.ts fixtures only.
// UI_TEST_BROWSERS=chromium,webkit optionally exercises both browser engines.
// UI_TEST_VIEWPORT=1280x900 can isolate engine navigation from mobile layout checks.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const engines = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3101';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const [width, height] = (process.env.UI_TEST_VIEWPORT || '390x844').split('x').map(Number);
assert.ok(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0, 'UI_TEST_VIEWPORT must be WIDTHxHEIGHT');

for (const engine of (process.env.UI_TEST_BROWSERS || 'chromium').split(',')) {
  assert.ok(['chromium', 'webkit'].includes(engine));
  const browser = await engines[engine].launch({ headless: true,
    ...(engine === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    ...(engine === 'webkit' && process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE } : {}),
  });
  const errors = [];
  const consoleErrors = [];
  const context = await browser.newContext({ viewport: { width, height }, locale: 'de-DE',
    ignoreHTTPSErrors: process.env.UI_TEST_ALLOW_LOCAL_CERTIFICATE === 'true',
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);

  async function login(email) {
    await page.goto(base);
    await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
    await page.getByLabel('Passwort', { exact: true }).fill('Ui-Test-Reserve-2026!');
    const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    const response = await loginResponse;
    assert.equal(response.status(), 200, `${engine}: ${email} login returned ${response.status()}: ${response.status() === 200 ? '' : await response.text()}`);
    const notice = page.getByRole('dialog').getByRole('button', { name: 'Verstanden', exact: true });
    await notice.waitFor({ timeout: 5000 }).then(() => notice.click(), () => {});
    await page.getByRole('button', { name: 'Abmelden', exact: true }).filter({ visible: true }).waitFor();
  }

  async function confirmed(action, accept = false) {
    const dialogPromise = page.waitForEvent('dialog');
    const actionPromise = action();
    const dialog = await dialogPromise;
    assert.equal(dialog.type(), 'confirm');
    assert.match(dialog.message(), /nicht gespeicherte Änderungen/);
    await (accept ? dialog.accept() : dialog.dismiss());
    await actionPromise;
  }

  try {
    await login('reserve1@ui-test.local');
    await page.getByRole('link', { name: 'Mein Profil', exact: true }).click();
    const phone = page.getByLabel('Telefon (optional)', { exact: true });
    const originalPhone = await phone.inputValue();
    const historyLength = await page.evaluate(() => history.length);
    await phone.fill('089 12345 Entwurf');
    assert.equal(await page.evaluate(() => history.length), historyLength, 'Editing must not add a sentinel history entry');

    await confirmed(() => page.evaluate(() => history.back()));
    await page.waitForURL(`${base}/lehrkraft/profil`);
    assert.equal(await phone.inputValue(), '089 12345 Entwurf', 'Cancelled Back keeps the mounted form');
    assert.equal(await page.evaluate(() => history.length), historyLength);
    await confirmed(() => page.evaluate(() => history.back()));
    await page.waitForURL(`${base}/lehrkraft/profil`);
    assert.equal(await phone.inputValue(), '089 12345 Entwurf', 'Repeated cancellation remains safe');

    await confirmed(() => page.evaluate(() => history.back()), true);
    await page.waitForURL(`${base}/`);
    await page.getByRole('heading', { name: 'Hallo, Anna Beispiel', exact: true }).waitFor();
    // The forward entry must remain intact after both cancelled and accepted Back.
    await page.evaluate(() => history.forward());
    await page.waitForURL(`${base}/lehrkraft/profil`);
    assert.equal(await phone.inputValue(), originalPhone, 'Confirmed discard reloads saved data');
    await page.getByRole('button', { name: 'Zum Einsatzplan', exact: true }).click();
    await page.waitForURL(`${base}/`);
    await page.evaluate(() => history.back());
    await page.waitForURL(`${base}/lehrkraft/profil`);
    await phone.fill('089 67890 Vorwärts-Entwurf');
    await confirmed(() => page.evaluate(() => history.forward()));
    await page.waitForURL(`${base}/lehrkraft/profil`);
    assert.equal(await phone.inputValue(), '089 67890 Vorwärts-Entwurf');
    await confirmed(() => page.evaluate(() => history.forward()), true);
    await page.waitForURL(`${base}/`);

    await page.getByRole('link', { name: 'Mein Profil', exact: true }).click();
    await phone.fill('Mehrere Einträge zurück');
    await confirmed(() => page.evaluate(() => history.go(-2)));
    await page.waitForURL(`${base}/lehrkraft/profil`);
    assert.equal(await phone.inputValue(), 'Mehrere Einträge zurück');
    await phone.fill(originalPhone);
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
    await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();

    await login('schule1@ui-test.local');
    await page.getByRole('link', { name: 'Schulprofil bearbeiten', exact: true }).click();
    const info = page.locator('#generalInfo');
    const originalInfo = await info.inputValue();
    await info.fill('Ungespeicherte Hinweise für den Eingang');
    await confirmed(() => page.getByRole('button', { name: 'Zurück zum Dashboard', exact: true }).click());
    assert.equal(new URL(page.url()).pathname, '/schule/profil');
    assert.equal(await info.inputValue(), 'Ungespeicherte Hinweise für den Eingang');
    await confirmed(() => page.getByRole('link', { name: 'Bedarfe & Vertretungen', exact: true }).click());
    assert.equal(await info.inputValue(), 'Ungespeicherte Hinweise für den Eingang');

    // Several independent forms share one guard, including the nested account form.
    const email = page.locator('#school-email');
    const originalEmail = await email.inputValue();
    await email.fill('unsaved-navigation@example.invalid');
    await confirmed(() => page.getByRole('button', { name: 'Zurück zum Dashboard', exact: true }).click());
    assert.equal(await email.inputValue(), 'unsaved-navigation@example.invalid');
    await info.fill(originalInfo);
    await confirmed(() => page.getByRole('button', { name: 'Zurück zum Dashboard', exact: true }).click());
    assert.equal(await email.inputValue(), 'unsaved-navigation@example.invalid', 'A nested dirty form keeps the page guarded');
    await email.fill(originalEmail);
    await info.fill('Ungespeicherte Hinweise für den Eingang');

    // Hash changes within the same page keep the draft without asking.
    let unexpectedDialogs = 0;
    const dismissUnexpected = async dialog => { unexpectedDialogs++; await dialog.dismiss(); };
    page.on('dialog', dismissUnexpected);
    await page.evaluate(() => history.pushState(history.state, '', '#review-arrival'));
    await page.evaluate(() => history.back());
    await page.waitForURL(`${base}/schule/profil`);
    assert.equal(await info.inputValue(), 'Ungespeicherte Hinweise für den Eingang');
    await page.evaluate(() => { location.hash = '#native-review-arrival'; });
    await page.waitForURL(`${base}/schule/profil#native-review-arrival`);
    await page.evaluate(() => history.back());
    await page.waitForURL(`${base}/schule/profil`);
    assert.equal(await info.inputValue(), 'Ungespeicherte Hinweise für den Eingang');
    assert.equal(unexpectedDialogs, 0);
    page.off('dialog', dismissUnexpected);

    await confirmed(() => page.getByRole('button', { name: 'Zurück zum Dashboard', exact: true }).click(), true);
    await page.waitForURL(`${base}/`);
    await page.getByRole('link', { name: 'Schulprofil bearbeiten', exact: true }).click();
    assert.equal(await info.inputValue(), originalInfo);
    // Saving removes the guard; the next traversal must not show an old warning.
    await info.fill(originalInfo + '\nNavigation regression fixture.');
    const save = page.waitForResponse(r => new URL(r.url()).pathname === '/api/schools' && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Profil speichern', exact: true }).click();
    assert.equal((await save).status(), 200);
    await page.getByText('Schulprofil gespeichert.', { exact: true }).waitFor();
    page.on('dialog', dismissUnexpected);
    await page.evaluate(() => history.back());
    await page.waitForURL(`${base}/`);
    assert.equal(unexpectedDialogs, 0, 'A saved form no longer blocks traversal');
    page.off('dialog', dismissUnexpected);
    await page.getByRole('link', { name: 'Schulprofil bearbeiten', exact: true }).click();
    await info.fill(originalInfo);
    const restore = page.waitForResponse(r => new URL(r.url()).pathname === '/api/schools' && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Profil speichern', exact: true }).click();
    assert.equal((await restore).status(), 200);
    assert.deepEqual(errors, []);
    console.log(`${engine} (${width}x${height}): Back, Forward, repeated cancel, multi-entry traversal, links, school return button, hash and saved-state navigation passed.`);
  } catch (error) {
    console.error(`${engine}: navigation test failed at ${page.url()}`);
    console.error('Browser errors:', errors);
    console.error('Console errors:', consoleErrors.slice(-15));
    console.error('Visible page:', (await page.locator('body').innerText().catch(() => '')).slice(0, 3000));
    await page.screenshot({ path: `/tmp/mobile-reserve-unsaved-navigation-${engine}-failure.png`, fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}
