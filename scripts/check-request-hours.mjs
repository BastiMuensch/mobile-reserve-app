// Start the isolated fixture with: node scripts/preview-ui-regressions.mjs --request-planning
// Browser checks for school messages, delivered hours and request cancellation.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright index.mjs.');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3145';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
const output = path.resolve('output/request-hours');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      if (request.method() !== 'GET' || new URL(request.url()).origin !== new URL(base).origin) {
        unexpected.push(`${request.method()} ${request.url()}`);
        return route.abort();
      }
      return route.continue();
    });
    const dialog = page.getByRole('dialog');
    const state = async () => JSON.parse(await page.getByTestId('fixture-state').textContent());
    const checkDialog = async name => {
      const dimensions = await dialog.evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth }));
      assert.ok(dimensions.scroll <= dimensions.width + 1, `${name} overflows at ${width}px: ${JSON.stringify(dimensions)}`);
      await page.screenshot({ path: path.join(output, `${name}-${width}.png`), animations: 'disabled' });
    };
    const closeDialog = async () => {
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    };
    try {
      await page.goto(base);
      await page.getByRole('button', { name: 'Nachricht ans Schulamt', exact: true }).click();
      const note = 'Bitte am Haupteingang im Sekretariat melden.';
      await dialog.getByRole('textbox', { name: 'Schulnachricht', exact: true }).fill(note);
      await checkDialog('school-message');
      await dialog.getByRole('button', { name: 'Nachricht speichern', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Nachricht ans Schulamt', exact: true }).click();
      assert.equal(await dialog.getByRole('textbox', { name: 'Schulnachricht', exact: true }).inputValue(), note);
      await closeDialog();

      const schoolHours = page.getByRole('button', { name: 'Stunden melden / korrigieren', exact: true });
      await schoolHours.click();
      await dialog.getByRole('button', { name: 'Stunden für diesen Tag melden', exact: true }).click();
      await dialog.getByLabel('Tatsächlich geleistete UStd.', { exact: true }).fill('3');
      await dialog.getByLabel('Zusätzliche Aufgaben (Minuten)', { exact: true }).fill('15');
      await dialog.getByLabel('Zusätzliche Aufgaben', { exact: true }).fill('Material vorbereitet');
      await dialog.getByLabel('Grund der Meldung / Korrektur', { exact: true }).fill('Unterricht endete früher');
      await checkDialog('school-hours');
      await dialog.getByRole('button', { name: 'Dem Schulamt zur Prüfung senden', exact: true }).click();
      await dialog.getByText('Die Stundenmeldung wurde dem Schulamt zur Prüfung gesendet.', { exact: true }).waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Stunden für diesen Tag melden', exact: true }).count(), 0);
      assert.equal(await dialog.getByText(/Bestätigt geleistet: noch nicht gemeldet/).count(), 2, 'Submission alone must not approve actual hours.');
      await closeDialog();

      const inbox = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Stundenmeldungen zur Prüfung/ }) });
      await inbox.locator('summary').click();
      await inbox.getByRole('button', { name: 'Stundenmeldungen prüfen', exact: true }).click();
      const approval = dialog.locator('section').filter({ has: page.locator('#review-correction-awaiting-review') });
      await approval.getByRole('button', { name: 'Bestätigen', exact: true }).click();
      await dialog.getByText('Geplant: 4 UStd. · Bestätigt geleistet: 5 UStd. + 30 Min. zusätzliche Aufgaben', { exact: true }).waitFor();
      const rejection = dialog.locator('section').filter({ has: page.getByLabel('Rückmeldung (bei Ablehnung erforderlich)', { exact: true }) });
      assert.ok(await rejection.getByRole('button', { name: 'Ablehnen', exact: true }).isDisabled());
      await rejection.getByLabel('Rückmeldung (bei Ablehnung erforderlich)', { exact: true }).fill('Bitte die gemeldeten Aufgaben genauer beschreiben.');
      await checkDialog('office-review');
      await rejection.getByRole('button', { name: 'Ablehnen', exact: true }).click();
      await inbox.waitFor({ state: 'hidden' });
      await schoolHours.click();
      await dialog.getByText('Geplant: 4 UStd. · Bestätigt geleistet: 5 UStd. + 30 Min. zusätzliche Aufgaben', { exact: true }).waitFor();
      await dialog.locator('summary').filter({ hasText: 'Bisherige Stundenmeldungen' }).last().click();
      assert.ok(await dialog.getByText('Rückmeldung: Bitte die gemeldeten Aufgaben genauer beschreiben.', { exact: true }).isVisible());
      await closeDialog();

      await page.getByRole('button', { name: 'Bedarf ändern / beenden', exact: true }).first().click();
      const { days } = await state();
      await dialog.getByLabel('Letzter benötigter Einsatztag (einschließlich)', { exact: true }).fill(days[1]);
      await checkDialog('end-request');
      await dialog.getByRole('button', { name: 'Rückkehr speichern', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual((await state()).calls.filter(call => call.path.endsWith('/end')).at(-1).body, { action: 'END', lastDay: days[1] });
      await page.getByRole('button', { name: 'Bedarf ändern / beenden', exact: true }).first().click();
      await dialog.getByRole('radio', { name: /Verbleibenden Bedarf stornieren/ }).check();
      await checkDialog('cancel-request');
      await dialog.getByRole('button', { name: 'Verbleibenden Bedarf stornieren', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual((await state()).calls.filter(call => call.path.endsWith('/end')).at(-1).body, { action: 'CANCEL' });
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpected, []);
      console.log(`PASS ${width}px: private message editing, hour submission, approval/rejection, preserved plan, visible feedback, return and cancellation; no dialog overflow.`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `failure-${width}.png`) }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
