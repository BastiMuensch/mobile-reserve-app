// Run against: node scripts/preview-ui-regressions.mjs --ui-review-fixes
// Real components, synthetic in-memory APIs; no database or user files are changed.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3149';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = path.resolve('output/ui-review-fixes');
await mkdir(output, { recursive: true });
const browser = await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
const errors = [];
const imageRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.resourceType() === 'image') imageRequests.push(decodeURIComponent(request.url())); });
const image = { name: 'signature.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') };
const signature = () => page.getByAltText('Unterschrift Vorschau');
const keyboardChecked = new Set();

async function keyboardFile(id, file = image) {
  console.log(`${keyboardChecked.has(id) ? 'Repeat' : 'Keyboard'} file selection: ${id}`);
  const input = page.locator(`#${id}`);
  await page.waitForFunction(inputId => {
    const node = document.getElementById(inputId);
    return node && !node.matches(':disabled');
  }, id);
  if (keyboardChecked.has(id)) {
    await input.setInputFiles(file);
    return;
  }
  await input.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.equal(await input.evaluate(node => document.activeElement === node), true, `${id} is in the tab order`);
  // Native file dialogs can pause the key dispatch until a file is chosen.
  const choose = page.waitForEvent('filechooser').then(chooser => chooser.setFiles(file));
  await Promise.all([choose, page.keyboard.press('Space')]);
  keyboardChecked.add(id);
  console.log(`File selected: ${id}`);
}

async function localSignature(previous) {
  await page.waitForFunction(previousSource => {
    const element = document.querySelector('img[alt="Unterschrift Vorschau"]');
    return element?.getAttribute('src')?.startsWith('blob:') && element.getAttribute('src') !== previousSource && element.naturalWidth > 0;
  }, previous);
  return signature().getAttribute('src');
}

async function allURLsReleased() {
  await page.waitForFunction(() => window.__uiReview.created.every(url => window.__uiReview.revoked.includes(url)));
}

