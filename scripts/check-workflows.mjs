// Real HTTP regression checks. Requires scripts/seed-ui-test.ts fixtures on :3101.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3101';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Workflow tests require a loopback origin');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', locale: 'de-DE' });
// Exercise the browser's real cookie behavior, including Secure cookies on the
// trusted loopback origin. Playwright's separate HTTP client deliberately does
// not treat plain HTTP loopback like Chromium and would lose production login.
const transportPage = await context.newPage();
await transportPage.goto(base);
// Do not blindly post even synthetic credentials if another app owns the port.
await transportPage.getByLabel('E-Mail-Adresse', { exact: true }).waitFor();
await transportPage.getByLabel('Passwort', { exact: true }).waitFor();
const api = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, async (url, options = {}) => {
  const result = await transportPage.evaluate(async ({ url, method, data }) => {
    const response = await fetch(url, {
      method: method.toUpperCase(), credentials: 'same-origin',
      ...(data !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, body: await response.text() };
  }, { url, method, data: options.data });
  return { status: () => result.status, text: async () => result.body, json: async () => JSON.parse(result.body) };
}]));
async function login(email) {
  const response = await api.post(`${base}/api/auth/login`, { data: { email, password: 'Ui-Test-Reserve-2026!' } });
  assert.equal(response.status(), 200, await response.text());
}
try {
  await login('schulamt@ui-test.local');
  const teachers = await (await api.get(`${base}/api/teachers`)).json();
  const teacher = teachers.find(item => item.email === 'reserve2@ui-test.local');
  assert.ok(teacher);
  assert.equal((await api.patch(`${base}/api/teachers/${teacher.id}`, { data: { status: 'UNAVAILABLE' } })).status(), 200);
  const { status: _status, ...edit } = teacher;
  const updated = await api.patch(`${base}/api/teachers/${teacher.id}`, { data: { ...edit, password: '', phone: '089 000000' } });
  assert.equal(updated.status(), 200, await updated.text());
  assert.equal((await updated.json()).status, 'UNAVAILABLE', 'Ordinary edit must not reactivate teacher');
  assert.equal((await api.patch(`${base}/api/teachers/${teacher.id}`, { data: { status: 'ACTIVE' } })).status(), 200);
  const leaveResponse = await api.get(`${base}/api/teachers/leave?teacherId=${teacher.id}`);
  assert.equal(leaveResponse.status(), 200);
  const existingLeaves = await leaveResponse.json();
  const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + 7);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (date.getDay() !== 0 && date.getDay() !== 6 && !existingLeaves.some(leave => {
      const start = new Date(leave.startDate); start.setHours(0, 0, 0, 0);
      const end = leave.endDate ? new Date(leave.endDate) : null; end?.setHours(0, 0, 0, 0);
      return date >= start && (!end || date <= end);
    })) break;
    date.setDate(date.getDate() + 1);
    assert.ok(attempt < 89, 'No free fixture day within the next 90 days');
  }

  const page = await context.newPage();
  await page.goto(`${base}/schulamt/reserven`);
  await page.getByRole('button', { name: 'Aktionen für Lukas Muster', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bearbeiten', exact: true }).click();
  await page.getByLabel('Telefonnummer', { exact: true }).fill('089 000001');
  const saveResponse = page.waitForResponse(response => response.url().endsWith(`/api/teachers/${teacher.id}`) && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: /speichern/i }).click();
  const saved = await saveResponse;
  assert.equal(saved.status(), 200, `Edit dialog must save without a new password: ${await saved.text()}`);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });

  const invitationResponse = await api.post(`${base}/api/teacher-invitations`, { data: { recipientEmail: `registration-${randomUUID()}@ui-test.local`, validityDays: 2 } });
  assert.equal(invitationResponse.status(), 201, await invitationResponse.text());
  const invitation = await invitationResponse.json();
  const token = new URL(invitation.registrationLink).searchParams.get('token');
  const registration = await (await api.get(`${base}/api/setup/register-teacher?token=${encodeURIComponent(token)}`)).json();
  assert.equal(registration.recipientEmail, invitation.invitation.recipientEmail);
  await page.goto(invitation.registrationLink);
  assert.equal(await page.getByLabel('Dienstliche E-Mail-Adresse', { exact: true }).inputValue(), invitation.invitation.recipientEmail);
  assert.equal(await page.getByLabel('Dienstliche E-Mail-Adresse', { exact: true }).getAttribute('readonly'), '');
  await page.route('**/api/geocode/postal-code**', route => route.fulfill({ status: 503, json: { error: 'UI-Test: Geocoding unavailable' } }));
  await page.getByLabel('Postleitzahl (für ungefähre Kartenposition)', { exact: true }).fill('80331');
  await page.getByLabel('Breitengrad', { exact: true }).fill('48,14');
  await page.getByLabel('Längengrad', { exact: true }).fill('11,57');
  await page.getByRole('button', { name: 'Koordinaten verwenden', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Diese Pin-Position verwenden', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByText(/bestätigt/i).first().waitFor();

  // Actual HTTP idempotency: concurrent retries, altered-payload conflict, and a fresh legitimate demand.
  await login('schule1@ui-test.local');
  const me = await (await api.get(`${base}/api/auth/me`)).json();
  const day = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const attempt = { schoolId: me.user.schoolId, date: day, startHour: 1, hours: 2, substitutedTeacher: 'HTTP Test', comments: 'Nur Test: 8 Uhr, Parkplatz', idempotencyKey: randomUUID() };
  const pair = await Promise.all([api.post(`${base}/api/requests`, { data: attempt }), api.post(`${base}/api/requests`, { data: attempt })]);
  assert.deepEqual(pair.map(response => response.status()).sort(), [200, 201]);
  const pairBodies = await Promise.all(pair.map(response => response.json()));
  assert.equal(pairBodies[0].id, pairBodies[1].id);
  assert.equal((await api.post(`${base}/api/requests`, { data: { ...attempt, hours: 3 } })).status(), 409);
  const fresh = await api.post(`${base}/api/requests`, { data: { ...attempt, idempotencyKey: randomUUID() } });
  assert.equal(fresh.status(), 201);
  const demand = await fresh.json();

  // An assignment that arrives after leave preview must not be silently canceled.
  await login('schulamt@ui-test.local');
  const leaveData = { teacherId: teacher.id, startDate: day, endDate: day };
  const preview = await (await api.post(`${base}/api/teachers/leave/preview`, { data: leaveData })).json();
  const assignment = await api.post(`${base}/api/assign`, { data: { requestId: demand.id, teacherId: teacher.id, assignments: [{ date: day, hours: 2 }] } });
  assert.equal(assignment.status(), 201, await assignment.text());
  const staleLeave = await api.post(`${base}/api/teachers/leave`, { data: { ...leaveData, previewToken: preview.previewToken } });
  assert.equal(staleLeave.status(), 409, await staleLeave.text());
  const refreshed = await (await api.post(`${base}/api/teachers/leave/preview`, { data: leaveData })).json();
  assert.equal(refreshed.cancelledAssignments, preview.cancelledAssignments + 1);
  const confirmedLeave = await api.post(`${base}/api/teachers/leave`, { data: { ...leaveData, previewToken: refreshed.previewToken } });
  assert.equal(confirmedLeave.status(), 201, await confirmedLeave.text());
  const leaveResult = await confirmedLeave.json();
  assert.equal(leaveResult.cancelledAssignments, refreshed.cancelledAssignments);
  const leaveUrl = `${base}/api/teachers/leave/${leaveResult.leave.id}`;
  assert.equal((await api.patch(leaveUrl, { data: leaveData })).status(), 400, 'Editing also requires a preview');
  assert.equal((await api.patch(leaveUrl, { data: { ...leaveData, previewToken: '0'.repeat(64) } })).status(), 409);
  const editPreview = await (await api.post(`${base}/api/teachers/leave/preview`, { data: leaveData })).json();
  const editedLeave = await api.patch(leaveUrl, { data: { ...leaveData, previewToken: editPreview.previewToken } });
  assert.equal(editedLeave.status(), 200, await editedLeave.text());
  assert.equal((await api.delete(leaveUrl)).status(), 200, 'Remove only the leave created in this test');

  // Ending an open demand cancels future assignments, including their mail intents.
  await login('schule1@ui-test.local');
  const openResponse = await api.post(`${base}/api/requests`, { data: {
    ...attempt, idempotencyKey: randomUUID(), isOpenEnded: true, weeklyHours: 10,
    schedule: { '1': [1, 2], '2': [1, 2], '3': [1, 2], '4': [1, 2], '5': [1, 2] },
  } });
  assert.equal(openResponse.status(), 201, await openResponse.text());
  const openRequest = await openResponse.json();
  const later = new Date(date); later.setDate(later.getDate() + 1);
  while (later.getDay() === 0 || later.getDay() === 6) later.setDate(later.getDate() + 1);
  const laterDay = `${later.getFullYear()}-${String(later.getMonth()+1).padStart(2,'0')}-${String(later.getDate()).padStart(2,'0')}`;
  await login('schulamt@ui-test.local');
  const laterAssignment = await api.post(`${base}/api/assign`, { data: {
    requestId: openRequest.id, teacherId: teacher.id, assignments: [{ date: laterDay, hours: 2 }],
  } });
  assert.equal(laterAssignment.status(), 201, await laterAssignment.text());
  const endUrl = `${base}/api/requests/${openRequest.id}/end`;
  const ended = await api.patch(endUrl, { data: { lastDay: day } });
  assert.equal(ended.status(), 200, await ended.text());
  assert.equal((await ended.json()).cancelledAssignments, 1);
  assert.equal((await api.patch(endUrl, { data: { lastDay: day } })).status(), 409);
  console.log('HTTP and browser workflow regressions passed (synthetic database only).');
} finally { await browser.close(); }
