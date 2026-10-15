import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { validateAndCreateAssignments, PlanningSettingsChangedError, cancelledHoursNotice } from '../src/lib/assignService';
import { getNextOpenRequestDate, getOpenRequestDays, getRequestCoverageStatus, type AssignmentForDays } from '../src/lib/requestDays';
import { buildBatchProposal, type BatchRequest, type BatchTeacher } from '../src/lib/batchMatching';
import { rankCandidates } from '../src/lib/matching';

const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
const school = { id: 'school', name: 'Schule', schulamtId: 'office', latitude: 48, longitude: 11 };
const request: BatchRequest = {
  id: 'request', schoolId: school.id, date: dates[0], endDate: dates[4],
  hours: 6, weeklyHours: 30, startHour: 1, qualifications: '', schoolType: 'GRUNDSCHULE',
  substitutedTeacher: 'Vertretung', status: 'PENDING', assignments: [],
};
const teacher: BatchTeacher = {
  id: 'teacher', name: 'Reserve', stammschuleId: school.id, status: 'ACTIVE',
  schoolYear: '2026/2027', isPartTime: true, maxWeeklyHours: 20,
  schedule: JSON.stringify(Object.fromEntries([1, 2, 3, 4, 5].map(day => [day, [1, 2, 3, 4]]))),
  qualifications: 'Alles', preferredType: 'BOTH', homeLat: 48, homeLng: 11, assignments: [],
};

