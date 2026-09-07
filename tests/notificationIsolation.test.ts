import test from 'node:test';
import assert from 'node:assert/strict';
import { runIndependentNotificationTasks } from '../src/lib/assignService';

test('a failed recipient does not suppress notifications for later recipients', async () => {
  const attempted: string[] = [];
  const warnings = await runIndependentNotificationTasks([
    async () => {
      attempted.push('teacher');
      throw new Error('SMTP unavailable');
    },
    async () => {
      attempted.push('school');
      return null;
    },
  ], () => {});

  assert.deepEqual(attempted, ['teacher', 'school']);
  assert.equal(warnings.length, 1);
});
