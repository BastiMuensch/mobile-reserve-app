import test from 'node:test';
import assert from 'node:assert/strict';
import { processOutboxItemsSequentially } from '../src/lib/emailOutbox';

test('outbox claims each item immediately before delivery instead of pre-leasing a batch', async () => {
  const events: string[] = [];
  const result = await processOutboxItemsSequentially(
    ['first', 'second'],
    async (id) => {
      events.push(`claim:${id}`);
      return { id };
    },
    async (item) => {
      events.push(`deliver:${item.id}`);
      return item.id === 'first';
    },
  );

  assert.deepEqual(events, ['claim:first', 'deliver:first', 'claim:second', 'deliver:second']);
  assert.deepEqual(result, { processed: 2, sent: 1, failed: 1 });
});

test('outbox does not deliver an item when another worker won its conditional claim', async () => {
  const delivered: string[] = [];
  const result = await processOutboxItemsSequentially(
    ['lost-race', 'owned'],
    async (id) => id === 'lost-race' ? null : { id },
    async (item) => {
      delivered.push(item.id);
      return true;
    },
  );

  assert.deepEqual(delivered, ['owned']);
  assert.deepEqual(result, { processed: 1, sent: 1, failed: 0 });
});
