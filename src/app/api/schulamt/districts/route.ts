import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { districtUsage } from '@/lib/schoolDistrict';

type OfficeAuth = { ok: true; user: { id: string } } | { ok: false; response: NextResponse };

async function officeUser(): Promise<OfficeAuth> {
  const user = await getSessionUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) };
  if (user.role !== 'SCHULAMT') return { ok: false, response: NextResponse.json({ error: 'Kein Zugriff.' }, { status: 403 }) };
  return { ok: true, user };
}

async function loadUsage(schulamtId: string) {
  const [schools, teachers] = await Promise.all([
    prisma.school.findMany({ where: { schulamtId, schoolDistrict: { not: null } }, select: { schoolDistrict: true } }),
    prisma.teacher.findMany({ where: { stammschule: { schulamtId }, schoolDistrict: { not: null } }, select: { schoolDistrict: true } }),
  ]);
  return districtUsage(schools, teachers);
}

/** Which district spellings are in use, so the office can merge variants into its list. */
export async function GET() {
  const auth = await officeUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ usage: await loadUsage(auth.user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

const MergeSchema = z.object({
  from: z.string().trim().min(1).max(50),
  to: z.string().trim().min(1).max(50).transform(value => value.toLocaleUpperCase('de')),
}).strict();

/** Rewrites one spelling (e.g. "BT LAND") to a district from the office's list for all its schools and reserves. */
export async function POST(request: Request) {
  const auth = await officeUser();
  if (!auth.ok) return auth.response;
  const parsed = MergeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bitte Ausgangswert und Zielbezirk angeben.' }, { status: 400 });
  const { from, to } = parsed.data;
  const profile = await prisma.schulamtProfile.findUnique({ where: { userId: auth.user.id }, select: { schoolDistricts: true } });
  if (!profile?.schoolDistricts.includes(to)) return NextResponse.json({ error: 'Der Zielbezirk muss in Ihrer Bezirksliste stehen. Bitte die Liste zuerst speichern.' }, { status: 400 });
  if (from === to) return NextResponse.json({ schools: 0, teachers: 0, usage: await loadUsage(auth.user.id) });
  const [schools, teachers] = await prisma.$transaction([
    prisma.school.updateMany({ where: { schulamtId: auth.user.id, schoolDistrict: from }, data: { schoolDistrict: to } }),
    prisma.teacher.updateMany({ where: { stammschule: { schulamtId: auth.user.id }, schoolDistrict: from }, data: { schoolDistrict: to } }),
  ]);
  return NextResponse.json({ schools: schools.count, teachers: teachers.count, usage: await loadUsage(auth.user.id) });
}
