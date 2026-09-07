// Real anonymous browser flows, using only explicitly selected local test data.
// Creates one synthetic invitation/account, then removes only those exact rows.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3118';
const dbUrl = new URL(process.env.TEST_DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
assert.ok(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
assert.match(dbUrl.pathname, /(?:_|-)test(?:_|-|$)/i);
const db = new PrismaClient({ datasourceUrl: dbUrl.href });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch();
const email = `public-auth-${randomUUID()}@ui-test.local`;
const password = 'Synthetic-Initial-2026!';
const resetPassword = 'Synthetic-Changed-2026!';
const invitationIds = [];
const errors = [];
async function pageIn(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__testAuthInvalidations = 0;
    window.addEventListener('auth-invalidated', () => window.__testAuthInvalidations += 1);
  });
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
async function anonymousVisit(page, route) {
  const auth = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/me');
  await page.goto(`${base}${route}`);
  assert.equal((await auth).status(), 401, 'Real anonymous auth, no mocks');
  await page.waitForFunction(() => window.__testAuthInvalidations > 0);
  assert.equal(new URL(page.url()).pathname, route.split('?')[0]);
  assert.equal(new URL(page.url()).search, new URL(`${base}${route}`).search);
}
try {
  const office = await db.user.findUnique({ where: { email: 'schulamt@ui-test.local' }, include: { schulamtProfile: true, schoolsManaged: true } });
  assert.equal(office?.schulamtProfile?.mailProvider, 'NONE', 'No external mail may be sent');
  assert.ok(office.schoolsManaged.length);
  const officeContext = await browser.newContext();
  const login = await officeContext.request.post(`${base}/api/auth/login`, { data: { email: office.email, password: 'Ui-Test-Reserve-2026!' } });
  assert.equal(login.status(), 200);
  const me = await (await officeContext.request.get(`${base}/api/auth/me`)).json();
  assert.equal(me.user.id, office.id, 'HTTP server must use the selected test database');
  const issued = await officeContext.request.post(`${base}/api/teacher-invitations`, { data: { recipientEmail: email, validityDays: 1 } });
  assert.equal(issued.status(), 201);
  const invitation = await issued.json();
  invitationIds.push(invitation.invitation.id);
  assert.equal(invitation.mailSent, false);
  const token = new URL(invitation.registrationLink).searchParams.get('token');
  const registrationPath = `/register/teacher?token=${encodeURIComponent(token)}`;
  const context = await browser.newContext({ locale: 'de-DE' });
  const page = await pageIn(context);
  await anonymousVisit(page, registrationPath);
  assert.equal(await page.getByLabel('Dienstliche E-Mail-Adresse', { exact: true }).inputValue(), email);
  await page.getByLabel('Vor- und Nachname').fill('Anonymtest Beispiel');
  await page.getByLabel('Passwort (für den Login)', { exact: true }).fill(password);
  await page.getByLabel('Ihre feste Stammschule', { exact: true }).click();
  await page.getByRole('option', { name: office.schoolsManaged[0].name, exact: true }).click();
  await page.getByLabel('Postalische Anschrift (für Schreiben)', { exact: true }).fill('Testweg 1, 80331 Beispielstadt');
  await page.getByLabel('Postleitzahl (für ungefähre Kartenposition)', { exact: true }).fill('80331');
  // Manual coordinates avoid external geocoding; no API/auth response is mocked.
  await page.getByLabel('Breitengrad', { exact: true }).fill('48,14');
  await page.getByLabel('Längengrad', { exact: true }).fill('11,57');
  await page.getByRole('button', { name: 'Koordinaten verwenden', exact: true }).click();
  await page.getByRole('button', { name: 'Diese Pin-Position verwenden', exact: true }).click();
  await page.getByLabel('Fächer / Qualifikationen', { exact: true }).fill('Deutsch');
  const submit = page.waitForResponse(r => r.url().endsWith('/api/setup/register-teacher') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Hier registrieren', exact: true }).click();
  assert.equal((await submit).status(), 200);
  await page.getByText('Registrierung erfolgreich!', { exact: true }).waitFor();
  const account = await db.user.findUniqueOrThrow({ where: { email }, include: { teachers: true } });
  assert.equal(account.isActive, false);
  assert.equal(account.teachers[0].status, 'PENDING');
  await anonymousVisit(page, registrationPath);
  await page.getByText(/Registrierung nicht möglich/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Hier registrieren', exact: true }).isDisabled(), true, 'Consumed invitation stays unusable');
  // Exercise expiry on the same test invitation after verifying consumption.
  await db.teacherInvitation.update({ where: { id: invitation.invitation.id }, data: { completedAt: null, expiresAt: new Date(Date.now() - 60_000) } });
  await anonymousVisit(page, registrationPath);
  await page.getByText(/Registrierung nicht möglich/).waitFor();
  for (const route of ['/register/teacher', '/reset']) {
    await anonymousVisit(page, route);
    await page.getByText(/Kein gültiger/).waitFor();
  }
  const resetToken = randomBytes(32).toString('hex');
  const resetPath = `/reset?token=${resetToken}`;
  await db.passwordResetToken.create({ data: { userId: account.id, tokenHash: createHash('sha256').update(resetToken).digest('hex'), expiresAt: new Date(Date.now() + 600_000) } });
  await anonymousVisit(page, resetPath);
  await page.locator('#new-password').fill(resetPassword);
  await page.locator('#confirm-password').fill(resetPassword);
  const reset = page.waitForResponse(r => r.url().endsWith('/api/auth/reset/confirm'));
  await page.getByRole('button', { name: 'Passwort speichern', exact: true }).click();
  assert.equal((await reset).status(), 200);
  await page.getByText('Ihr Passwort wurde erfolgreich geändert.', { exact: true }).waitFor();
  const changed = await db.user.findUniqueOrThrow({ where: { id: account.id } });
  assert.ok(await bcrypt.compare(resetPassword, changed.password));
  assert.equal(changed.sessionVersion, account.sessionVersion + 1);
  assert.equal(changed.isActive, false, 'Reset cannot bypass the approval waiting room');
  await anonymousVisit(page, resetPath);
  await page.locator('#new-password').fill(resetPassword);
  await page.locator('#confirm-password').fill(resetPassword);
  const replay = page.waitForResponse(r => r.url().endsWith('/api/auth/reset/confirm'));
  await page.getByRole('button', { name: 'Passwort speichern', exact: true }).click();
  assert.equal((await replay).status(), 400);
  await page.getByText(/Der Link ist ungültig oder abgelaufen/).waitFor();
  assert.equal(new URL(page.url()).pathname, '/reset');
  // Simulate an expired session in an already mounted protected dashboard.
  const officePage = await pageIn(officeContext);
  await officePage.goto(`${base}/schulamt/reserven`);
  await officePage.getByRole('heading', { name: 'Mobile Reserven', exact: true }).waitFor();
  await officePage.getByRole('button', { name: 'Aktionen für Anna Beispiel', exact: true }).waitFor();
  const unauthorized = officePage.waitForResponse(r => r.status() === 401);
  await officeContext.clearCookies();
  // Dispatch the normal refresh signal: polling may already detect expiry and
  // remove the refresh button before Playwright can click it.
  await officePage.evaluate(() => window.dispatchEvent(new Event('app-refresh')));
  await unauthorized;
  await officePage.waitForURL(`${base}/`);
  await officePage.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
  for (const route of ['/schulamt/reserven', '/schule/profil', '/lehrkraft/profil']) {
    await page.goto(`${base}${route}`);
    await page.waitForURL(`${base}/`);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
  }
  for (const route of ['/api/teachers', '/api/schools', '/api/backup/export']) {
    assert.equal((await context.request.get(`${base}${route}`)).status(), 401);
  }
  assert.deepEqual(errors, []);
  console.log('Real anonymous registration/reset, token retention, consumed/expired invitation, reset replay, pending-account protection and protected-page/API 401 checks passed.');
} finally {
  await browser.close();
  // The UUID address is unique to this run; never modify existing fixture users.
  const created = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (created) {
    await db.teacher.deleteMany({ where: { userId: created.id } });
    await db.user.delete({ where: { id: created.id } });
  }
  for (const id of invitationIds) await db.teacherInvitation.delete({ where: { id } });
  await db.$disconnect();
}
