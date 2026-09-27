import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  test('school year archive HTTP integration', { skip: 'TEST_DATABASE_URL not configured' }, () => {});
} else {
  assert.match(decodeURIComponent(new URL(testDbUrl).pathname), /(?:^|[_-])test(?:[_-]|$)/i);
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET ??= 'school-year-archive-integration-test-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost';
  const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

  test('archive is role-gated, origin-bound, encrypted and tenant/year-isolated without changing data', async () => {
    const { GET, POST } = await import('../src/app/api/schulamt/year-archive/route');
    const { signToken } = await import('../src/lib/auth');
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
    const { createRequestStoreForAPI } = await import('next/dist/server/async-storage/request-store');
    const suffix = randomUUID().replaceAll('-', '');
    const password = `correct-${suffix}`;
    const archivePassword = randomBytes(24).toString('base64url');
    const ids = { users: [] as string[], schools: [] as string[], teachers: [] as string[], requests: [] as string[], assignments: [] as string[], reports: [] as string[] };

    const invoke = async (userId: string | undefined, version: number, method: 'GET' | 'POST', body?: unknown, options: { origin?: string | null; contentType?: string; ip?: string } = {}) => {
      const pathname = '/api/schulamt/year-archive';
      const token = userId ? await signToken({ id: userId, sessionVersion: version }) : '';
      const headers: Record<string, string> = {};
      if (token) headers.cookie = `session_token=${token}`;
      if (options.origin !== null) headers.origin = options.origin ?? 'http://localhost';
      if (body !== undefined) headers['content-type'] = options.contentType ?? 'application/json';
      if (options.ip) headers['x-forwarded-for'] = options.ip;
      const request = new Request(`http://localhost${pathname}`, { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
      const store = createRequestStoreForAPI(request as never, { pathname, search: '' }, [] as never, undefined, undefined, undefined);
      const handler = method === 'GET' ? () => GET() : () => POST(request);
      return workAsyncStorage.run({ route: pathname, forceStatic: false, dynamicShouldError: false } as never, () => workUnitAsyncStorage.run(store, handler));
    };

    const listZip = async (bytes: Uint8Array, passwordForEntry?: string) => {
      const reader = new ZipReader(new Uint8ArrayReader(bytes));
      try {
        const entries = await reader.getEntries();
        if (!passwordForEntry) return { entries, data: undefined };
        assert.equal(entries.length, 1);
        assert.equal(entries[0].directory, false);
        return { entries, data: await entries[0].getData(new Uint8ArrayWriter(), { password: passwordForEntry, checkSignature: true }) };
      } finally { await reader.close(); }
    };

    try {
      const hash = await bcrypt.hash(password, 10);
      const [office, otherOffice, schoolUser, teacherUser] = await Promise.all([
        db.user.create({ data: { email: `archive-office-${suffix}@test.invalid`, password: hash, role: 'SCHULAMT', sessionVersion: 3 } }),
        db.user.create({ data: { email: `archive-other-${suffix}@test.invalid`, password: hash, role: 'SCHULAMT', sessionVersion: 4 } }),
        db.user.create({ data: { email: `archive-school-user-${suffix}@test.invalid`, password: hash, role: 'SCHOOL', sessionVersion: 5 } }),
        db.user.create({ data: { email: `archive-teacher-user-${suffix}@test.invalid`, password: hash, role: 'TEACHER', sessionVersion: 6 } }),
      ]);
      ids.users.push(office.id, otherOffice.id, schoolUser.id, teacherUser.id);
      const [school, foreignSchool] = await Promise.all([
        db.school.create({ data: { name: `Archivschule ${suffix}`, address: 'Archivweg 1', type: 'GRUNDSCHULE', schulamtId: office.id } }),
        db.school.create({ data: { name: `Fremdschule ${suffix}`, address: 'Fremdweg 1', type: 'MITTELSCHULE', schulamtId: otherOffice.id } }),
      ]);
      ids.schools.push(school.id, foreignSchool.id);
      await db.user.update({ where: { id: schoolUser.id }, data: { schoolId: school.id } });
      await db.schulamtProfile.create({ data: { userId: office.id, headerText: 'Archiv-Schulamt', returnAddress: 'Archivweg 2', contactAddress: 'Archivweg 2', contactPerson: 'Archiv Leitung', city: 'Musterstadt', amtsleitungName: 'Archiv Leitung', amtsleitungTitle: 'Amtsleitung', smtpPass: 'must-not-export-secret' } });
      const [teacher, foreignTeacher] = await Promise.all([
        db.teacher.create({ data: { name: 'Archive Reserve', userId: teacherUser.id, stammschuleId: school.id, maxWeeklyHours: 18, qualifications: 'Sport', status: 'ACTIVE', preferredType: 'BOTH', homeLat: 48.1, homeLng: 11.5, schoolYear: '2025/2026' } }),
        db.teacher.create({ data: { name: 'Foreign Reserve', stammschuleId: foreignSchool.id, maxWeeklyHours: 19, qualifications: 'Foreign-Secret-Only', status: 'ACTIVE', preferredType: 'BOTH', homeLat: 49.1, homeLng: 12.5, schoolYear: '2025/2026' } }),
      ]);
      ids.teachers.push(teacher.id, foreignTeacher.id);
      const [request, foreignRequest] = await Promise.all([
        db.request.create({ data: { schoolId: school.id, date: new Date('2026-05-11T00:00:00.000Z'), hours: 3, weeklyHours: 3, schoolType: 'GRUNDSCHULE', substitutedTeacher: 'Archive Teacher', qualifications: 'Sport', priority: 'UNPLANNED_ABSENCE', status: 'FILLED' } }),
        db.request.create({ data: { schoolId: foreignSchool.id, date: new Date('2026-05-12T00:00:00.000Z'), hours: 4, weeklyHours: 4, schoolType: 'MITTELSCHULE', substitutedTeacher: 'Foreign Secret Only', qualifications: 'Foreign-Secret-Only', priority: 'UNPLANNED_ABSENCE', status: 'FILLED' } }),
      ]);
      ids.requests.push(request.id, foreignRequest.id);
      const assignments = await db.assignment.createManyAndReturn({ data: [
        { requestId: request.id, teacherId: teacher.id, date: new Date('2026-05-11T00:00:00.000Z'), hours: 3, status: 'ACCEPTED' },
        { requestId: foreignRequest.id, teacherId: foreignTeacher.id, date: new Date('2026-05-12T00:00:00.000Z'), hours: 4, status: 'ACCEPTED' },
      ] });
      ids.assignments.push(...assignments.map(item => item.id));
      const report = await db.governmentReport.create({ data: { schulamtId: office.id, date: new Date('2026-05-31T00:00:00.000Z'), payload: {
        date: '2026-05-31', office: 'ARCHIV', internalShort: 0, internalLong: 1, reviewed: true, expectedUpdatedAt: null,
        entries: [{ teacherId: teacher.id, state: 'SHORT', setting: { effectiveFrom: '2026-05-01', category: 'GS_MS', included: true, weeklyHours: 18 } }],
      } } });
      ids.reports.push(report.id);
      // Many unreviewed snapshots exercise the bounded response header. The
      // encrypted report must still retain every warning, without truncation.
      const unreviewed = await db.governmentReport.createManyAndReturn({ data: Array.from({ length: 23 }, (_, index) => ({
        schulamtId: office.id,
        date: new Date(`2025-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
        payload: { reviewed: false },
      })) });
      ids.reports.push(...unreviewed.map(row => row.id));
      await db.user.update({ where: { id: teacherUser.id }, data: { name: 'Changed after saved report' } });
      await db.teacher.update({ where: { id: teacher.id }, data: { maxWeeklyHours: 1 } });
      const profileBefore = await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } });
      const ownedCountsBefore = await Promise.all([db.request.count({ where: { schoolId: school.id } }), db.assignment.count({ where: { teacherId: teacher.id } }), db.governmentReport.count({ where: { schulamtId: office.id } })]);

      assert.equal((await invoke(undefined, 0, 'GET')).status, 401);
      assert.equal((await invoke(office.id, 3, 'GET')).status, 405);
      assert.equal((await invoke(schoolUser.id, 5, 'GET')).status, 403);
      assert.equal((await invoke(teacherUser.id, 6, 'POST', { year: '2025/2026', password, archivePassword })).status, 403);
      assert.equal((await invoke(office.id, 3, 'POST', { year: '2025/2026', password, archivePassword }, { origin: null })).status, 403);
      assert.equal((await invoke(office.id, 3, 'POST', { year: '2025/2026', password, archivePassword }, { origin: 'https://foreign.invalid' })).status, 403);
      assert.equal((await invoke(office.id, 3, 'POST', { year: '2025/2027', password, archivePassword }, { ip: '10.0.0.1' })).status, 400);
      assert.equal((await invoke(office.id, 3, 'POST', '{', { ip: '10.0.0.2' })).status, 400);
      assert.equal((await invoke(office.id, 3, 'POST', { year: '2025/2026', password, archivePassword }, { contentType: 'text/plain', ip: '10.0.0.3' })).status, 400);
      assert.equal((await invoke(office.id, 3, 'POST', { year: '2025/2026', password, archivePassword, padding: 'x'.repeat(5000) }, { ip: '10.0.0.4' })).status, 413);
      assert.equal((await invoke(office.id, 3, 'POST', { year: '2025/2026', password: 'wrong', archivePassword }, { ip: '10.0.0.5' })).status, 401);

      const exported = await invoke(office.id, 3, 'POST', { year: '2025/2026', password, archivePassword }, { ip: '10.0.0.6' });
      assert.equal(exported.status, 200, exported.status === 200 ? '' : await exported.text());
      assert.equal(exported.headers.get('content-type'), 'application/zip');
      assert.match(exported.headers.get('cache-control') || '', /no-store/);
      assert.match(exported.headers.get('content-disposition') || '', /Schuljahresarchiv_2025-2026_/);
      const summary = JSON.parse(Buffer.from(exported.headers.get('x-archive-summary') || '', 'base64url').toString('utf8')) as Record<string, unknown>;
      assert.ok(Object.keys(summary).length > 0);
      assert.ok((exported.headers.get('x-archive-summary') || '').length <= 3500);
      assert.ok(Array.isArray(summary.warnings) && summary.warnings.length <= 25);
      assert.ok((summary.warnings as string[]).some(warning => warning.includes('weitere Hinweise')));
      const outerBytes = new Uint8Array(await exported.arrayBuffer());
      assert.ok(!Buffer.from(outerBytes).includes(Buffer.from('Foreign Secret Only')));
      assert.ok(!Buffer.from(outerBytes).includes(Buffer.from(hash)));
      const outer = await listZip(outerBytes);
      assert.deepEqual(outer.entries.map(entry => entry.filename), ['Archivinhalt.zip']);
      assert.equal(outer.entries[0].encrypted, true, 'only outer payload is AES encrypted');
      const outerEntry = outer.entries[0];
      if (!outerEntry || outerEntry.directory) assert.fail('outer payload must be a single file');
      await assert.rejects(() => outerEntry.getData(new Uint8ArrayWriter(), { password: 'x'.repeat(32), checkSignature: true }));
      const decrypted = await listZip(outerBytes, archivePassword);
      assert.ok(decrypted.data);
      const inner = await listZip(decrypted.data!);
      const paths = inner.entries.filter(entry => !entry.directory).map(entry => entry.filename).sort();
      assert.ok(paths.includes('Jahresuebersicht.xlsx'));
      assert.ok(paths.includes('Inhaltsverzeichnis.html'));
      assert.ok(paths.includes('Pruefbericht.json'));
      assert.ok(paths.some(path => path.startsWith('Einsatznachweise/')));
      assert.ok(paths.some(path => path.startsWith('Monatsmeldungen/')));
      assert.ok(inner.entries.every(entry => !entry.encrypted), 'inner ZIP is deliberately clear after outer AES authentication');
      const files = new Map(await Promise.all(inner.entries.filter(entry => !entry.directory).map(async entry => [entry.filename, Buffer.from(await entry.getData(new Uint8ArrayWriter()))] as const)));
      const clear = Buffer.concat([...files.values()]).toString('utf8');
      const manifest = JSON.parse(files.get('Pruefbericht.json')!.toString('utf8'));
      assert.ok(manifest.warnings.length > (summary.warnings as string[]).length);
      const reportBook = new ExcelJS.Workbook();
      await reportBook.xlsx.load(files.get('Monatsmeldungen/2026-05-31.xlsx')! as never);
      assert.equal(reportBook.worksheets[0].getCell('D8').value, 18, 'the saved government-report snapshot is independent of changed live teacher data');
      assert.ok(!clear.includes('Foreign Secret Only'), 'foreign-office data never enters decrypted archive');
      assert.ok(!clear.includes(hash), 'credential hashes never enter decrypted archive');
      assert.ok(!clear.includes('must-not-export-secret'), 'profile secrets never enter decrypted archive');
      assert.ok(!/JWT_SECRET|DATABASE_URL|SMTP_ENCRYPTION_KEY/.test(clear), 'environment keys never enter decrypted archive');
      const profileAfter = await db.schulamtProfile.findUniqueOrThrow({ where: { userId: office.id } });
      assert.deepEqual(profileAfter.lastBackupDate, profileBefore.lastBackupDate, 'year archive is not a full backup and must not mark it as one');
      assert.deepEqual(await Promise.all([db.request.count({ where: { schoolId: school.id } }), db.assignment.count({ where: { teacherId: teacher.id } }), db.governmentReport.count({ where: { schulamtId: office.id } })]), ownedCountsBefore, 'export performs no data changes');

      await db.user.update({ where: { id: otherOffice.id }, data: { sessionVersion: 5 } });
      assert.equal((await invoke(otherOffice.id, 4, 'POST', { year: '2025/2026', password, archivePassword }, { ip: '10.0.0.7' })).status, 401, 'revoked session is rejected before export');
    } finally {
      if (ids.assignments.length) await db.assignment.deleteMany({ where: { id: { in: ids.assignments } } });
      if (ids.requests.length) await db.request.deleteMany({ where: { id: { in: ids.requests } } });
      if (ids.reports.length) await db.governmentReport.deleteMany({ where: { id: { in: ids.reports } } });
      if (ids.teachers.length) await db.teacher.deleteMany({ where: { id: { in: ids.teachers } } });
      if (ids.schools.length) await db.school.deleteMany({ where: { id: { in: ids.schools } } });
      if (ids.users.length) await db.user.deleteMany({ where: { id: { in: ids.users } } });
      await db.$disconnect();
    }
  });
}
