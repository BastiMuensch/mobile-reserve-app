// Real browser regression for WebKit's native PushManager call before permission.
// Requires the isolated scripts/seed-ui-test.ts fixture, with service workers allowed.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const engines = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const engine = process.env.UI_TEST_BROWSER || 'webkit';
assert.ok(['chromium', 'webkit'].includes(engine));
const base = process.env.UI_TEST_BASE_URL || 'https://127.0.0.1:3443';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const browser = await engines[engine].launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
});

try {
  // Chromium can grant notifications in automation. WebKit's permission prompt
  // is checked with its real default state; granted activation has separate tests.
  for (const permission of engine === 'chromium' ? ['default', 'granted'] : ['default']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE',
      ignoreHTTPSErrors: process.env.UI_TEST_ALLOW_LOCAL_CERTIFICATE === 'true', serviceWorkers: 'allow',
    });
    if (permission === 'granted') await context.grantPermissions(['notifications'], { origin: base });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    const subscriptionReads = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('__recordPushQuery', value => subscriptionReads.push(value));
    await page.addInitScript(() => {
      if (!globalThis.PushManager) return;
      const original = PushManager.prototype.getSubscription;
      // Observe the real native call. Do not stub it or disable service workers.
      PushManager.prototype.getSubscription = function (...args) {
        void window.__recordPushQuery(Notification.permission);
        return original.apply(this, args);
      };
    });
    try {
      for (const role of ['reserve1', 'schule1']) {
        await page.goto(base);
        assert.equal(await page.evaluate(() => Notification.permission), permission);
        await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(`${role}@ui-test.local`);
        await page.getByLabel('Passwort', { exact: true }).fill('Ui-Test-Reserve-2026!');
        const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
        assert.equal((await response).status(), 200);
        const notice = page.getByRole('dialog').getByRole('button', { name: 'Verstanden', exact: true });
        await notice.waitFor({ timeout: 5000 }).then(() => notice.click(), () => {});
        await page.getByRole('button', { name: 'Push aktivieren', exact: true }).waitFor();
        await page.waitForFunction(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state === 'activated';
        });
        // Original regression stopped responding after registration/activation.
        await new Promise(resolve => setTimeout(resolve, 6000));
        assert.ok((await page.locator('body').innerText()).length > 300);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.getByRole('button', { name: 'Push aktivieren', exact: true }).waitFor();
        if (role === 'reserve1') {
          await page.getByRole('tab', { name: 'Pro Monat', exact: true }).click();
          await page.getByLabel('Monat für die Abrechnung', { exact: true }).waitFor();
          await page.getByRole('tab', { name: 'Pro Einsatz', exact: true }).click();
        } else {
          await page.getByRole('link', { name: 'Schulprofil bearbeiten', exact: true }).click();
          await page.locator('#generalInfo').waitFor();
        }
        await page.reload();
        await page.getByRole('button', { name: 'Abmelden', exact: true }).filter({ visible: true }).click();
        await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      assert.ok(subscriptionReads.every(value => value === 'granted'), 'Native push queries must require granted permission');
      if (permission === 'default') assert.equal(subscriptionReads.length, 0);
      else assert.ok(subscriptionReads.length >= 4, `Granted status checks and logout cleanup still query real subscriptions (observed ${subscriptionReads.length}: ${subscriptionReads.join(', ')})`);
      console.log(`${engine}: teacher/school login, delayed dashboard, tabs, focus, reload and logout passed (${permission}; native reads ${subscriptionReads.length}; real active service worker).`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
