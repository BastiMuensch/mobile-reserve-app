import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { inflateSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

function extractInitialPasswords(pdf: Buffer): string[] {
  const source = pdf.toString('latin1');
  const streams: string[] = [];
  const streamHeader = /\/Length\s+(\d+)[\s\S]{0,160}?stream\r?\n/g;
  for (let match = streamHeader.exec(source); match; match = streamHeader.exec(source)) {
    const length = Number(match[1]);
    const start = match.index + match[0].length;
    try { streams.push(inflateSync(pdf.subarray(start, start + length)).toString('latin1')); } catch { /* image streams are not PDF text streams */ }
  }
  return [...streams.join('\n').matchAll(/\(([A-Za-z0-9!$%*+\-]{16})\)\s*Tj/g)].map(match => match[1]);
}

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;
const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('school account letter HTTP integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'school-account-letter-test-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://portal.example.test';
  const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('account-letter export resets only owned school accounts and invalidates sessions and reset tokens', async t => {
    const serverOnly = registerHooks({ resolve: (specifier, context, nextResolve) => nextResolve(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context) });
    t.after(() => serverOnly.deregister());
    const { POST } = await import('../src/app/api/schools/account-letters/route');
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = randomUUID();
    const createdUserIds: string[] = [];
    const schoolIds: string[] = [];
    const invoke = async (userId: string | null, body: unknown) => {
      const cookie = userId ? `session_token=${await signToken({ id: userId, sessionVersion: 0 })}` : '';
      const request = new Request('https://portal.example.test/api/schools/account-letters', { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: 'https://portal.example.test' }, body: JSON.stringify(body) });
      const store = createRequestStoreForAPI(request as never, { pathname: '/api/schools/account-letters', search: '' }, [] as never, undefined, undefined, undefined);
      return workAsyncStorage.run({ route: '/api/schools/account-letters', forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, () => POST(request)));
    };
    try {
      const office = await db.user.create({ data: { email: `office-${suffix}@test.invalid`, password: 'hash', role: 'SCHULAMT' } });
      const otherOffice = await db.user.create({ data: { email: `other-${suffix}@test.invalid`, password: 'hash', role: 'SCHULAMT' } });
      createdUserIds.push(office.id, otherOffice.id);
      for (const [owner, name, active] of [[office.id, 'Eigene Schule A', true], [office.id, 'Eigene Schule B', false], [otherOffice.id, 'Fremde Schule', false]] as const) {
        const school = await db.school.create({ data: { name, address: 'Testweg 1', type: 'GRUNDSCHULE', schulamtId: owner } });
        schoolIds.push(school.id);
        const user = await db.user.create({ data: { email: `${school.id}@test.invalid`, password: `old-password-hash-${school.id}`, role: 'SCHOOL', schoolId: school.id, isActive: active } });
        createdUserIds.push(user.id);
        await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: `token-${school.id}`, expiresAt: new Date('2030-01-01') } });
      }
      const [ownedSchoolA, ownedSchoolB, foreignSchool] = schoolIds;
      schoolIds.push((await db.school.create({ data: { name: 'Schule ohne Zugang', address: 'Testweg 4', type: 'GS_MS', schulamtId: office.id } })).id);
      const schoolAUser = (await db.school.findUniqueOrThrow({ where: { id: ownedSchoolA }, include: { user: true } })).user!;
      assert.equal((await invoke(null, { schoolIds: [ownedSchoolA], confirmPasswordReset: true })).status, 401);
      assert.equal((await invoke(schoolAUser.id, { schoolIds: [ownedSchoolA], confirmPasswordReset: true })).status, 403);
      assert.equal((await invoke(office.id, { schoolIds: [ownedSchoolA], confirmPasswordReset: false })).status, 400);
      assert.equal((await invoke(office.id, { schoolIds: [ownedSchoolA, ownedSchoolA], confirmPasswordReset: true })).status, 400);
      assert.equal((await invoke(office.id, { schoolIds: Array.from({ length: 101 }, () => ownedSchoolA), confirmPasswordReset: true })).status, 400);
      assert.equal((await invoke(office.id, { schoolIds: [ownedSchoolA, foreignSchool], confirmPasswordReset: true })).status, 404);
      const beforeInvalidUrl = await db.school.findUniqueOrThrow({ where: { id: ownedSchoolB }, include: { user: true } });
      const normalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
      process.env.NEXT_PUBLIC_APP_URL = 'https://letter-user:letter-password@portal.example.test';
      assert.equal((await invoke(office.id, { schoolIds: [ownedSchoolB], confirmPasswordReset: true })).status, 500);
      process.env.NEXT_PUBLIC_APP_URL = normalAppUrl;
      const untouched = await db.school.findUniqueOrThrow({ where: { id: ownedSchoolB }, include: { user: true } });
      assert.equal(untouched.user?.password, beforeInvalidUrl.user?.password);
      assert.equal(untouched.user?.sessionVersion, 0);
      assert.equal(untouched.user?.isActive, false);

      const response = await invoke(office.id, { allSchools: true, confirmPasswordReset: true });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('x-account-letter-count'), '2');
      const pdf = Buffer.from(await response.arrayBuffer());
      assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 2);
      const passwords = extractInitialPasswords(pdf);
      assert.equal(passwords.length, 2, 'two printed initial passwords must be recoverable from the PDF response');
      const after = await db.school.findMany({ where: { id: { in: [ownedSchoolA, ownedSchoolB] } }, include: { user: true } });
      assert.equal(after.length, 2);
      const hashes = after.map(school => school.user!.password);
      for (const password of passwords) assert.ok((await Promise.all(hashes.map(hash => bcrypt.compare(password, hash)))).some(Boolean));
      for (const school of after) {
        assert.equal(school.user?.isActive, true);
        assert.equal(school.user?.sessionVersion, 1);
        assert.equal(school.user?.mustChangePassword, true);
        assert.equal(await db.passwordResetToken.count({ where: { userId: school.user!.id, usedAt: null } }), 0);
      }
      const foreignAfter = await db.school.findUniqueOrThrow({ where: { id: foreignSchool }, include: { user: true } });
      assert.equal(foreignAfter.user?.sessionVersion, 0);

      const single = await invoke(office.id, { schoolIds: [ownedSchoolA], confirmPasswordReset: true });
      assert.equal(single.status, 200);
      assert.equal(single.headers.get('x-account-letter-count'), '1');
      const singlePdf = Buffer.from(await single.arrayBuffer());
      assert.equal((singlePdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 1);
      const singlePasswords = extractInitialPasswords(singlePdf);
      assert.equal(singlePasswords.length, 1);
      const singleUser = await db.user.findUniqueOrThrow({ where: { schoolId: ownedSchoolA } });
      assert.equal(singleUser.sessionVersion, 2);
      assert.ok(await bcrypt.compare(singlePasswords[0], singleUser.password));
      assert.equal((await db.user.findUniqueOrThrow({ where: { schoolId: ownedSchoolB } })).sessionVersion, 1);
    } finally {
      await db.passwordResetToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await db.school.deleteMany({ where: { id: { in: schoolIds } } });
      await db.$disconnect();
    }
  });
}
