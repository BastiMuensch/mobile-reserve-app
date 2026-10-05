import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_PRIORITIES, REQUEST_PRIORITY_OPTIONS, requestPriorityCategory, requestPriorityLabel } from '../src/lib/requestPriority';
import { createRequestSchema } from '../src/lib/requestValidation';
import { requestUrgencyScore } from '../src/lib/urgency';

const baseRequest = {
  schoolId: '123e4567-e89b-12d3-a456-426614174000',
  date: '2026-10-12', startHour: 1, hours: 3,
  substitutedTeacher: 'Alex Beispiel', status: 'PENDING',
};

test('new requests allow all four agreed reasons and reject the removed option', () => {
  const schema = createRequestSchema('2026-10-05');
  for (const priority of ALLOWED_PRIORITIES) {
    assert.equal(schema.safeParse({ ...baseRequest, priority }).success, true, priority);
  }
  assert.equal(schema.safeParse({ ...baseRequest, priority: 'SCHULINTERN' }).success, false);
  assert.equal(schema.safeParse({ ...baseRequest, priority: 'invented' }).success, false);
  assert.deepEqual(REQUEST_PRIORITY_OPTIONS.map(option => option.rank), [1, 2, 3, 4]);
});

test('equal requests are prioritized as unplanned, exemption, training, other', () => {
  const scores = ALLOWED_PRIORITIES.map(priority => requestUrgencyScore(
    { ...baseRequest, priority }, {}, { today: new Date('2026-10-05T12:00:00Z') },
  ));
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] > scores[i]);
});

test('legacy reasons stay visible in further reasons without relabelling stored history', () => {
  assert.equal(requestPriorityCategory('SCHULINTERN'), 'OTHER');
  assert.equal(requestPriorityCategory('MUTTERSCHUTZ'), 'OTHER');
  assert.equal(requestPriorityCategory('unknown-historic-value'), 'OTHER');
  assert.equal(requestPriorityCategory(null), 'UNPLANNED_ABSENCE');
  assert.equal(requestPriorityLabel('DIENSTBEFREIUNG'), 'Dienstbefreiung / Freistellung vom Dienst');
  assert.match(requestPriorityLabel('SCHULINTERN'), /früherer Grund/);
});
