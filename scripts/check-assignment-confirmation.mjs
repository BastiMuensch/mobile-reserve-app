// Start: node scripts/preview-ui-regressions.mjs --planning
// Real confirmation controls, synthetic assignments and in-memory responses only.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const engines = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const engine = process.env.UI_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3139';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = path.resolve('output/assignment-confirmation');
await mkdir(output, { recursive: true });
const browser = await engines[engine].launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
});

try {
  for (const width of [390, 320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 },
      hasTouch: width < 500, isMobile: width < 500, locale: 'de-DE', timezoneId: 'Europe/Berlin',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().method() === 'GET' && new URL(route.request().url()).origin === new URL(base).origin
      ? route.continue() : route.abort());
    await page.clock.install();
    await page.goto(base);
    const section = page.getByRole('region', { name: 'Reserve gemeinsam bestätigen', exact: true });
    const confirm = section.getByRole('button', { name: 'Alle 10 Einsatztage bestätigen', exact: true });
    const activate = locator => width < 500 ? locator.tap() : locator.click();
    await confirm.waitFor();
    assert.equal(await confirm.isEnabled(), true, 'Confirmation starts enabled, including on touch screens');
    await page.evaluate(() => {
      const original = window.fetch;
      window.__confirmation = { mode: 'pending', calls: 0, aborted: 0, refreshed: 0, invalidated: 0 };
      window.addEventListener('app-refresh', () => window.__confirmation.refreshed++);
      window.addEventListener('auth-invalidated', () => window.__confirmation.invalidated++);
      window.fetch = async (input, init) => {
        const state = window.__confirmation;
        if (!String(input).endsWith('/status')) return original(input, init);
        state.calls++;
        const waitForAbort = () => new Promise((resolve, reject) => {
          const abort = () => { state.aborted++; reject(new DOMException('Aborted', 'AbortError')); };
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener('abort', abort, { once: true });
        });
        if (state.mode === 'pending') return waitForAbort();
        if (state.mode === 'body') return { ok: true, status: 200, json: waitForAbort };
        if (state.mode === 'offline') throw new TypeError('Failed to fetch');
        if (state.mode === 'conflict') return Response.json({ error: 'Der Einsatz wurde zwischenzeitlich storniert.' }, { status: 409 });
        if (state.mode === 'unauthorized') return Response.json({ error: 'Unauthorized' }, { status: 401 });
        return original(input, init);
      };
    });
    await activate(confirm);
    const waiting = section.getByRole('button', { name: 'Wird verarbeitet...', exact: true });
    assert.equal(await waiting.isDisabled(), true);
    await page.clock.fastForward(31_000);
    assert.equal(await section.getByRole('button').first().isEnabled(), true, 'A stalled request must release the confirmation controls');
    await section.getByRole('alert').filter({ hasText: 'möglicherweise bereits gespeichert' }).waitFor();
    assert.deepEqual(await page.evaluate(() => [window.__confirmation.calls, window.__confirmation.aborted, window.__confirmation.refreshed]), [1, 1, 1]);
    assert.equal(await section.getByText('Einsatz bestätigt.', { exact: true }).count(), 0);
    await section.screenshot({ path: path.join(output, `${engine}-${width}-timeout.png`) });

    // Receiving headers alone is insufficient: reading the response body can hang too.
    await page.evaluate(() => { window.__confirmation.mode = 'body'; });
    await activate(confirm);
    await page.clock.fastForward(31_000);
    await section.getByRole('alert').filter({ hasText: 'möglicherweise bereits gespeichert' }).waitFor();
    assert.equal(await confirm.isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__confirmation.aborted), 2);

    await page.evaluate(() => { window.__confirmation.mode = 'offline'; });
    await activate(confirm);
    await section.getByRole('alert').filter({ hasText: 'Verbindung' }).waitFor();
    assert.equal(await confirm.isEnabled(), true);

    await page.evaluate(() => { window.__confirmation.mode = 'conflict'; });
    await activate(confirm);
    await section.getByRole('alert').filter({ hasText: 'zwischenzeitlich storniert' }).waitFor();
    assert.equal(await confirm.isEnabled(), true);

    await page.evaluate(() => { window.__confirmation.mode = 'unauthorized'; });
    await activate(confirm);
    await page.waitForFunction(() => window.__confirmation.invalidated === 1);

    await page.evaluate(() => { window.__confirmation.mode = 'success'; });
    await activate(confirm);
    await section.getByText('Alle zehn Einsatztage sind bestätigt.', { exact: true }).waitFor();
    assert.equal(await section.getByRole('alert').count(), 0);

    // The alternate single-day action stays usable after recovery as well.
    await page.getByRole('button', { name: 'Beispiele zurücksetzen', exact: true }).click();
    await activate(section.getByRole('button', { name: /^Nur .* bestätigen$/ }));
    await section.getByRole('button', { name: 'Alle 9 Einsatztage bestätigen', exact: true }).waitFor();
    assert.ok(await section.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `Confirmation overflow at ${width}px`);
    assert.deepEqual(errors, []);
    console.log(`${engine} ${width}px: touch/click, stalled request/body, retry, offline, conflict, session expiry, series and single-day confirmation passed`);
    await context.close();
  }
} finally { await browser.close(); }
