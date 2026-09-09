import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3120';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const folder = path.resolve('output/demo-sonnenhain-2026-09-14');
const seed = JSON.parse(await readFile(path.join(folder, 'demo-seed.json')));
const markdown = await readFile(path.join(folder, 'ZUGANGSDATEN.md'), 'utf8');
const credentials = markdown.split('\n').filter(line => line.includes('@sonnenhain.example')).map(line => {
  const fields = line.split('|').map(field => field.trim());
  return { email: fields[3], password: fields[4] };
});
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir(path.join(folder, 'screenshots'), { recursive: true });
try {
  await page.goto(base);
  for (const credentialsForUser of credentials.filter(row => !['schulamt@sonnenhain.example', 'schule1@sonnenhain.example', 'reserve4@sonnenhain.example'].includes(row.email))) {
    const status = await page.evaluate(async data => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).status, credentialsForUser);
    assert.equal(status, credentialsForUser.email.startsWith('reserve11@') ? 401 : 200, credentialsForUser.email);
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  }
  for (const email of ['schulamt@sonnenhain.example', 'schule1@sonnenhain.example', 'reserve4@sonnenhain.example']) {
    await page.goto(base);
    const account = credentials.find(row => row.email === email);
    await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
    await page.getByLabel('Passwort', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page.getByRole('button', { name: 'Abmelden', exact: true }).filter({ visible: true }).waitFor();
    await page.getByRole('heading', { level: 1 }).waitFor();
    if (email.startsWith('reserve')) {
      const blocked = await page.evaluate(async () => {
        const key = await fetch('/api/push/vapidPublicKey');
        const sub = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        return [key.status, sub.status];
      });
      assert.deepEqual(blocked, [403, 403]);
      await page.getByRole('list', { name: 'Einsatznachweise' }).waitFor();
      const assignment = seed.data.assignment.find(a => a.teacherId === seed.data.teacher[3].id);
      const proof = await page.evaluate(async id => {
        const response = await fetch(`/api/assignments/${id}/pdf`);
        return { status: response.status, type: response.headers.get('content-type'), prefix: (await response.text()).slice(0, 5) };
      }, assignment.id);
      assert.deepEqual(proof, { status: 200, type: 'application/pdf', prefix: '%PDF-' });
    }
    const name = email.split('@')[0];
    await page.screenshot({ path: path.join(folder, 'screenshots', `${name}.png`), fullPage: true });
    if (name === 'schulamt') {
      const smtp = await page.evaluate(async () => (await fetch('/api/schulamt/profile/test-smtp', { method: 'POST' })).status);
      assert.equal(smtp, 409, 'SMTP test is disabled in demo mode');
      const assigned = await page.evaluate(async data => {
        const response = await fetch('/api/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        return { status: response.status, body: await response.text() };
      }, { requestId: seed.data.request[0].id, teacherId: seed.data.teacher[0].id, assignments: [{ date: seed.data.request[0].date.slice(0, 10), hours: 4 }] });
      assert.equal(assigned.status, 201, assigned.body);
      await page.goto(`${base}/schulamt/reserven`);
      await page.getByRole('button', { name: 'Aktionen für Mara Linden', exact: true }).waitFor();
      await page.screenshot({ path: path.join(folder, 'screenshots', 'reserven.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Abmelden', exact: true }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log('All 19 demo credentials verified (one intentionally pending), role dashboards, PDF and push blocking passed.');
} finally { await browser.close(); }
