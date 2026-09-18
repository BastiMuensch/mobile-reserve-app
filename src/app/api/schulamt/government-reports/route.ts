import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isValidDateKey, parseDateKeyStrict, toLocalDateInputValue } from '@/lib/dateKey';
import { governmentReportInputSchema } from '@/lib/governmentReport';
import { loadGovernmentReportRows } from '@/lib/governmentReportService';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 403 });
  const date = new URL(request.url).searchParams.get('date');
  if (!isValidDateKey(date)) return NextResponse.json({ error: 'Ungültiger Stichtag.' }, { status: 400 });
  try {
    const result = await prisma.$transaction(async tx => {
      const rows = await loadGovernmentReportRows(tx, user.id, date);
      const saved = await tx.governmentReport.findUnique({ where: { schulamtId_date: { schulamtId: user.id, date: parseDateKeyStrict(date) } } });
      const history = await tx.governmentReport.findMany({ where: { schulamtId: user.id }, orderBy: { date: 'desc' }, select: { date: true }, take: 200 });
      return { rows, saved: saved ? { input: governmentReportInputSchema.parse(saved.payload), updatedAt: saved.updatedAt.toISOString() } : null,
        history: history.map(r => toLocalDateInputValue(r.date)) };
    }, { isolationLevel: 'RepeatableRead' });
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json({ error: 'Monatsmeldung konnte nicht geladen werden.' }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Ungültige Meldung.' }, { status: 400 }); }
  const parsed = governmentReportInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Ungültige Meldung.' }, { status: 400 });
  const input = parsed.data;
  try {
    const saved = await prisma.$transaction(async tx => {
      const date = parseDateKeyStrict(input.date);
      const current = await tx.governmentReport.findUnique({ where: { schulamtId_date: { schulamtId: user.id, date } } });
      if ((current?.updatedAt.toISOString() ?? null) !== input.expectedUpdatedAt) throw new Error('CONFLICT');
      const rows = await loadGovernmentReportRows(tx, user.id, input.date);
      const ids = new Set(rows.map(r => r.teacherId));
      if (ids.size !== input.entries.length || input.entries.some(e => !ids.has(e.teacherId))) throw new Error('ROSTER_CHANGED');
      for (const entry of input.entries) {
        if (entry.setting.category === 'UNKNOWN') continue;
        const previous = rows.find(row => row.teacherId === entry.teacherId)!;
        const { category, included, weeklyHours, effectiveFrom } = entry.setting;
        if (previous.setting.category === category && previous.setting.included === included && previous.setting.weeklyHours === weeklyHours
          && (previous.configuredFrom === effectiveFrom || effectiveFrom === input.date)) continue;
        await tx.reserveReportingPeriod.upsert({
          where: { teacherId_effectiveFrom: { teacherId: entry.teacherId, effectiveFrom: parseDateKeyStrict(effectiveFrom) } },
          create: { teacherId: entry.teacherId, effectiveFrom: parseDateKeyStrict(effectiveFrom), category, included, weeklyHours },
          update: { category, included, weeklyHours },
        });
      }
      // Persist the checked states, not a query that would silently change later.
      const payload = { ...input, expectedUpdatedAt: null };
      return tx.governmentReport.upsert({
        where: { schulamtId_date: { schulamtId: user.id, date } },
        create: { schulamtId: user.id, date, payload }, update: { payload },
      });
    }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
    return NextResponse.json({ updatedAt: saved.updatedAt.toISOString() }, { headers });
  } catch (error) {
    if (error instanceof Error && ['CONFLICT', 'ROSTER_CHANGED'].includes(error.message)
      || error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      return NextResponse.json({ error: 'Meldung oder Lehrkräfte wurden zwischenzeitlich geändert. Bitte neu laden.' }, { status: 409, headers });
    }
    return NextResponse.json({ error: 'Monatsmeldung konnte nicht gespeichert werden.' }, { status: 500, headers });
  }
}
