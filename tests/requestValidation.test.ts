import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestSchema, getScheduleHourTotals, parseTimetableSchedule } from '../src/lib/requestValidation';

const validUUID = '123e4567-e89b-12d3-a456-426614174000';
const CreateRequestSchema = createRequestSchema('2026-01-01');

test('CreateRequestSchema validates valid single-day request', () => {
  const input = {
    schoolId: validUUID,
    date: '2026-05-12',
    priority: 'UNPLANNED_ABSENCE',
    startHour: 1,
    hours: 4,
    substitutedTeacher: 'Max Mustermann',
    comments: 'Parken im Schulhof',
    isOpenEnded: false,
  };

  const parsed = CreateRequestSchema.safeParse(input);
  assert.equal(parsed.success, true);
});

test('CreateRequestSchema validates valid open-ended request with schedule', () => {
  const input = {
    schoolId: validUUID,
    date: '2026-05-12',
    priority: 'UNPLANNED_ABSENCE',
    startHour: 1,
    weeklyHours: 5,
    substitutedTeacher: 'Erika Musterfrau',
    comments: 'Schlüssel im Sekretariat',
    isOpenEnded: true,
    schedule: JSON.stringify({
      '1': [1, 2, 3],
      '2': [1, 2],
    }),
  };

  const parsed = CreateRequestSchema.safeParse(input);
  assert.equal(parsed.success, true);
});

test('CreateRequestSchema rejects open-ended request with non-UNPLANNED priority or with endDate', () => {
  const withFortbildung = {
    schoolId: validUUID,
    date: '2026-05-12',
    priority: 'FORTBILDUNG',
    startHour: 1,
    weeklyHours: 10,
    substitutedTeacher: 'Erika Musterfrau',
    comments: 'Fortbildung',
    isOpenEnded: true,
    schedule: JSON.stringify({ '1': [1, 2] }),
  };
  const parsed1 = CreateRequestSchema.safeParse(withFortbildung);
  assert.equal(parsed1.success, false);

  const withEndDate = {
    schoolId: validUUID,
    date: '2026-05-12',
    endDate: '2026-05-15',
    priority: 'UNPLANNED_ABSENCE',
    startHour: 1,
    weeklyHours: 10,
    substitutedTeacher: 'Erika Musterfrau',
    comments: 'Krank',
    isOpenEnded: true,
    schedule: JSON.stringify({ '1': [1, 2] }),
  };
  const parsed2 = CreateRequestSchema.safeParse(withEndDate);
  assert.equal(parsed2.success, false);
});

test('CreateRequestSchema rejects periods exceeding 400 calendar days', () => {
  const tooLong = {
    schoolId: validUUID,
    date: '2026-01-01',
    endDate: '2027-03-01', // > 400 days
    priority: 'SCHULINTERN',
    startHour: 1,
    hours: 5,
    weeklyHours: 5,
    substitutedTeacher: 'Lehrer',
    comments: 'Langzeitprojekt',
    isOpenEnded: false,
    schedule: JSON.stringify({ '1': [1, 2, 3, 4, 5] }),
  };
  const parsed = CreateRequestSchema.safeParse(tooLong);
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.match(parsed.error.issues[0].message, /überschreitet das Maximum von 400 Kalendertagen/);
  }
});

test('CreateRequestSchema rejects impossible dates like 2026-02-31', () => {
  const invalidDate = {
    schoolId: validUUID,
    date: '2026-02-31',
    priority: 'UNPLANNED_ABSENCE',
    startHour: 1,
    hours: 4,
    substitutedTeacher: 'Lehrer',
    comments: 'Test',
    isOpenEnded: false,
  };
  const parsed = CreateRequestSchema.safeParse(invalidDate);
  assert.equal(parsed.success, false);
});

test('CreateRequestSchema rejects invalid hours or duplicate schedule hours', () => {
  const duplicateHours = {
    schoolId: validUUID,
    date: '2026-05-12',
    priority: 'UNPLANNED_ABSENCE',
    startHour: 1,
    substitutedTeacher: 'Lehrer',
    comments: 'Test',
    isOpenEnded: false,
    schedule: JSON.stringify({
      '1': [1, 2, 2], // duplicate hour 2
    }),
  };
  const parsed = CreateRequestSchema.safeParse(duplicateHours);
  assert.equal(parsed.success, false);
});

test('parseTimetableSchedule parses valid schedule and rejects malformed JSON', () => {
  const valid = parseTimetableSchedule('{"1":[1,2,3],"5":[4,5]}');
  assert.deepEqual(valid, { '1': [1, 2, 3], '5': [4, 5] });

  assert.throws(() => parseTimetableSchedule('{invalid json'), /kein gültiges JSON/);
  assert.throws(() => parseTimetableSchedule('{"6":[1]}'), /Wochentage im Stundenplan/); // '6' is Saturday
});

test('CreateRequestSchema rejects a past start date on the server', () => {
  const schema = createRequestSchema('2026-05-12');
  const parsed = schema.safeParse({
    schoolId: validUUID,
    date: '2026-05-11',
    priority: 'UNPLANNED_ABSENCE',
    startHour: 1,
    hours: 4,
    substitutedTeacher: 'Lehrer',
    comments: 'Test',
    isOpenEnded: false,
  });
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.match(parsed.error.issues[0].message, /Vergangenheit/);
});

test('CreateRequestSchema rejects a schedule without a fixed or explicitly open end', () => {
  const parsed = CreateRequestSchema.safeParse({
    schoolId: validUUID,
    date: '2026-05-12',
    priority: 'UNPLANNED_ABSENCE',
    startHour: 1,
    hours: 2,
    weeklyHours: 2,
    substitutedTeacher: 'Lehrer',
    comments: 'Test',
    isOpenEnded: false,
    schedule: JSON.stringify({ '1': [1, 2] }),
  });
  assert.equal(parsed.success, false);
});

test('CreateRequestSchema rejects inconsistent hour totals and impossible lesson ranges', () => {
  const inconsistent = CreateRequestSchema.safeParse({
    schoolId: validUUID,
    date: '2026-05-12',
    endDate: '2026-05-15',
    priority: 'UNPLANNED_ABSENCE',
    startHour: 1,
    hours: 1,
    weeklyHours: 99,
    substitutedTeacher: 'Lehrer',
    comments: 'Test',
    isOpenEnded: false,
    schedule: JSON.stringify({ '1': [1, 2], '2': [3] }),
  });
  assert.equal(inconsistent.success, false);

  const impossibleRange = CreateRequestSchema.safeParse({
    schoolId: validUUID,
    date: '2026-05-12',
    priority: 'UNPLANNED_ABSENCE',
    startHour: 9,
    hours: 3,
    weeklyHours: 3,
    substitutedTeacher: 'Lehrer',
    comments: 'Test',
    isOpenEnded: false,
  });
  assert.equal(impossibleRange.success, false);
});

test('getScheduleHourTotals derives trusted daily and weekly values', () => {
  assert.deepEqual(
    getScheduleHourTotals({ '1': [1, 2, 3], '2': [1], '3': [], '4': [5, 6], '5': [] }),
    { dailyMaximum: 3, weeklyTotal: 6 }
  );
});
