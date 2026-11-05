// End-to-end private signature check against scripts/seed-ui-test.ts fixtures.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3101';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({ locale: 'de-DE' });
const page = await context.newPage();
const errors = [];
const imageRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.resourceType() === 'image') imageRequests.push(decodeURIComponent(request.url())); });
const image = { name: 'review-signature.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') };
const imageLoaded = source => page.waitForFunction(expected => {
  const img = document.querySelector('img[alt="Unterschrift Vorschau"]');
  if (!img?.getAttribute('src') || img.naturalWidth <= 0) return false;
  const source = new URL(img.getAttribute('src'), location.href);
  return expected === 'blob:' ? source.protocol === 'blob:' : source.pathname === expected;
}, source);
async function save() {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/schulamt/profile' && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Dokumente speichern', exact: true }).click();
  assert.equal((await response).status(), 200);
  await page.getByRole('button', { name: 'Dokumente speichern', exact: true }).waitFor({ state: 'visible' });
}

try {
  await page.goto(base);
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill('schulamt@ui-test.local');
  await page.getByLabel('Passwort', { exact: true }).fill('Ui-Test-Reserve-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  const notice = page.getByRole('dialog').getByRole('button', { name: 'Verstanden', exact: true });
  await notice.waitFor({ timeout: 5000 }).then(() => notice.click(), () => {});
  await page.getByRole('heading', { name: 'Heute im Überblick', exact: true }).waitFor();
  await page.goto(`${base}/schulamt/einstellungen#documents-mail`);
  await page.locator('#office-signature-upload').waitFor();
  await page.locator('#documentSubject').fill('Prüfung Unterschrift');
  await page.locator('#documentIntro').fill('Synthetische Prüfung der privaten Vorschau.');
  await page.locator('#documentClosing').fill('Mit freundlichen Grüßen');
  const upload = page.waitForResponse(r => new URL(r.url()).pathname === '/api/upload' && r.request().method() === 'POST');
  await page.locator('#office-signature-upload').setInputFiles(image);
  const uploaded = await upload;
  assert.equal(uploaded.status(), 200);
  const { url } = await uploaded.json();
  assert.match(url, /^\/api\/media\/[a-f0-9-]+\.png$/);
  await imageLoaded('blob:');
  assert.equal(imageRequests.some(request => request.includes(url)), false, 'Unsaved preview uses only the local file');
  assert.equal(await page.evaluate(async source => (await fetch(source)).status, url), 403, 'Unsaved private URL remains protected');
  await save();
  await imageLoaded(url);
  assert.equal(await page.getByAltText('Unterschrift Vorschau').getAttribute('srcset'), null);
  await page.reload();
  await imageLoaded(url);
  assert.equal(await page.evaluate(async source => (await fetch(source)).status, url), 200);
  assert.equal(imageRequests.some(request => request.includes('/_next/image') && request.includes(url)), false);
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(`${base}${url}`)).status(), 401, 'Anonymous access stays denied');
  await anonymous.close();
  await page.getByRole('button', { name: 'Unterschrift entfernen', exact: true }).click();
  await save();
  assert.equal(await page.evaluate(async source => (await fetch(source)).status, url), 403);
  assert.deepEqual(errors, []);
  console.log('Private signature passed: local draft, saved authenticated image, reload, removal and denied anonymous access.');
} finally {
  await browser.close();
}
