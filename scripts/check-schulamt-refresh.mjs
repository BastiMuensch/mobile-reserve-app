// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright index.mjs.
// Serves only the real hook with synthetic API responses on a loopback address.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright index.mjs.');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const bundle = await build({
  entryPoints: ['tests/fixtures/schulamtRefreshPreview.tsx'],
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
});
const server = createServer((request, response) => {
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
  if (request.url === '/app.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(bundle.outputFiles[0].contents);
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><html lang="de"><div id="root"></div><script src="/app.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
try {
  const page = await browser.newPage();
  const errors = [];
  const calls = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().method() !== 'GET' || new URL(route.request().url()).origin !== base) return route.abort();
    return route.continue();
  });
  await page.route('**/api/teachers?*', route => {
    const year = new URL(route.request().url()).searchParams.get('year');
    calls.push(year);
    return route.fulfill({ json: [{ id: year, name: `Lehrkraft ${year}`, status: 'ACTIVE', schoolYear: year }] });
  });
  const state = () => page.getByTestId('snapshot').textContent().then(JSON.parse);
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('output')?.textContent?.includes('Lehrkraft 2025/2026'));
  await page.getByRole('button', { name: 'Änderung beginnen' }).click();
  await page.getByRole('button', { name: 'Nächstes Schuljahr' }).click();
  await page.waitForFunction(() => document.querySelector('output')?.textContent?.includes('Lehrkraft 2026/2027'));
  const revision = (await state()).revision;
  const before = calls.length;
  await page.getByRole('button', { name: 'Änderung abschließen' }).click();
  await page.waitForFunction(value => JSON.parse(document.querySelector('output').textContent).revision > value, revision);
  assert.deepEqual(calls.slice(before), ['2026/2027']);
  assert.deepEqual((await state()).names, ['Lehrkraft 2026/2027']);
  assert.equal((await state()).loading, false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ staleMutationRefreshesCurrentYear: true, strictModeLoads: true, calls }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
