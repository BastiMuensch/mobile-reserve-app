// Start the read-only fixture with: node scripts/preview-ui-regressions.mjs --school-request-sorting
// Run: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/check-school-request-sorting.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright index.mjs.');
const { chromium } = await import(pathToFileURL(modulePath).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3143';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only local synthetic fixtures are allowed');
const output = path.resolve('output/school-request-sorting');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const priorityOrder = ['Test-Spaet', 'Test-Laufend', 'Test-Stunde-2', 'Test-Stunde-5', 'Test-Frueh', 'Test-Keine-Reserve'];
const dateOrder = ['Test-Laufend', 'Test-Frueh', 'Test-Stunde-2', 'Test-Stunde-5', 'Test-Spaet', 'Test-Keine-Reserve'];
const archiveOrder = ['Test-Archiv-Neu', 'Test-Archiv-Alt'];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    const page = await context.newPage();
    const errors = [];
    const unexpectedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const req = route.request();
      if (req.method() !== 'GET' || new URL(req.url()).origin !== new URL(base).origin) {
        unexpectedRequests.push(`${req.method()} ${req.url()}`);
        return route.abort();
      }
      return route.continue();
    });
    const visibleRows = () => page.locator(viewport.width < 896 ? 'article:visible' : 'tbody tr:visible');
    const assertOrder = async expected => {
      const text = await visibleRows().allTextContents();
      assert.deepEqual(text.map(value => [...priorityOrder, ...archiveOrder].find(name => value.includes(name))), expected);
    };
    await page.goto(base);
    const sort = page.getByRole('group', { name: 'Anfragen sortieren' });
    const priority = sort.getByRole('button', { name: 'Prio', exact: true });
    const date = sort.getByRole('button', { name: 'Datum', exact: true });
    await priority.waitFor();
    assert.equal(await priority.getAttribute('aria-pressed'), 'true');
    await assertOrder(priorityOrder);
    assert.equal(await page.getByRole('heading', { level: 3 }).count(), 4);

    // Keyboard activation exposes the same pressed state and cross-priority chronology.
    await date.focus();
    await page.keyboard.press('Enter');
    assert.equal(await date.getAttribute('aria-pressed'), 'true');
    assert.equal(await priority.getAttribute('aria-pressed'), 'false');
    await assertOrder(dateOrder);
    assert.equal(await page.getByRole('heading', { level: 3 }).count(), 0);
    assert.ok(await visibleRows().filter({ hasText: 'Test-Keine-Reserve' }).getByText('Schulintern geblockt (früherer Grund)', { exact: true }).isVisible());
    assert.ok(await visibleRows().filter({ hasText: 'Test-Stunde-2' }).getByText('Dienstbefreiung / Freistellung vom Dienst', { exact: true }).isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
    await page.screenshot({ path: path.join(output, `date-${viewport.width}.png`), fullPage: true });

    const filters = page.getByRole('group', { name: 'Nach Status filtern' });
    const pending = filters.getByRole('button', { name: 'Ausstehend (3)', exact: true });
    await pending.click();
    await assertOrder(['Test-Laufend', 'Test-Stunde-5', 'Test-Spaet']);
    await priority.click();
    await assertOrder(['Test-Spaet', 'Test-Laufend', 'Test-Stunde-5']);
    assert.equal(await pending.getAttribute('aria-pressed'), 'true');
    await date.click();
    await filters.getByRole('button', { name: 'Besetzt (1)', exact: true }).click();
    await assertOrder(['Test-Laufend', 'Test-Frueh', 'Test-Stunde-5', 'Test-Spaet']);
    await pending.click();
    await filters.getByRole('button', { name: 'Besetzt (1)', exact: true }).click();
    await filters.getByRole('button', { name: 'Keine Reserve (2)', exact: true }).click();
    await assertOrder(['Test-Laufend', 'Test-Keine-Reserve']);

    // Archive keeps its descending chronology and ignores active-list filters/sorting.
    const archive = page.getByRole('button', { name: 'Archiv (2 vergangene Anfragen)', exact: true });
    assert.equal(await archive.getAttribute('aria-expanded'), 'false');
    await archive.click();
    await assertOrder(['Test-Laufend', 'Test-Keine-Reserve', ...archiveOrder]);
    await priority.click();
    await assertOrder(['Test-Laufend', 'Test-Keine-Reserve', ...archiveOrder]);
    assert.equal(await visibleRows().filter({ hasText: 'Test-Archiv-' }).getByRole('button').count(), 2, 'Archived rows only retain note popovers');
    assert.equal(await visibleRows().filter({ hasText: 'Test-Archiv-' }).getByRole('button', { name: 'Anfrage stornieren' }).count(), 0);
    await archive.click();
    await filters.getByRole('button', { name: 'Keine Reserve (2)', exact: true }).click();
    await date.click();
    await assertOrder(dateOrder);

    // Actions continue to point to the correct request after reordered rows.
    await visibleRows().filter({ hasText: 'Test-Spaet' }).getByRole('button', { name: 'Anfrage stornieren' }).click();
    assert.equal(await page.getByRole('status').textContent(), 'Test-Stornierung: Test-Spaet');
    await visibleRows().filter({ hasText: 'Test-Laufend' }).getByRole('button', { name: 'Rückkehr melden' }).click();
    assert.equal(await page.getByRole('status').textContent(), 'Test-Rückkehr: Test-Laufend');
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedRequests, []);
    console.log(`PASS ${viewport.width}px: priority/date, same-day hours, keyboard/pressed state, status combinations, day-specific refusal, archive, row actions, layout; no browser errors or API mutations.`);
    await context.close();
  }
} finally {
  await browser.close();
}
