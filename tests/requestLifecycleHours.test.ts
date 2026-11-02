import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleEventCancelsAssignment, requestLifecyclePlan, requestLifecycleSchema } from '../src/lib/requestLifecycle';
import { canCorrectAssignmentHours, hasReportableAssignmentDay, hourCorrectionSchema, hourReviewSchema } from '../src/lib/assignmentHours';
import { formatLeaveBadge, formatLeaveRange, leaveEndDateKey } from '../src/lib/leave';

const now = new Date('2026-11-04T12:00:00Z');
const request = { date: '2026-11-02', endDate: '2026-11-06', status: 'FILLED' };
test('fixed and assigned demand can end early while already recorded past dates are protected', () => {
  const plan = requestLifecyclePlan(request, { lastDay: '2026-11-02' }, now);
  assert.equal(plan.lastDay.toISOString().slice(0, 10), '2026-11-02');
  assert.equal(plan.cancelAfter.toISOString().slice(0, 10), '2026-11-03');
  assert.equal(plan.entirelyCancelled, false);
  assert.throws(() => requestLifecyclePlan(request, { lastDay: '2026-11-07' }, now), /verlängern/);
  assert.throws(() => requestLifecyclePlan(request, { lastDay: '2026-11-01' }, now), /stornieren/);
});
test('cancel releases today and future, preserves historical demand and never extends completed requests', () => {
  const plan = requestLifecyclePlan(request, { action: 'CANCEL' }, now);
  assert.equal(plan.lastDay.toISOString().slice(0, 10), '2026-11-03');
  assert.equal(plan.entirelyCancelled, false);
  assert.equal(requestLifecyclePlan({ ...request, date: '2026-11-05' }, { action: 'CANCEL' }, now).entirelyCancelled, true);
  assert.equal(requestLifecyclePlan({ ...request, endDate: '2026-11-02' }, { action: 'CANCEL' }, now).lastDay.toISOString().slice(0, 10), '2026-11-02');
  assert.equal(requestLifecycleSchema.safeParse({ lastDay: '2026-02-30' }).success, false);
});
test('a same-day cancellation can keep today so delivered hours stay reportable', () => {
  const startsToday = { date: '2026-11-04', endDate: '2026-11-06', status: 'FILLED' };
  const kept = requestLifecyclePlan(startsToday, { action: 'CANCEL', keepToday: true }, now);
  assert.equal(kept.entirelyCancelled, false, 'the request is ended, not cancelled');
  assert.equal(kept.keptToday, true);
  assert.equal(kept.lastDay.toISOString().slice(0, 10), '2026-11-04');
  assert.equal(kept.cancelAfter.toISOString().slice(0, 10), '2026-11-04', 'only tomorrow onwards is released');
  const dropped = requestLifecyclePlan(startsToday, { action: 'CANCEL' }, now);
  assert.equal(dropped.entirelyCancelled, true);
  // keepToday is ignored for future or already finished demand.
  assert.equal(requestLifecyclePlan({ ...startsToday, date: '2026-11-05' }, { action: 'CANCEL', keepToday: true }, now).entirelyCancelled, true);
  assert.equal(requestLifecyclePlan({ ...request, endDate: '2026-11-03' }, { action: 'CANCEL', keepToday: true }, now).lastDay.toISOString().slice(0, 10), '2026-11-03');
  assert.equal(requestLifecycleSchema.safeParse({ action: 'CANCEL', keepToday: true }).success, true);
  assert.equal(requestLifecycleSchema.safeParse({ action: 'CANCEL', keepToday: 'ja' }).success, false);
});
test('hour reporting is offered only for active deployments up to today', () => {
  assert.equal(hasReportableAssignmentDay([{ date: '2026-11-05', status: 'ACCEPTED' }], now), false);
  assert.equal(hasReportableAssignmentDay([{ date: '2026-11-04', status: 'ACCEPTED' }], now), true);
  assert.equal(hasReportableAssignmentDay([{ date: '2026-11-03', status: 'PENDING' }], now), true);
  assert.equal(hasReportableAssignmentDay([{ date: '2026-11-03', status: 'REJECTED' }], now), false);
  assert.equal(hasReportableAssignmentDay(undefined, now), false);
});
test('hours are actual confirmed work, with separate minutes and reasoned office review', () => {
  assert.equal(canCorrectAssignmentHours({ date: '2026-11-04', status: 'ACCEPTED' }, now), true);
  assert.equal(canCorrectAssignmentHours({ date: '2026-11-05', status: 'ACCEPTED' }, now), false);
  assert.equal(canCorrectAssignmentHours({ date: '2026-11-04', status: 'PENDING' }, now), false);
  const input = { proposedHours: 5, reason: 'Zusätzlicher Unterricht', additionalMinutes: 30, additionalTasks: 'Materialvorbereitung' };
  assert.equal(hourCorrectionSchema.safeParse(input).success, true);
  assert.equal(hourCorrectionSchema.safeParse({ ...input, proposedHours: -1 }).success, false);
  assert.equal(hourCorrectionSchema.safeParse({ ...input, additionalTasks: '' }).success, false);
  assert.equal(hourCorrectionSchema.safeParse({ ...input, reason: ' ' }).success, false);
  assert.equal(hourReviewSchema.safeParse({ decision: 'REJECTED' }).success, false);
  assert.equal(hourReviewSchema.safeParse({ decision: 'REJECTED', reviewNote: 'Bitte Zeitraum prüfen' }).success, true);
});
test('deferred cancellation uses the original Berlin reporting day, not the later review day', () => {
  const event = { action: 'END', lastDay: new Date('2026-11-02T00:00:00Z'), createdAt: new Date('2026-11-03T23:15:00Z') };
  assert.equal(lifecycleEventCancelsAssignment(new Date('2026-11-03T00:00:00Z'), event), false, 'past work at the time of the report remains recorded');
  assert.equal(lifecycleEventCancelsAssignment(new Date('2026-11-04T00:00:00Z'), event), true);
  assert.equal(lifecycleEventCancelsAssignment(new Date('2026-11-02T00:00:00Z'), event), false);
  assert.equal(lifecycleEventCancelsAssignment(new Date('2026-11-05T00:00:00Z'), { ...event, action: 'CANCEL', lastDay: null }), true);
});
test('leave labels preserve the inclusive stored end day in every host timezone', () => {
  for (const end of ['2026-10-28T23:59:59.999Z', '2026-10-28T00:00:00.000Z', '2026-10-27T23:00:00.000Z']) {
    assert.equal(leaveEndDateKey(end), '2026-10-28');
    assert.equal(formatLeaveRange('2026-10-26T00:00:00Z', end), '26.10.2026 – 28.10.2026');
    assert.equal(formatLeaveBadge(end), 'Abwesend bis 28.10.2026');
  }
});