function fixture(mode: boolean) {
  const rows: AssignmentForDays[] = [];
  let status = 'PENDING';
  const tx = {
    schulamtProfile: { findUnique: async (query: { where: { userId: string } }) => {
      assert.equal(query.where.userId, school.schulamtId, 'policy belongs to the request office');
      return { reserveShortageMode: mode };
    } },
    request: {
      findUnique: async () => ({ ...request, school, assignments: rows, status }),
      update: async ({ data }: { data: { status: string } }) => { status = data.status; },
    },
    teacher: { findUnique: async () => ({ ...teacher, userId: null, stammschule: school }) },
    assignment: {
      findMany: async () => [],
      createMany: async ({ data }: { data: AssignmentForDays[] }) => { rows.push(...data.map(row => ({ ...row, status: 'PENDING' }))); },
    },
    absence: { findMany: async () => [] },
    leavePeriod: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
  return { tx, rows, status: () => status };
}

for (const mode of [false, true]) {
  test(`central shortage setting ${mode}: actual hours stay at four; only assigned days may close`, async () => {
    const f = fixture(mode);
    const result = await validateAndCreateAssignments(f.tx, {
      requestId: request.id, teacherId: teacher.id, schulamtId: 'office', expectedReserveShortageMode: mode,
      entries: dates.slice(0, 3).map(date => ({ date, hours: 4 })),
    });
    assert.equal(result.warning, undefined, 'cancelled hours never cause overtime');
    assert.deepEqual(f.rows.map(row => [row.hours, row.cancelledHours]), Array(3).fill([4, mode ? 2 : 0]));
    assert.equal(f.status(), 'PARTIALLY_FILLED');
    assert.equal(getNextOpenRequestDate(request, f.rows), mode ? dates[3] : dates[0]);
    assert.deepEqual(result.cancelledHoursByDate, mode ? dates.slice(0, 3).map(date => ({ date, hours: 2 })) : []);
    f.rows[0].status = 'REJECTED';
    assert.equal(getNextOpenRequestDate(request, f.rows), dates[0]);
    assert.equal(getOpenRequestDays(request, f.rows)[0].hours, 6, 'absence reopens all six hours');
  });
}

test('settings changed after preview: no assignments or cancellations are persisted', async () => {
  const f = fixture(true);
  await assert.rejects(validateAndCreateAssignments(f.tx, {
    requestId: request.id, teacherId: teacher.id, expectedReserveShortageMode: false,
    entries: [{ date: dates[0], hours: 4 }],
  }), PlanningSettingsChangedError);
  assert.equal(f.rows.length, 0);
});

test('completed partial days stay closed independently of later setting changes; cancellation reopens them', () => {
  const assignments = dates.map(date => ({ date, hours: 4, cancelledHours: 2, status: 'ACCEPTED' }));
  assert.equal(getRequestCoverageStatus(request, assignments), 'FILLED');
  assignments[3].status = 'REJECTED';
  assert.equal(getRequestCoverageStatus({ ...request, status: 'FILLED' }, assignments), 'PARTIALLY_FILLED');
  assert.deepEqual(getOpenRequestDays(request, assignments), [{ date: dates[3], hours: 6, lessonHours: [1, 2, 3, 4, 5, 6] }]);
});

test('Monday–Friday request with Monday–Wednesday filled sorts after an open Wednesday request', () => {
  const partial = { ...request, assignments: dates.slice(0, 3).map(date => ({ date, hours: 6, status: 'ACCEPTED' })) };
  const wednesday = { ...request, id: 'wednesday', date: dates[2], endDate: dates[2], assignments: [] };
  const sorted = [partial, wednesday].sort((a, b) => getNextOpenRequestDate(a, a.assignments).localeCompare(getNextOpenRequestDate(b, b.assignments)));
  assert.deepEqual(sorted.map(row => row.id), ['wednesday', 'request']);
  assert.equal(getNextOpenRequestDate(partial, partial.assignments), dates[3]);
});

test('the next open day advances after any number of filled days and returns to the earliest gap', () => {
  for (let filled = 0; filled < dates.length; filled++) {
    const assignments = dates.slice(0, filled).map(date => ({ date, hours: 6, status: 'ACCEPTED' }));
    assert.equal(getNextOpenRequestDate(request, assignments), dates[filled], `${filled} days filled`);
  }
  const withGap = [dates[0], dates[2], dates[3]].map(date => ({ date, hours: 6, status: 'ACCEPTED' }));
  assert.equal(getNextOpenRequestDate(request, withGap), dates[1], 'Tuesday stays first even if Wednesday and Thursday are staffed');
  assert.equal(getNextOpenRequestDate(request, [{ date: dates[0], hours: 4, status: 'ACCEPTED' }]), dates[0], 'a partial day without cancelled hours remains open');
});

test('Idealbesetzung distinguishes actual hours, cancelled hours and unstaffed days', () => {
  for (const mode of [false, true]) {
    for (const endDate of [dates[2], dates[4]]) {
      const proposal = buildBatchProposal({
        reserveShortageMode: mode, today: new Date(dates[0]), until: dates[4], schoolYear: teacher.schoolYear,
        schools: [school], teachers: [{ ...teacher, schedule: JSON.stringify({ 1: [1, 2, 3, 4], 2: [1, 2, 3, 4], 3: [1, 2, 3, 4] }) }],
        requests: [{ ...request, endDate }], absences: [], leavePeriods: [],
      })[0];
      assert.equal(proposal.coverage.assignedHours, 12);
      assert.equal(proposal.coverage.cancelledHours ?? 0, mode ? 6 : 0);
      assert.equal(proposal.coverage.filledRequests, mode && endDate === dates[2] ? 1 : 0);
      assert.deepEqual(proposal.proposals[0].segments.flatMap(segment => segment.entries.map(entry => entry.date)), dates.slice(0, 3));
    }
  }
});

test('manual candidates may use non-working days but never absences, leave or booked days', () => {
  const reserves = [{ ...teacher, assignments: [{ date: new Date(dates[2]), hours: 1, status: 'ACCEPTED' }], schedule: JSON.stringify({ 1: [1, 2, 3, 4] }) }] as Parameters<typeof rankCandidates>[2];
  const args: Parameters<typeof rankCandidates> = [
    request as unknown as Parameters<typeof rankCandidates>[0], school as Parameters<typeof rankCandidates>[1], reserves,
    [{ teacherId: teacher.id, date: new Date(dates[0]) }],
    [{ teacherId: teacher.id, startDate: new Date(dates[3]), endDate: new Date(dates[3]) }], dates,
  ];
  assert.equal(rankCandidates(...args).length, 0, 'sole regular working day is sick');
  args[6] = { includeTimetableExceptions: true };
  const manual = rankCandidates(...args);
  assert.deepEqual(manual[0].eligibleDateKeys, [dates[1], dates[4]]);
  assert.deepEqual(manual[0].availableHoursByDate, { [dates[1]]: 0, [dates[4]]: 0 });
});

test('school notification explicitly explains the cancelled hours and their dates', () => {
  assert.equal(cancelledHoursNotice([]), '');
  const notice = cancelledHoursNotice([{ date: dates[0], hours: 2 }]);
  assert.match(notice, /12\.10\.2026: 2 Stunde\(n\) abgesagt/);
  assert.match(notice, /Weitere unbesetzte Tage der Anfrage bleiben offen/);
});
