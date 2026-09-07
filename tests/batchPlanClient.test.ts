import assert from 'node:assert/strict';
import test from 'node:test';
import { findTentativeDuplicateTeacherDays, makeApprovalPayload } from '@/lib/batchPlanClient';

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
