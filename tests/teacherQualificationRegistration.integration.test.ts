import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { PrismaClient } from '@prisma/client';

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  test('registration qualifications integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'qualification-registration-test-secret';
  const db = new PrismaClient({ datasourceUrl: testDbUrl });

  test('invited registration requires both answers before consuming the invitation and persists explicit Nein', async t => {
    const hook = registerHooks({ resolve: (specifier, context, next) => next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
    t.after(() => hook.deregister());
    const { POST } = await import('../src/app/api/setup/register-teacher/route');
    const { hashInvitationToken, createInvitationToken } = await import('../src/lib/teacherInvitations');
    const suffix = randomUUID();
    const office = await db.user.create({ data: { email: `office-${suffix}@test.local`, role: 'SCHULAMT', password: 'hash' } });
    const email = `reserve-${suffix}@test.local`;
    try {
      const school = await db.school.create({ data: { name: 'Testschule', address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: office.id } });
      const token = createInvitationToken();
      const invitation = await db.teacherInvitation.create({ data: { schulamtId: office.id, recipientEmail: email, tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + 60000) } });
      const form = { token, email, name: 'Testreserve', password: 'Qualification-Test-2026!', stammschuleId: school.id, address: 'Testweg 2', postalCode: '80331', homeLat: 48, homeLng: 11, qualifications: 'Deutsch', preferredType: 'BOTH', isPartTime: false, maxWeeklyHours: 20 };
      const submit = (body: unknown) => POST(new Request('http://localhost/api/setup/register-teacher', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '127.0.0.29' }, body: JSON.stringify(body) }));
      for (const details of [{}, { qualificationType: 'TEACHER', canTeachSports: false }, { qualificationType: 'STUDENT', canTeachSports: 'false' }]) {
        assert.equal((await submit({ ...form, ...details })).status, 400);
        assert.equal((await db.teacherInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).completedAt, null);
      }
      const response = await submit({ ...form, qualificationType: 'TEACHER_GS', canTeachSports: false });
      assert.equal(response.status, 200, await response.clone().text());
      const { teacherId } = await response.json();
      const teacher = await db.teacher.findUniqueOrThrow({ where: { id: teacherId } });
      assert.equal(teacher.qualificationType, 'TEACHER_GS');
      assert.equal(teacher.canTeachSports, false);
      assert.equal(teacher.status, 'PENDING');
      assert.ok((await db.teacherInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).completedAt);
    } finally {
      await db.teacher.deleteMany({ where: { stammschule: { schulamtId: office.id } } });
      await db.teacherInvitation.deleteMany({ where: { schulamtId: office.id } });
      await db.school.deleteMany({ where: { schulamtId: office.id } });
      await db.user.deleteMany({ where: { OR: [{ id: office.id }, { email }] } });
      await db.$disconnect();
    }
  });
}
