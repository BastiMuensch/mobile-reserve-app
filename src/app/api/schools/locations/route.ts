import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { geocodeAddress } from '@/lib/geocoding';
import { SchoolLocationSchema } from '@/lib/schoolLocationValidation';

async function save(request: Request, updating: boolean) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'SCHOOL' && user.role !== 'SCHULAMT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const parsed = SchoolLocationSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { id, schoolId, ...fields } = parsed.data;
    if (updating !== Boolean(id)) return NextResponse.json({ error: 'Ungültige Standort-ID.' }, { status: 400 });
    if (user.role === 'SCHOOL' && user.schoolId !== schoolId) return NextResponse.json({ error: 'Kein Zugriff auf diese Schule.' }, { status: 403 });
    const school = await prisma.school.findFirst({ where: { id: schoolId,
      ...(user.role === 'SCHULAMT' ? { schulamtId: user.id } : {}),
    } });
    if (!school || school.id !== schoolId) return NextResponse.json({ error: 'Kein Zugriff auf diese Schule.' }, { status: 403 });
    const existing = id ? await prisma.schoolLocation.findFirst({ where: { id, schoolId } }) : null;
    if (id && !existing) return NextResponse.json({ error: 'Außenstelle nicht gefunden.' }, { status: 404 });
    if (fields.imageUrl && fields.imageUrl !== existing?.imageUrl) {
      const asset = await prisma.uploadedAsset.findFirst({ where: { ownerUserId: user.id, url: fields.imageUrl, purpose: 'school_image' } });
      if (!asset) return NextResponse.json({ error: 'Dieses Bild wurde nicht von Ihrem Zugang hochgeladen.' }, { status: 403 });
    }
    let warning: string | undefined;
    if (fields.latitude == null && fields.isActive) {
      const result = await geocodeAddress(fields.address);
      if (result.status === 'RESOLVED') {
        fields.latitude = result.latitude;
        fields.longitude = result.longitude;
      } else {
        warning = 'Die Adresse wurde gespeichert. Bitte setzen Sie den Standort auf der Karte, damit Entfernungen berechnet werden können.';
      }
    }
    const location = id
      ? await prisma.schoolLocation.update({ where: { schoolId_id: { schoolId, id } }, data: fields })
      : await prisma.schoolLocation.create({ data: { schoolId, ...fields } });
    return NextResponse.json({ location, warning }, { status: updating ? 200 : 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ungültige Daten.' }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2003', 'P2025'].includes(error.code)) {
      return NextResponse.json({ error: 'Die Schule oder Außenstelle wurde inzwischen geändert. Bitte neu laden.' }, { status: 409 });
    }
    console.error('Saving school location failed.');
    return NextResponse.json({ error: 'Außenstelle konnte nicht gespeichert werden.' }, { status: 500 });
  }
}

export const POST = (request: Request) => save(request, false);
export const PATCH = (request: Request) => save(request, true);
