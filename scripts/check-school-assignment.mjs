// Start: node scripts/preview-ui-regressions.mjs --school-assignment
// Run with PLAYWRIGHT_MODULE set to the installed Playwright index.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE.');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3146';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = path.resolve('output/school-assignment');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
try {
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 }, locale: 'de-DE', timezoneId: 'America/Los_Angeles',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      return request.method() === 'GET' && new URL(request.url()).origin === new URL(base).origin
        ? route.continue() : route.abort();
    });
    await page.goto(base);
    const trigger = page.getByRole('button', { name: /Alexandra Muster.*3 Tage/ }).filter({ visible: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /3\., 4\., 5\., 6\. Stunde/);
    assert.match(await dialog.innerText(), /1\., 3\. Stunde/);
    assert.match(await dialog.innerText(), /Bestätigung offen/);
    assert.match(await dialog.innerText(), /Bestätigt/);
    assert.match(await dialog.innerText(), /Beginn bitte mit der Mobilen Reserve abstimmen/);
    assert.doesNotMatch(await dialog.innerText(), /9\. Stunde/);
    assert.deepEqual(await dialog.locator('time').evaluateAll(elements => elements.map(element => element.dateTime)),
      ['2099-10-19', '2099-10-20', '2099-10-21']);
    assert.equal(await dialog.getByRole('link', { name: '+49 30 5550100', exact: true }).getAttribute('href'), 'tel:+49305550100');
    assert.equal(await dialog.getByRole('link', { name: 'alexandra.muster@example.invalid', exact: true }).getAttribute('href'),
      'mailto:alexandra.muster@example.invalid');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflow at ${width}px`);
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `Popover overflow at ${width}px`);
    const box = await dialog.boundingBox();
    assert.ok(box.x >= -1 && box.x + box.width <= width + 1, `Popover leaves viewport at ${width}px`);
    await page.screenshot({ path: path.join(output, `school-hours-${width}.png`), fullPage: true, animations: 'disabled' });
    await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.ok(await dialog.getByText('Beginn bitte mit der Mobilen Reserve abstimmen', { exact: true }).isVisible());
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log(`School assignment details: ${width}px passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
