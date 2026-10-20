import assert from 'node:assert/strict';
import test from 'node:test';
import { findTentativeDuplicateTeacherDays, makeApprovalPayload, makeRecalculationPayload } from '@/lib/batchPlanClient';

const schools = [{
  schoolId: 'school-a',
  proposals: [{ requestId: 'request-a', segments: [{ teacherId: 'teacher-a', entries: [{ date: '2026-09-02', hours: 2 }] }] }],
}, {
  schoolId: 'school-b',
  proposals: [{ requestId: 'request-b', segments: [{ teacherId: 'teacher-b', entries: [{ date: '2026-09-02', hours: 3 }] }] }],
}];

test('swaps that double-book a selected tentative plan mark both segments', () => {
  assert.deepEqual(
    findTentativeDuplicateTeacherDays(schools, { 'request-a': true, 'request-b': true }, { 'request-b:0': { teacherId: 'teacher-a', teacherName: 'A' } }, []),
    new Set(['request-a:0', 'request-b:0']),
  );
});

test('deselected schools do not block another school', () => {
  assert.equal(findTentativeDuplicateTeacherDays(schools, { 'request-a': true, 'request-b': false }, {}, []).size, 0);
});

test('an approved frozen payload blocks a later tentative swap on the same teacher and day', () => {
  const approved = makeApprovalPayload(schools[0], { 'request-a': true }, {}, '2026/2027', '2026-09-09');
  assert.deepEqual(
    findTentativeDuplicateTeacherDays(schools, { 'request-a': true, 'request-b': true }, { 'request-b:0': { teacherId: 'teacher-a', teacherName: 'A' } }, [approved]),
    new Set(['request-b:0']),
  );
});

test('approval payload freezes the selected effective assignments with plan parameters', () => {
  assert.deepEqual(makeApprovalPayload(schools[0], { 'request-a': true }, {}, '2026/2027', '2026-09-09'), {
    schoolId: 'school-a', schoolYear: '2026/2027', until: '2026-09-09',
    items: [{ requestId: 'request-a', segments: [{ teacherId: 'teacher-a', entries: [{ date: '2026-09-02', hours: 2 }] }] }],
  });
});

const recalculationInput = {
  schools, selected: { 'request-a': true, 'request-b': false }, swaps: {},
  approvedPayloads: [], excludedRequestIds: ['previously-deferred'],
  schoolYear: '2026/2027', until: '2026-09-09', expectedReserveShortageMode: false,
};

test('recalculation preserves effective swaps and exact days while releasing unchecked requests', () => {
  const payload = makeRecalculationPayload({
    ...recalculationInput, swaps: { 'request-a:0': { teacherId: 'teacher-c', teacherName: 'C' } },
  });
  assert.deepEqual(payload, {
    schoolYear: '2026/2027', until: '2026-09-09', expectedReserveShortageMode: false,
    retainedItems: [{ requestId: 'request-a', segments: [{ teacherId: 'teacher-c', entries: [{ date: '2026-09-02', hours: 2 }] }] }],
    excludedRequestIds: ['previously-deferred', 'request-b'],
  });
});

test('reconsidering a deferred request retains other choices and other exclusions', () => {
  const payload = makeRecalculationPayload({ ...recalculationInput, reconsiderRequestId: 'previously-deferred' });
  assert.deepEqual(payload.excludedRequestIds, ['request-b']);
  assert.equal(payload.retainedItems[0].requestId, 'request-a');
});

test('rechecking a proposal removes an earlier exclusion', () => {
  const payload = makeRecalculationPayload({ ...recalculationInput, excludedRequestIds: ['request-a', 'request-b', 'request-b'] });
  assert.deepEqual(payload.excludedRequestIds, ['request-b']);
});

test('approved assignments are not reserved twice while unchecked requests at that school remain deferred', () => {
  const mergedSchool = { schoolId: 'school-a', proposals: schools.flatMap(school => school.proposals) };
  const approved = makeApprovalPayload(mergedSchool, recalculationInput.selected, {}, '2026/2027', '2026-09-09');
  const payload = makeRecalculationPayload({
    ...recalculationInput, schools: [mergedSchool], approvedPayloads: [approved],
    excludedRequestIds: ['request-a'],
  });
  assert.deepEqual(payload.retainedItems, []);
  assert.deepEqual(payload.excludedRequestIds, ['request-b']);
});
