import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Prisma } from '@prisma/client';
import { enqueueAssignmentEmailsInTransaction, type AssignmentEntry } from '../src/lib/assignService';
import { revealSecret } from '../src/lib/secrets';

type Mail = { to: string; body: string; attachments?: { filename: string; content: string }[] };

async function captureNotifications(
  t: TestContext, schedule: string | null, entries: AssignmentEntry[], startHour = 1,
): Promise<Mail[]> {
  const previous = { SMTP_ENCRYPTION_KEY: process.env.SMTP_ENCRYPTION_KEY, DEMO_MODE: process.env.DEMO_MODE };
  process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 37).toString('base64');
  process.env.DEMO_MODE = 'false';
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const messages: Mail[] = [];
  const tx = {
    systemSetting: { findUnique: async () => null },
    schulamtProfile: { findUnique: async () => ({ mailProvider: 'SMTP' }) },
    emailOutbox: { create: async ({ data }: { data: { payloadEncrypted: string } }) => {
      assert.ok(data.payloadEncrypted.startsWith('enc:v1:'));
      messages.push(JSON.parse(revealSecret(data.payloadEncrypted)) as Mail);
      return { id: `outbox-${messages.length}` };
    } },
    assignment: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
  await enqueueAssignmentEmailsInTransaction(tx, {
    teacher: { id: 'teacher', name: 'Reserve', email: 'reserve@example.invalid', userId: null },
    request: {
      id: 'request', startHour, schedule, schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Lehrkraft', comments: null,
      school: { name: 'Schule', address: 'Schulweg 1', user: { id: 'school-user', email: 'school@example.invalid' } },
    },
    entries, schulamtId: 'school-office',
  });
  return messages;
}

test('assignment emails and calendars use the start of each scheduled weekday', async t => {
  const messages = await captureNotifications(t, JSON.stringify({ '1': [4, 3], '2': [5, 6] }), [
    { date: '2026-10-12', hours: 2 }, { date: '2026-10-13', hours: 2 },
  ]);
  assert.equal(messages.length, 2);
  for (const message of messages) {
    assert.match(message.body, /12\.10\.2026: 2 Stunde\(n\), Beginn: 3\. Stunde/);
    assert.match(message.body, /13\.10\.2026: 2 Stunde\(n\), Beginn: 5\. Stunde/);
    assert.doesNotMatch(message.body, /Beginn: 1\. Stunde|Start \(Unterrichtsstunde\): 1/);
  }
  const calendar = messages.find(message => message.to === 'reserve@example.invalid')!.attachments![0].content;
  assert.equal(calendar.match(/BEGIN:VEVENT/g)?.length, 2);
  assert.ok(calendar.includes('DTSTART:20261012T080000Z'));
  assert.ok(calendar.includes('DTSTART:20261013T100000Z'));
});

test('a single scheduled third lesson stays a third-lesson start in the notification', async t => {
  const messages = await captureNotifications(t, JSON.stringify({ '1': [3] }), [{ date: '2026-10-12', hours: 1 }]);
  assert.match(messages[0].body, /12\.10\.2026: 1 Stunde\(n\), Beginn: 3\. Stunde/);
  assert.ok(messages[0].attachments![0].content.includes('DTSTART:20261012T080000Z'));
});

test('a request without a schedule retains its explicit third-lesson start', async t => {
  const messages = await captureNotifications(t, null, [{ date: '2026-10-12', hours: 2 }], 3);
  assert.match(messages[0].body, /Beginn: 3\. Stunde/);
  assert.ok(messages[0].attachments![0].content.includes('DTSTART:20261012T080000Z'));
});

test('unknown weekday starts are explained and omitted from timed calendar events', async t => {
  const messages = await captureNotifications(t, JSON.stringify({ '1': [3] }), [
    { date: '2026-10-12', hours: 1 }, { date: '2026-10-13', hours: 2 },
  ]);
  assert.match(messages[0].body, /13\.10\.2026: 2 Stunde\(n\), Beginn bitte mit der Schule abstimmen/);
  const calendar = messages[0].attachments![0].content;
  assert.equal(calendar.match(/BEGIN:VEVENT/g)?.length, 1);
  assert.ok(calendar.includes('DTSTART:20261012T080000Z'));
  assert.ok(!calendar.includes('DTSTART:20261013'));
});

test('an entirely unknown start sends no calendar attachment with a fabricated time', async t => {
  const messages = await captureNotifications(t, '{}', [{ date: '2026-10-12', hours: 2 }]);
  assert.match(messages[0].body, /Beginn bitte mit der Schule abstimmen/);
  assert.equal(messages[0].attachments, undefined);
});

for (const timezone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles']) {
  test(`calendar times follow Berlin summer and winter time on a ${timezone} host`, async t => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = timezone;
    t.after(() => {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    });
    const messages = await captureNotifications(t, JSON.stringify({ '1': [3, 4] }), [
      { date: '2026-10-12', hours: 2 },
      { date: '2026-10-26', hours: 2 },
      // Shortly after midnight in Berlin is still the preceding UTC calendar day.
      { date: new Date('2026-10-11T22:30:00Z'), hours: 1 },
    ]);
    const calendar = messages[0].attachments![0].content;
    assert.equal(calendar.match(/DTSTART:20261012T080000Z/g)?.length, 2);
    assert.ok(calendar.includes('DTEND:20261012T100000Z'));
    assert.ok(calendar.includes('DTSTART:20261026T090000Z'));
    assert.ok(calendar.includes('DTEND:20261026T110000Z'));
    assert.match(messages[0].body, /12\.10\.2026: 1 Stunde\(n\), Beginn: 3\. Stunde/);
  });
}
