import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isValidDateKey, parseDateKeyStrict } from '@/lib/dateKey';
import { governmentReportInputSchema } from '@/lib/governmentReport';
import { createGovernmentReportWorkbook } from '@/lib/governmentReportExport';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 403 });
  const date = new URL(request.url).searchParams.get('date');
  if (!isValidDateKey(date)) return NextResponse.json({ error: 'Ungültiger Stichtag.' }, { status: 400 });
  try {
    const record = await prisma.governmentReport.findUnique({ where: { schulamtId_date: { schulamtId: user.id, date: parseDateKeyStrict(date) } } });
    if (!record) return NextResponse.json({ error: 'Bitte zuerst die Meldung speichern.' }, { status: 404 });
    const revision = new URL(request.url).searchParams.get('revision');
    if (revision && revision !== record.updatedAt.toISOString()) return NextResponse.json({ error: 'Die Meldung wurde geändert. Bitte neu laden.' }, { status: 409 });
    const input = governmentReportInputSchema.parse(record.payload);
    if (!input.reviewed) return NextResponse.json({ error: 'Bitte zuerst die Meldung prüfen und freigeben.' }, { status: 409 });
    return new NextResponse(await createGovernmentReportWorkbook(input), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="MR_Regierung_${date}.xlsx"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch {
    return NextResponse.json({ error: 'Excel-Export fehlgeschlagen.' }, { status: 500 });
  }
}
