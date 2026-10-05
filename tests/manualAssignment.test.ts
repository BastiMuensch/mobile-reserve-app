import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import {
  validateAndCreateAssignments, TimetableConflictError, DoubleBookingError,
  AbsenceConflictError, OnLeaveError, OnlyStammschuleError,
} from '../src/lib/assignService';
import { rankCandidates } from '../src/lib/matching';
import { buildBatchProposal, type BatchRequest, type BatchTeacher } from '../src/lib/batchMatching';

const school = { id: 'school', name: 'Testschule', latitude: 48.1, longitude: 11.5, schulamtId: 'office' };
const teacher: BatchTeacher = {
  id: 'teacher', name: 'Reserve', status: 'ACTIVE', stammschuleId: 'school',
  onlyStammschule: false, maxWeeklyHours: 25, isPartTime: true,
  schedule: JSON.stringify({ '1': [1, 2, 3, 4, 5] }), qualifications: 'Alles',
  preferredType: 'BOTH', homeLat: 48.1, homeLng: 11.5, schoolYear: '2026/2027', assignments: [],
};
const request: BatchRequest = {
  id: 'request', schoolId: 'school', date: '2026-10-05', endDate: '2026-10-06',
  hours: 5, weeklyHours: 10, startHour: 2, qualifications: '', schoolType: 'GRUNDSCHULE',
  substitutedTeacher: 'Vertretung', status: 'PENDING', assignments: [],
};

function transaction(options: { booked?: boolean; absent?: boolean; leave?: boolean; restricted?: boolean } = {}) {
  const created: { date: Date; hours: number; status: string }[] = [];
  const tx = {
    request: {
      findUnique: async () => ({ ...request, school, assignments: created }),
      update: async () => ({}),
    },
    teacher: {
      findUnique: async () => ({
        ...teacher, userId: null, stammschule: school,
        ...(options.restricted ? { onlyStammschule: true, stammschuleId: 'other' } : {}),
      }),
    },
    assignment: {
      findMany: async () => options.booked ? [{ date: new Date('2026-10-05'), hours: 3 }] : [],
      createMany: async ({ data }: { data: { date: Date; hours: number }[] }) => {
        created.push(...data.map(entry => ({ ...entry, status: 'PENDING' })));
      },
    },
    absence: { findMany: async () => options.absent ? [{ date: new Date('2026-10-05') }] : [] },
    leavePeriod: { findMany: async () => options.leave ? [{ teacherId: teacher.id, startDate: new Date('2026-10-01'), endDate: null }] : [] },
  } as unknown as Prisma.TransactionClient;
  return { tx, created };
}

for (const [date, description] of [
  ['2026-10-05', 'shifted lesson block (2–6 instead of 1–5)'],
  ['2026-10-06', 'additional Tuesday for a Monday-only reserve'],
]) {
  test(`manual assignment permits ${description} only with explicit timetable consent`, async () => {
    const { tx, created } = transaction();
    const input = { requestId: request.id, teacherId: teacher.id, entries: [{ date, hours: 5 }] };
    await assert.rejects(validateAndCreateAssignments(tx, input), TimetableConflictError);
    assert.equal(created.length, 0);
    const result = await validateAndCreateAssignments(tx, { ...input, allowTimetableOverride: true });
    assert.equal(result.createdCount, 1);
    assert.equal(created.length, 1);
    assert.equal(created[0].date.toISOString().slice(0, 10), date);
    assert.match(result.warning ?? '', /Manuelle Ausnahme/);
  });
}

test('timetable error lists every affected day before any assignment is written', async () => {
  const { tx, created } = transaction();
  await assert.rejects(validateAndCreateAssignments(tx, {
    requestId: request.id, teacherId: teacher.id,
    entries: [{ date: '2026-10-05', hours: 5 }, { date: '2026-10-06', hours: 5 }],
  }), (error: unknown) => error instanceof TimetableConflictError
    && assert.deepEqual(error.dateKeys, ['2026-10-05', '2026-10-06']) === undefined);
  assert.equal(created.length, 0);
});

