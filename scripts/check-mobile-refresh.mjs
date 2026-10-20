// Run against a local production build. All API responses are synthetic.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs UI_TEST_BASE_URL=http://127.0.0.1:3000 node scripts/check-mobile-refresh.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright index.mjs.');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only local builds are allowed.');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const teacher = { id: 'review-teacher', name: 'Testreserve', schoolYear: '2026/2027', status: 'ACTIVE', qualificationType: 'TEACHER_GS', canTeachSports: true };
const school = { id: 'review-school', name: 'Testschule', address: 'Testweg 1', latitude: null, longitude: null };
const request = { id: 'review-request', startHour: 1, hours: 4, schoolType: 'GRUNDSCHULE', schedule: JSON.stringify({ 2: [1, 2, 3, 4], 3: [1, 2, 3, 4] }), school, comments: '', substitutedTeacher: 'Test' };
const assignments = ['2026-10-20', '2026-10-21'].map((date, i) => ({ id: `assignment-${i}`, teacherId: teacher.id, requestId: request.id, request, date: `${date}T00:00:00.000Z`, hours: 2, lessonHours: '[3,4]', status: 'ACCEPTED' }));
const results = {};

async function setup({ role = 'TEACHER', time = '2026-10-20T08:00:00Z', timezoneId = 'Europe/Berlin' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId, serviceWorkers: 'block' });
  // Disable background auth polling; the scenarios trigger refreshes explicitly.
  await context.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' });
    // Playwright's blocked registration resolves to undefined; real browsers
    // either return a registration or reject. Model the latter for this test.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('Service worker disabled in synthetic test.'));
    }
  });
  const page = await context.newPage();
  const errors = [];
  const scriptResources = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.request().resourceType() === 'script' && response.url().includes('/_next/')) scriptResources.add(response.url());
  });
  await page.clock.install({ time: new Date(time) });
  await page.route('**/*', route => {
    if (route.request().method() !== 'GET' || new URL(route.request().url()).origin !== new URL(base).origin) return route.abort();
    return route.continue();
  });
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const user = role ? { id: 'review-user', email: 'review@example.invalid', name: 'Testreserve', role, schoolId: role === 'SCHOOL' ? school.id : null, school, teachers: [teacher] } : null;
    const body = pathname === '/api/auth/me' ? { user } : pathname === '/api/setup/status' ? { needsSetup: false } : pathname === '/api/release-notes' ? { releases: [] } : {};
    await route.fulfill({ json: body });
  });
  return {
    page,
    scriptResources,
    async close() {
      assert.deepEqual(errors, []);
      await context.close();
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

try {
  for (const role of ['TEACHER', 'SCHOOL']) {
    const { page, close } = await setup({ role });
    const seen = deferred();
    const release = deferred();
    let requests = 0;
    const endpoint = role === 'TEACHER' ? '**/api/teachers/*/assignments' : '**/api/requests?*';
    await page.route(endpoint, async route => {
      requests += 1;
      if (requests === 1) {
        seen.resolve();
        await release.promise;
      }
      await route.fulfill({ json: role === 'TEACHER' ? assignments : [] }).catch(() => {});
    });
    await page.goto(base);
    await seen.promise;
    await page.clock.runFor(15_000);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('app-refresh'));
      window.dispatchEvent(new Event('app-refresh'));
    });
    assert.equal(requests, 1, 'A 15-second refresh must not abort a slow initial load.');
    release.resolve();
    if (role === 'TEACHER') {
      await page.getByRole('heading', { name: 'Hallo, Testreserve', exact: true }).waitFor();
      await page.locator('[aria-label="Einsätze werden geladen"]').waitFor({ state: 'hidden' });
    } else {
      await page.getByText('Keine aktiven Anfragen gefunden.', { exact: true }).waitFor();
    }
    await page.waitForLoadState('networkidle');
    assert.equal(requests, 2, 'Multiple refresh events must become one follow-up.');
    results[`${role.toLowerCase()}SlowInitialLoad`] = { requests, loaded: true };
    await close();
  }

  {
    const { page, close } = await setup();
    const seen = deferred();
    const release = deferred();
    await page.route('**/api/teachers/*/assignments', async route => {
      seen.resolve();
      await release.promise;
      await route.fulfill({ json: [] }).catch(() => {});
    });
    await page.goto(base);
    await seen.promise;
    await page.clock.runFor(20_100);
    await page.getByText('Das Laden dauert zu lange. Bitte prüfen Sie die Verbindung und versuchen Sie es erneut.', { exact: true }).waitFor();
    assert.equal(await page.locator('[aria-label="Einsätze werden geladen"]').isVisible(), false);
    results.initialTimeoutShowsRetry = true;
    release.resolve();
    await close();
  }

  for (const trigger of ['focus', 'timer']) {
    const { page, close } = await setup({ time: '2026-10-20T21:59:50Z', timezoneId: 'America/Los_Angeles' });
    await page.route('**/api/teachers/*/assignments', route => route.fulfill({ json: assignments }));
    await page.goto(base);
    await page.getByRole('heading', { name: 'Testschule', exact: true }).waitFor();
    await page.getByText('20.10.2026', { exact: true }).waitFor();
    await page.clock.setSystemTime(new Date('2026-10-20T22:01:00Z'));
    if (trigger === 'focus') await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    else await page.clock.runFor(60_100);
    await page.getByText('20.10.2026', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByText('21.10.2026', { exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /ab 3\. Std\./);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    results[`${trigger}UpdatesBerlinDay`] = true;
    await close();
  }

  {
    const { page, close, scriptResources } = await setup({ role: null });
    await page.goto(base);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    assert.ok(scriptResources.size > 0, 'The login measurement must contain actual script responses.');
    const chunks = [...scriptResources].map(url => {
      const filename = path.resolve(new URL(url).pathname.replace('/_next/', '.next/'));
      const content = fs.readFileSync(filename);
      return { file: path.relative(process.cwd(), filename), bytes: content.length, gzip: zlib.gzipSync(content).length };
    });
    const lazyManifest = JSON.parse(fs.readFileSync('.next/react-loadable-manifest.json', 'utf8'));
    for (const component of [
      'app/page.tsx -> @/components/SchoolDashboard',
      'app/page.tsx -> @/components/TeacherDashboard',
      'components/LoginScreen.tsx -> ./setup/InitialSetupWizard',
    ]) {
      const componentChunk = lazyManifest[component]?.files.filter(file => file.endsWith('.js')).at(-1);
      assert.ok(componentChunk, `${component} must have a separate JavaScript chunk.`);
      assert.ok(!chunks.some(chunk => chunk.file === `.next/${componentChunk}`), `${component} must not load on login.`);
    }
    results.loginJavaScript = {
      chunks,
      totalBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
      totalGzip: chunks.reduce((sum, chunk) => sum + chunk.gzip, 0),
    };
    await close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