async function shot(name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: horizontal overflow`);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false, animations: 'disabled' });
}

try {
  await page.goto(`${base}/?view=settings#documents-mail`);
  await signature().waitFor();
  assert.equal(new URL(await signature().getAttribute('src'), base).pathname, '/api/media/stored-signature.png');
  assert.equal(await signature().getAttribute('srcset'), null);
  await page.waitForFunction(() => document.querySelector('img[alt="Unterschrift Vorschau"]')?.naturalWidth > 0);
  await keyboardFile('office-logo-upload');
  await keyboardFile('office-signature-upload');
  const first = await localSignature();
  await keyboardFile('office-signature-upload');
  const second = await localSignature(first);
  await page.waitForFunction(url => window.__uiReview.revoked.includes(url), first);
  assert.equal(imageRequests.some(url => url.includes('/api/media/signature-')), false, 'Unsaved signature never requests its private URL');

  await page.evaluate(() => { window.__uiReview.rejectNextUpload = true; });
  await keyboardFile('office-signature-upload');
  await page.getByText('Upload fehlgeschlagen: Simulierter Uploadfehler', { exact: true }).waitFor();
  assert.equal(await signature().getAttribute('src'), second, 'Failed upload retains the previous preview');
  await page.evaluate(() => { window.__uiReview.rejectNextSave = true; });
  await page.getByRole('button', { name: 'Dokumente speichern', exact: true }).click();
  await page.getByText('Einstellungen konnten nicht gespeichert werden.', { exact: true }).waitFor();
  assert.equal(await signature().getAttribute('src'), second, 'Failed save retains the local preview');
  await page.getByRole('button', { name: 'Dokumente speichern', exact: true }).click();
  await page.waitForFunction(() => {
    const source = document.querySelector('img[alt="Unterschrift Vorschau"]')?.getAttribute('src');
    return source && new URL(source, window.location.href).pathname.startsWith('/api/media/signature-');
  });
  await allURLsReleased();

  // Preview construction failure is announced, and a later selection recovers.
  await page.evaluate(() => { window.__uiReview.rejectNextObjectURL = true; });
  await keyboardFile('office-signature-upload');
  await page.getByRole('alert').filter({ hasText: 'Die Unterschrift kann nicht angezeigt werden.' }).waitFor();
  await keyboardFile('office-signature-upload');
  await localSignature();
  // Image decode errors also release the failed local URL immediately.
  await keyboardFile('office-signature-upload', { name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') });
  await page.getByRole('alert').filter({ hasText: 'Die Unterschrift kann nicht angezeigt werden.' }).waitFor();
  await allURLsReleased();
  await page.getByRole('button', { name: 'Unterschrift entfernen', exact: true }).click();
  await page.getByText('Keine Unterschrift hochgeladen', { exact: true }).waitFor();
  await keyboardFile('office-signature-upload');
  await localSignature();
  await page.setViewportSize({ width: 320, height: 800 });
  await shot('documents-mobile');
  // Unmount with an unsaved preview, as happens when leaving the settings page.
  await page.getByRole('navigation', { name: 'Prüfansichten' }).getByRole('button', { name: 'coordinates', exact: true }).click();
  await allURLsReleased();

  await page.getByRole('button', { name: 'Koordinaten verwenden', exact: true }).click();
  await page.getByText('Bitte geben Sie ein vollständiges gültiges Koordinatenpaar ein (Breite −90 bis 90, Länge −180 bis 180).', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Gespeicherte Position').textContent(), '{"lat":null,"lng":null}');
  assert.equal(await page.getByRole('button', { name: 'Diese Pin-Position verwenden', exact: true }).isDisabled(), true);
  await page.getByLabel('Breitengrad', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Koordinaten verwenden', exact: true }).click();
  assert.equal(await page.getByLabel('Gespeicherte Position').textContent(), '{"lat":null,"lng":null}');
  await page.getByLabel('Längengrad', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Koordinaten verwenden', exact: true }).click();
  await page.getByRole('button', { name: 'Diese Pin-Position verwenden', exact: true }).click();
  assert.equal(await page.getByLabel('Gespeicherte Position').textContent(), '{"lat":0,"lng":0}');
  await shot('coordinates-mobile');

  await page.goto(`${base}/?view=setup`);
  await page.getByLabel('Bezeichnung des Schulamts', { exact: true }).fill('Schulamt Beispiel');
  await page.getByLabel('Login-E-Mail', { exact: true }).fill('example@example.invalid');
  await page.getByLabel('Passwort', { exact: true }).fill('Example-password-2026!');
  await page.getByLabel('Ort für Schreiben', { exact: true }).fill('Beispielstadt');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await keyboardFile('setup-logo');
  await keyboardFile('setup-signature');
  assert.equal(await page.getByText('Ausgewählt: signature.png', { exact: true }).count(), 2);
  await page.getByRole('button', { name: 'Unterschrift entfernen', exact: true }).click();
  await keyboardFile('setup-signature');
  assert.equal(await page.getByText('Ausgewählt: signature.png', { exact: true }).count(), 2, 'The same file can be selected after resetting');
  await shot('setup-uploads-mobile');

  for (const dark of [false, true]) {
    await page.goto(`${base}/?view=login${dark ? '&dark' : ''}`);
    await page.getByLabel('E-Mail-Adresse', { exact: true }).fill('example@example.invalid');
    await page.getByLabel('Passwort', { exact: true }).fill('Example password');
    const contrasts = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((n, index) => index === 3 ? n / 255 : n); };
      const over = (fg, bg) => fg.slice(0, 3).map((n, index) => n * fg[3] + bg[index] * (1 - fg[3]));
      const background = element => {
        const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
        return ancestors.reduce((bg, node) => over(rgba(getComputedStyle(node).backgroundColor), bg), [255, 255, 255]);
      };
      const luminance = rgb => rgb.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4).reduce((sum, n, index) => sum + n * [0.2126, 0.7152, 0.0722][index], 0);
      return ['#login-email', '#login-password', 'label[for="login-email"]', 'label[for="login-password"]'].map(selector => {
        const element = document.querySelector(selector); const bg = background(element);
        const text = over(rgba(getComputedStyle(element).color), bg);
        const [min, max] = [luminance(bg), luminance(text)].sort((a, b) => a - b);
        return { selector, ratio: (max + 0.05) / (min + 0.05) };
      });
    });
    for (const entry of contrasts) assert.ok(entry.ratio >= 4.5, `${dark ? 'Dark' : 'Light'} login ${entry.selector}: contrast ${entry.ratio.toFixed(2)}`);
    await shot(`login-${dark ? 'dark' : 'light'}-mobile`);
  }

  await page.goto(`${base}/?view=assignments`);
  const blocks = page.locator('[aria-label="Vertretungsblöcke"] > div');
  assert.match(await blocks.nth(0).textContent(), /Grundschule.*Jahrgangsstufe3.*FachDeutsch/);
  assert.match(await blocks.nth(1).textContent(), /Fachlehrkraft M\/T.*Jahrgangsstufe8.*FachTechnik/);
  await shot('assignment-blocks-mobile');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log('UI review fixes passed: coordinate validation, protected/local signature lifecycle, keyboard uploads, dark/light login contrast and per-block teaching details.');
} catch (error) {
  console.error('UI review fixture requests:', await page.evaluate(() => window.__uiReview?.requests));
  console.error('Visible content:', (await page.locator('body').innerText()).slice(0, 8000));
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: false }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
