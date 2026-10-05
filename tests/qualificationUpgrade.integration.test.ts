import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  test('qualification release upgrade', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(new URL(databaseUrl).pathname, /(?:^|[_-])test(?:[_-]|$)/i);
  test('upgrade from pre-qualification schema preserves invitations, accounts, assignments, mail and settings', async t => {
    const hook = registerHooks({ resolve: (specifier, context, next) => next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
    t.after(() => hook.deregister());
    process.env.JWT_SECRET ??= 'qualification-upgrade-test-only';
    const schema = `qualification_upgrade_test_${randomUUID().replaceAll('-', '')}`;
    const source = new URL(databaseUrl);
    const target = new URL(databaseUrl); target.searchParams.set('schema', schema);
    process.env.DATABASE_URL = target.href;
    const admin = new PrismaClient({ datasourceUrl: databaseUrl });
    const db = new PrismaClient({ datasourceUrl: target.href });
    const sql = (input: string) => {
      const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q'], {
        input: `SET search_path TO "${schema}";\n${input}`, encoding: 'utf8',
        env: { ...process.env, PGHOST: source.hostname, PGPORT: source.port || '5432', PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password), PGDATABASE: decodeURIComponent(source.pathname.slice(1)), PGSSLMODE: source.searchParams.get('sslmode') || 'prefer' },
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
    };
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    try {
      const migrations = (await readdir('prisma/migrations')).filter(name => /^\d/.test(name)).sort();
      const firstNew = '20260929120000_teacher_qualification_details';
      for (const migration of migrations.filter(name => name < firstNew)) sql(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
      const { createInvitationToken, hashInvitationToken } = await import('../src/lib/teacherInvitations');
      const office = await db.user.create({ data: { email: 'upgrade-office@test.invalid', password: 'unchanged-password-hash', role: 'SCHULAMT', sessionVersion: 19 } });
      // This fixture intentionally runs before later School columns exist.
      const school = { id: randomUUID() };
      await db.$executeRaw`INSERT INTO "School" (id, name, address, type, "schulamtId") VALUES (${school.id}, 'Upgrade Testschule', 'Testweg 1', 'GRUNDSCHULE', ${office.id})`;
      const teacherId = randomUUID();
      await db.$executeRaw`INSERT INTO "Teacher" (id, name, "stammschuleId", "maxWeeklyHours", qualifications, status, "homeLat", "homeLng", "preferredType") VALUES (${teacherId}, 'Alte Reserve', ${school.id}, 20, 'Grundschule', 'ACTIVE', 48, 11, 'BOTH')`;
      // This older schema predates daily refusal history. Only return columns
      // available at this migration stage when using the current Prisma client.
      const request = await db.request.create({ data: { schoolId: school.id, date: new Date('2026-10-01'), hours: 4, substitutedTeacher: 'Test', qualifications: 'Grundschule', status: 'FILLED' }, select: { id: true, date: true } });
      await db.assignment.create({ data: { teacherId, requestId: request.id, date: request.date, hours: 4, status: 'ACCEPTED' } });
      await db.schulamtProfile.create({ data: { userId: office.id, mailProvider: 'NONE', smtpPass: 'unchanged-encrypted-test-value', teacherInviteValidityDays: 21 } });
      await db.emailOutbox.create({ data: { schulamtId: office.id, status: 'PENDING', payloadEncrypted: 'unchanged-encrypted-mail' } });
      await db.passwordResetToken.create({ data: { userId: office.id, tokenHash: 'unchanged-reset-hash', expiresAt: new Date(Date.now() + 86400000) } });
      const tokens: Record<string, string> = {};
      for (const status of ['ACTIVE', 'EXPIRED', 'REVOKED', 'COMPLETED']) {
        tokens[status] = createInvitationToken();
        await db.teacherInvitation.create({ data: {
          schulamtId: office.id, recipientEmail: `${status.toLowerCase()}@test.invalid`, tokenHash: hashInvitationToken(tokens[status]),
          activeKey: status === 'ACTIVE' ? `${office.id}:active@test.invalid` : null,
          expiresAt: new Date(Date.now() + (status === 'EXPIRED' ? -86400000 : 86400000)),
          revokedAt: status === 'REVOKED' ? new Date() : null, completedAt: status === 'COMPLETED' ? new Date() : null,
        } });
      }
      const snapshot = async () => ({
        users: await db.user.findMany({ orderBy: { id: 'asc' } }),
        teachers: await db.$queryRaw`SELECT to_jsonb(t) - 'qualificationType' - 'canTeachSports' AS data FROM "Teacher" t ORDER BY id`,
        invitations: await db.teacherInvitation.findMany({ orderBy: { id: 'asc' } }),
        requests: await db.$queryRaw`SELECT to_jsonb(r) - 'unfilledDays' - 'locationId' AS data FROM "Request" r ORDER BY id`, assignments: await db.assignment.findMany(),
        mail: await db.emailOutbox.findMany(), profiles: await db.schulamtProfile.findMany(), resets: await db.passwordResetToken.findMany(),
      });
      const before = await snapshot();
      const specialistMigration = '20260929140000_specialist_qualification';
      for (const migration of migrations.filter(name => name >= firstNew && name < specialistMigration)) sql(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
      assert.deepEqual(await snapshot(), before, 'upgrade must not modify any existing record');
      const upgraded = await db.teacher.findUniqueOrThrow({ where: { id: teacherId } });
      assert.equal(upgraded.qualificationType, null);
      assert.equal(upgraded.canTeachSports, null);
      // Simulate a saved v0.1.17 profile before applying the v0.1.18 migration.
      await db.teacher.update({ where: { id: teacherId }, data: { qualificationType: 'STUDENT', canTeachSports: true } });
      const previousRelease = { records: await snapshot(), teachers: await db.teacher.findMany() };
      for (const migration of migrations.filter(name => name >= specialistMigration)) sql(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
      assert.deepEqual({ records: await snapshot(), teachers: await db.teacher.findMany() }, previousRelease, 'v0.1.18 preserves all v0.1.17 records including legacy status and sports');
      assert.equal((await db.request.findUniqueOrThrow({ where: { id: request.id } })).unfilledDays, null, 'daily refusal migration adds no decisions to historic requests');
      assert.equal((await db.request.findUniqueOrThrow({ where: { id: request.id } })).locationId, null, 'historic requests remain at the main site');
      await db.teacher.update({ where: { id: teacherId }, data: { qualificationType: 'SPECIALIST' } });
      assert.equal((await db.teacher.findUniqueOrThrow({ where: { id: teacherId } })).canTeachSports, true, 'choosing Fachlehrkraft leaves sports unchanged');
      const { GET, POST } = await import('../src/app/api/setup/register-teacher/route');
      for (const [status, token] of Object.entries(tokens)) {
        const response = await GET(new Request(`http://localhost/api/setup/register-teacher?token=${token}`));
        assert.equal(response.status, status === 'ACTIVE' ? 200 : 400, `${status} invitation retains its validity`);
      }
      const response = await POST(new Request('http://localhost/api/setup/register-teacher', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '127.0.0.30' }, body: JSON.stringify({
        token: tokens.ACTIVE, email: 'active@test.invalid', name: 'Neue Reserve', password: 'Upgrade-Registration-2026!',
        stammschuleId: school.id, address: 'Testweg 2', postalCode: '80331', homeLat: 48, homeLng: 11,
        qualifications: 'Deutsch', preferredType: 'BOTH', isPartTime: false, maxWeeklyHours: 20, qualificationType: 'TEACHER_MS', canTeachSports: false,
      }) }));
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await GET(new Request(`http://localhost/api/setup/register-teacher?token=${tokens.ACTIVE}`))).status, 400, 'old invitation remains single-use');
    } finally {
      await db.$disconnect();
      // Only this generated test schema is removed, never an application schema.
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });
}
