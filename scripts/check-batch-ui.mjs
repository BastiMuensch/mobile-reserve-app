/**
 * Browser contract check for Idealbesetzung. It authenticates only against the
 * existing synthetic loopback fixture, while every planning POST is fulfilled
 * in-browser: the script cannot persist an assignment or cause an email.
 *
 * Run with:
 * PLAYWRIGHT_MODULE=/.../playwright/index.mjs node scripts/check-batch-ui.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to the local Playwright index.mjs path.');
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3117';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Batch UI QA requires a loopback origin.');
const { chromium } = await import(pathToFileURL(modulePath).href);

let schoolYear = '';
const schoolId = '00000000-0000-4000-8000-000000000001';
const requestOne = '00000000-0000-4000-8000-000000000011';
const requestTwo = '00000000-0000-4000-8000-000000000012';
const primaryTeacher = '00000000-0000-4000-8000-000000000021';
const alternativeTeacher = '00000000-0000-4000-8000-000000000022';
const staleGate = (() => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  return { wait, release };
})();
let markFirstPreviewReceived;
const firstPreviewReceived = new Promise(resolve => { markFirstPreviewReceived = resolve; });

function previewBody(name, until) {
  return {
    schools: [{
      schoolId,
      schoolName: name,
      coverage: { filledRequests: 1, totalRequests: 1, assignedHours: 4, requiredHours: 4 },
      unfillable: [],
      proposals: [
        {
          requestId: requestOne,
          coverage: { assignedHours: 4, requiredHours: 4 }, urgency: { score: 1, reasons: ['Ungeplanter Ausfall'] },
          segments: [{ teacherId: primaryTeacher, teacherName: 'Primäre Lehrkraft', entries: [{ date: '2026-09-08', hours: 4 }], score: 100, reasons: ['Passend'], warnings: [], alternatives: [] }],
        },
      ],
    }, {
      schoolId: '00000000-0000-4000-8000-000000000002',
      schoolName: 'Zweite Testschule',
      coverage: { filledRequests: 1, totalRequests: 1, assignedHours: 4, requiredHours: 4 },
      unfillable: [],
      proposals: [
        {
          requestId: requestTwo,
          coverage: { assignedHours: 4, requiredHours: 4 }, urgency: { score: 1, reasons: ['Ungeplanter Ausfall'] },
          segments: [{ teacherId: primaryTeacher, teacherName: 'Primäre Lehrkraft', entries: [{ date: '2026-09-08', hours: 4 }], score: 90, reasons: ['Passend'], warnings: [], alternatives: [{ teacherId: alternativeTeacher, name: 'Alternative Lehrkraft', score: 80, reasons: ['Reserve'] }] }],
        },
      ],
    }],
    requestsById: {
      [requestOne]: { date: '2026-09-08T00:00:00.000Z', hours: 4, weeklyHours: 4, startHour: 1, qualifications: 'Grundschule', substitutedTeacher: 'A', status: 'PENDING' },
      [requestTwo]: { date: '2026-09-08T00:00:00.000Z', hours: 4, weeklyHours: 4, startHour: 1, qualifications: 'Grundschule', substitutedTeacher: 'B', status: 'PENDING' },
    },
    generatedAt: '2026-09-07T10:00:00.000Z', from: '2026-09-07', until, schoolYear,
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const output = path.resolve('output/ui-audit');
await mkdir(output, { recursive: true });

let approvalRequests = [];
let previewCalls = 0;
try {
  await page.goto(base);
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill('schulamt@ui-test.local');
  await page.getByLabel('Passwort', { exact: true }).fill('Ui-Test-Reserve-2026!');
  const loginResponse = page.waitForResponse(response => response.url().includes('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  const login = await loginResponse;
  assert.equal(login.status(), 200, `Synthetic login failed: ${await login.text()}`);
  await page.goto(`${base}/schulamt/idealbesetzung`);
  await page.getByRole('button', { name: 'Vorschlag berechnen', exact: true }).waitFor();
  schoolYear = await page.locator('#authority-year').inputValue();
  assert.match(schoolYear, /^\d{4}\/\d{4}$/, 'Idealbesetzung requires a selected school year');

  await page.route('**/api/batch-assign/preview', async route => {
    assert.equal(route.request().method(), 'POST');
    const payload = route.request().postDataJSON();
    assert.equal(payload.schoolYear, schoolYear);
    previewCalls += 1;
    console.log(`Batch preview route received #${previewCalls}: ${JSON.stringify(payload)}`);
    if (previewCalls === 1) {
      markFirstPreviewReceived();
      await staleGate.wait;
      try { await route.fulfill({ json: previewBody('Veraltete Testschule', payload.until) }); } catch { /* request was correctly aborted */ }
      return;
    }
    if (previewCalls === 3) {
      await route.fulfill({ status: 503, json: { error: 'Absichtlich fehlgeschlagene Vorschau' } });
      return;
    }
    await route.fulfill({ json: previewBody('Aktuelle Testschule', payload.until) });
  });

  // A former preview resolving after its date changes must never replace the
  // newer generation. The first response is intentionally delayed and aborted.
  await page.locator('#idealbesetzung-until').fill('2026-09-08');
  await page.getByRole('button', { name: 'Vorschlag berechnen', exact: true }).click();
  await firstPreviewReceived;
  await page.locator('#idealbesetzung-until').fill('2026-09-09');
  await page.getByRole('button', { name: 'Vorschlag berechnen', exact: true }).click();
  // Releasing now lets Chromium finish the aborted route while the newer
  // generation is already active. Its late result must still be ignored.
  staleGate.release();
  await page.waitForTimeout(250);
  console.log(`Batch preview probe: year=${schoolYear}, calls=${previewCalls}, computeDisabled=${await page.getByRole('button', { name: 'Vorschlag berechnen', exact: true }).isDisabled()}`);
  await page.waitForFunction(() => document.body.innerText.includes('Aktuelle Testschule'));
  await page.waitForTimeout(100);
  assert.equal(await page.getByText('Veraltete Testschule', { exact: true }).count(), 0, 'stale preview must not overwrite current plan');

  // Switching the shared school year invalidates the plan even before another
  // request is made. A failed subsequent preview must likewise leave no old
  // school card available for approval.
  const yearSelect = page.locator('#authority-year');
  const initialYear = await yearSelect.inputValue();
  const otherYear = await yearSelect.locator('option').evaluateAll((options, currentYear) => options.map(option => option.value).find(value => value !== currentYear), initialYear);
  assert.ok(otherYear, 'fixture exposes an alternate school year for reset verification');
  await yearSelect.selectOption(otherYear);
  await page.getByText('Aktuelle Testschule').waitFor({ state: 'hidden' });
  await yearSelect.selectOption(initialYear);
  await page.getByRole('button', { name: 'Vorschlag berechnen', exact: true }).click();
  await page.getByText('Absichtlich fehlgeschlagene Vorschau', { exact: true }).waitFor();
  assert.equal(await page.getByText('Aktuelle Testschule').count(), 0, 'failed preview must not retain a formerly approvable plan');
  await page.getByRole('button', { name: 'Vorschlag berechnen', exact: true }).click();
  await page.getByText('Aktuelle Testschule').waitFor();

  // The mock has two selected segments on the same teacher/day. The UI must
  // show the conflict and block approval until swapping one segment.
  await page.getByText('Doppelte Einplanung am selben Tag', { exact: true }).first().waitFor();
  const approveButtons = page.getByRole('button', { name: 'Freigeben', exact: true });
  assert.equal(await approveButtons.nth(0).isDisabled(), true, 'duplicate tentative teacher/day blocks approval');
  const swapSelect = page.getByRole('combobox').nth(1);
  await swapSelect.click();
  await page.getByRole('option', { name: /Alternative Lehrkraft/ }).click();
  await page.getByText('Freigabe blockiert: Eine Lehrkraft ist im aktuellen Entwurf mehrfach am selben Tag eingeplant.', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await approveButtons.nth(0).isDisabled(), false, 'swap clears duplicate warning and enables approval');

  // Both approval attempts are mocks. The 409 response opens an explicit
  // consent dialog; only its confirm resubmits the frozen payload with true.
  await page.route('**/api/batch-assign/approve', async route => {
    assert.equal(route.request().method(), 'POST');
    const payload = route.request().postDataJSON();
    approvalRequests.push(payload);
    if (approvalRequests.length === 1) {
      assert.equal(payload.allowOvertime, undefined, 'first approval cannot silently consent to overtime');
      await route.fulfill({ status: 409, json: { code: 'OVERTIME_CONFIRMATION_REQUIRED', error: 'Mehrarbeit bestätigen', warnings: ['Wochenlimit überschritten'] } });
    } else {
      assert.deepEqual({ ...payload, allowOvertime: undefined }, { ...approvalRequests[0], allowOvertime: undefined }, 'consent retry must keep the original school/items/window payload');
      assert.equal(payload.allowOvertime, true);
      await route.fulfill({ status: 201, json: { success: true, requests: 1, assignments: 1, warnings: ['Wochenlimit überschritten'] } });
    }
  });
  await approveButtons.nth(0).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Freigeben', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Mehrarbeit bestätigen' }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Mehrarbeit verbindlich freigeben', exact: true }).click();
  await page.getByText('Freigegeben: 1 Anforderung(en), 1 Einsätze', { exact: true }).waitFor();
  assert.equal(approvalRequests.length, 2, 'overtime protocol sends exactly one explicit retry');

  // The first school is now immutable occupancy. Switching the second school
  // back to its original teacher/day must be visibly blocked too.
  await swapSelect.click();
  await page.getByRole('option', { name: /Primäre Lehrkraft/ }).click();
  await page.getByText('Freigabe blockiert: Eine Lehrkraft ist im aktuellen Entwurf mehrfach am selben Tag eingeplant.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Freigeben', exact: true }).isDisabled(), true, 'approved occupancy blocks a later school from reusing the teacher/day');
  await swapSelect.click();
  await page.getByRole('option', { name: /Alternative Lehrkraft/ }).click();
  await page.screenshot({ path: path.join(output, 'idealbesetzung.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'idealbesetzung-mobile.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log('Batch UI regressions passed: stale preview, failed-preview/year reset, duplicate swap guard, approved occupancy, and explicit overtime consent retry.');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'idealbesetzung-failure.png'), fullPage: true, animations: 'disabled' }).catch(() => undefined);
  console.error('Batch UI diagnostic:', JSON.stringify({
    previewCalls,
    schoolYear,
    url: page.url(),
    errors,
    body: (await page.locator('body').innerText().catch(() => '')).slice(0, 6000),
  }));
  throw error;
} finally {
  await browser.close();
}
