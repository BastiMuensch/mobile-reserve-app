import test from 'node:test';
import assert from 'node:assert/strict';
import { getOpenRequestDays, type RequestForDays, type AssignmentForDays } from '../src/lib/requestDays';
import { recalculateRequestStatus } from '../src/lib/leaveService';
import type { Prisma } from '@prisma/client';

type RecalculationRequest = RequestForDays & {
  status: string;
  assignments: AssignmentForDays[];
};

async function calculatePersistedStatus(request: RecalculationRequest): Promise<string | null> {
  let persistedStatus: string | null = null;
  const tx = {
    request: {
      findUnique: async () => request,
      update: async ({ data }: { data: { status: string } }) => {
        persistedStatus = data.status;
        return request;
      },
    },
  } as unknown as Prisma.TransactionClient;

  await recalculateRequestStatus(tx, 'request-id');
  return persistedStatus;
}

test('Single day request: open days and fulfillment', () => {
  const req: RequestForDays = {
    date: new Date('2026-05-04T00:00:00.000Z'), // Monday
    endDate: new Date('2026-05-04T00:00:00.000Z'),
    hours: 4,
    schedule: null,
    isOpenEnded: false,
    endedAt: null,
  };

  // 0 assignments: 1 open day with 4 hours
  const openDaysNone = getOpenRequestDays(req, []);
  assert.equal(openDaysNone.length, 1);
  assert.equal(openDaysNone[0].date, '2026-05-04');
  assert.equal(openDaysNone[0].hours, 4);

  // Rejected assignment does not fill the day
  const rejectedAssign: AssignmentForDays = {
    date: new Date('2026-05-04T00:00:00.000Z'),
    hours: 4,
    status: 'REJECTED',
  };
  const openDaysRejected = getOpenRequestDays(req, [rejectedAssign]);
  assert.equal(openDaysRejected.length, 1);
  assert.equal(openDaysRejected[0].hours, 4);

  // Partial assignment: 2 of 4 hours
  const partialAssign: AssignmentForDays = {
    date: new Date('2026-05-04T00:00:00.000Z'),
    hours: 2,
    status: 'ACTIVE',
  };
  const openDaysPartial = getOpenRequestDays(req, [partialAssign]);
  assert.equal(openDaysPartial.length, 1);
  assert.equal(openDaysPartial[0].hours, 2);

  // Fully assigned: 4 hours
  const fullAssign: AssignmentForDays = {
    date: new Date('2026-05-04T00:00:00.000Z'),
    hours: 4,
    status: 'ACTIVE',
  };
  const openDaysFull = getOpenRequestDays(req, [fullAssign]);
  assert.equal(openDaysFull.length, 0);
});

test('Multi-week fixed request: weekdays generated, weekends excluded', () => {
  // Monday 2026-05-04 to Friday 2026-05-15 (2 weeks = 10 school days, 12 calendar days)
  const req: RequestForDays = {
    date: new Date('2026-05-04T00:00:00.000Z'),
    endDate: new Date('2026-05-15T00:00:00.000Z'),
    hours: 5,
    schedule: null,
    isOpenEnded: false,
    endedAt: null,
  };

  const openDays = getOpenRequestDays(req, []);
  assert.equal(openDays.length, 10);
  assert.equal(openDays[0].date, '2026-05-04');
  assert.equal(openDays[9].date, '2026-05-15');

  // Assign first week (5 days)
  const firstWeekAssignments: AssignmentForDays[] = [
    { date: '2026-05-04', hours: 5, status: 'ACTIVE' },
    { date: '2026-05-05', hours: 5, status: 'CONFIRMED' },
    { date: '2026-05-06', hours: 5, status: 'ACTIVE' },
    { date: '2026-05-07', hours: 5, status: 'ACTIVE' },
    { date: '2026-05-08', hours: 5, status: 'ACTIVE' },
  ];
  const partiallyFilled = getOpenRequestDays(req, firstWeekAssignments);
  assert.equal(partiallyFilled.length, 5);
  assert.equal(partiallyFilled[0].date, '2026-05-11'); // Next Monday
  assert.equal(partiallyFilled[4].date, '2026-05-15');

  // Assign remaining 5 days
  const allAssignments: AssignmentForDays[] = [
    ...firstWeekAssignments,
    { date: '2026-05-11', hours: 5, status: 'ACTIVE' },
    { date: '2026-05-12', hours: 5, status: 'ACTIVE' },
    { date: '2026-05-13', hours: 5, status: 'ACTIVE' },
    { date: '2026-05-14', hours: 5, status: 'ACTIVE' },
    { date: '2026-05-15', hours: 5, status: 'ACTIVE' },
  ];
  const fullyFilled = getOpenRequestDays(req, allAssignments);
  assert.equal(fullyFilled.length, 0);
});