for (const [option, errorClass] of [
  ['booked', DoubleBookingError], ['absent', AbsenceConflictError],
  ['leave', OnLeaveError], ['restricted', OnlyStammschuleError],
] as const) {
  test(`manual timetable consent does not bypass ${option} restrictions`, async () => {
    const { tx, created } = transaction({ [option]: true });
    await assert.rejects(validateAndCreateAssignments(tx, {
      requestId: request.id, teacherId: teacher.id,
      entries: [{ date: '2026-10-05', hours: 5 }], allowTimetableOverride: true,
    }), errorClass);
    assert.equal(created.length, 0);
  });
}

function rank(reserve: BatchTeacher, date = '2026-10-05') {
  return rankCandidates(
    { ...request, date: new Date(date), endDate: null, startHour: 4, hours: 2 } as unknown as Parameters<typeof rankCandidates>[0],
    school as Parameters<typeof rankCandidates>[1],
    [{ ...reserve, assignments: reserve.assignments?.map(entry => ({ ...entry, date: new Date(entry.date) })) ?? [] }] as Parameters<typeof rankCandidates>[2],
    [], [], [date],
  );
}

test('individual suggestions exclude reserves after a three-hour assignment despite two remaining available hours', () => {
  for (const status of ['PENDING', 'ACCEPTED', 'CONFIRMED']) {
    assert.equal(rank({ ...teacher, assignments: [{ date: '2026-10-05', hours: 3, status }] }).length, 0);
  }
  assert.equal(rank({ ...teacher, assignments: [{ date: '2026-10-05', hours: 3, status: 'REJECTED' }] }).length, 1);
  assert.equal(rank({ ...teacher, assignments: [{ date: '2026-10-06', hours: 3, status: 'ACCEPTED' }] }).length, 1);
});

test('automatic individual suggestions still respect exact lesson slots and regular weekdays', () => {
  assert.equal(rank({ ...teacher, schedule: JSON.stringify({ '1': [1, 2, 3, 4] }) }).length, 0);
  assert.equal(rank(teacher, '2026-10-06').length, 0);
  assert.equal(rank(teacher).length, 1);
});

test('a reserve booked on Monday can still be proposed for the free Tuesday of a longer request', () => {
  const candidates = rankCandidates(
    { ...request, date: new Date('2026-10-05'), endDate: new Date('2026-10-06'), startHour: 4, hours: 2 } as unknown as Parameters<typeof rankCandidates>[0],
    school as Parameters<typeof rankCandidates>[1],
    [{ ...teacher, isPartTime: false, assignments: [{ date: new Date('2026-10-05'), hours: 3, status: 'ACCEPTED' }] }] as Parameters<typeof rankCandidates>[2],
    [], [], ['2026-10-05', '2026-10-06'],
  );
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].eligibleDateKeys, ['2026-10-06']);
  assert.equal(candidates[0].hasConflict, false);
});

test('automatic batch suggestions keep a partially assigned reserve booked for the day and never move regular weekdays', () => {
  const scenarios: [BatchTeacher, string][] = [
    [{ ...teacher, assignments: [{ date: '2026-10-05', hours: 3, status: 'ACCEPTED' }] }, '2026-10-05'],
    [teacher, '2026-10-06'],
  ];
  for (const [reserve, date] of scenarios) {
    const proposals = buildBatchProposal({
      today: new Date('2026-10-05'), until: date, schoolYear: '2026/2027', schools: [school], teachers: [reserve],
      requests: [{ ...request, date, endDate: null, startHour: 4, hours: 2 }], absences: [], leavePeriods: [],
    });
    assert.equal(proposals[0].proposals.length, 0);
    assert.equal(proposals[0].unfillable.length, 1);
  }
});

test('batch planning reserves the whole day when it proposes a short first assignment', () => {
  const proposals = buildBatchProposal({
    today: new Date('2026-10-05'), until: '2026-10-05', schoolYear: '2026/2027', schools: [school], teachers: [teacher],
    requests: [
      { ...request, id: 'morning', endDate: null, startHour: 1, hours: 3 },
      { ...request, id: 'later', endDate: null, startHour: 4, hours: 2 },
    ], absences: [], leavePeriods: [],
  });
  assert.equal(proposals[0].proposals.length, 1);
  assert.equal(proposals[0].unfillable.length, 1);
});