test('Open-ended request with schedule and horizon', () => {
  // Monday 2026-05-04 with schedule: Monday (1): 4h, Wednesday (3): 2h
  const req: RequestForDays = {
    date: new Date('2026-05-04T00:00:00.000Z'),
    endDate: null,
    hours: 4,
    schedule: JSON.stringify({ '1': [1, 2, 3, 4], '3': [1, 2] }),
    isOpenEnded: true,
    endedAt: null,
  };

  const openDays = getOpenRequestDays(req, [], new Date('2026-05-04T00:00:00.000Z'));
  assert.ok(openDays.length > 0);
  // All open days must be either Mondays (1) with 4h or Wednesdays (3) with 2h
  for (const day of openDays) {
    const dayOfWeek = new Date(day.date).getUTCDay();
    if (dayOfWeek === 1) {
      assert.equal(day.hours, 4);
    } else if (dayOfWeek === 3) {
      assert.equal(day.hours, 2);
    } else {
      assert.fail(`Unexpected day of week: ${dayOfWeek}`);
    }
  }
});

test('Early ended request cuts off open days at endedAt', () => {
  const req: RequestForDays = {
    date: new Date('2026-05-04T00:00:00.000Z'),
    endDate: new Date('2026-05-29T00:00:00.000Z'), // 4 weeks
    hours: 5,
    schedule: null,
    isOpenEnded: false,
    endedAt: new Date('2026-05-08T00:00:00.000Z'), // returned after 1 week
  };

  const openDays = getOpenRequestDays(req, []);
  assert.equal(openDays.length, 5); // Only 1 week (5 school days)
  assert.equal(openDays[4].date, '2026-05-08');
});

test('recalculateRequestStatus persists PENDING, PARTIALLY_FILLED and FILLED from real day coverage', async () => {
  const base = {
    date: new Date('2026-05-04T00:00:00.000Z'),
    endDate: new Date('2026-05-04T00:00:00.000Z'),
    hours: 4,
    schedule: null,
    isOpenEnded: false,
    endedAt: null,
    status: 'PENDING',
  };

  assert.equal(await calculatePersistedStatus({ ...base, assignments: [] }), 'PENDING');
  assert.equal(await calculatePersistedStatus({
    ...base,
    assignments: [{ date: base.date, hours: 2, status: 'ACTIVE' }],
  }), 'PARTIALLY_FILLED');
  assert.equal(await calculatePersistedStatus({
    ...base,
    assignments: [{ date: base.date, hours: 4, status: 'ACTIVE' }],
  }), 'FILLED');
});

test('recalculateRequestStatus never marks a still open-ended request as FILLED', async () => {
  const date = new Date('2026-05-04T00:00:00.000Z');
  const status = await calculatePersistedStatus({
    date,
    endDate: null,
    hours: 4,
    schedule: JSON.stringify({ '1': [1, 2, 3, 4] }),
    isOpenEnded: true,
    endedAt: null,
    status: 'PENDING',
    assignments: [{ date, hours: 4, status: 'ACTIVE' }],
  });
  assert.equal(status, 'PARTIALLY_FILLED');
});

test('recalculateRequestStatus preserves an explicitly UNFILLED request', async () => {
  const status = await calculatePersistedStatus({
    date: new Date('2026-05-04T00:00:00.000Z'),
    endDate: null,
    hours: 4,
    schedule: null,
    isOpenEnded: false,
    endedAt: null,
    status: 'UNFILLED',
    assignments: [],
  });
  assert.equal(status, null);
});
