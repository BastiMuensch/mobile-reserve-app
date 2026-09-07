import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { PUBLIC_INSTANCE_SETTING_IDS, publicInstanceSettingsSchema, settingsFromRecords } from '@/lib/publicInstanceSettings';

const ALLOWED_SETTINGS = [...PUBLIC_INSTANCE_SETTING_IDS];

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const settings = await prisma.systemSetting.findMany({
      where: { id: { in: ALLOWED_SETTINGS } },
    });
    return NextResponse.json(settingsFromRecords(settings));
  } catch {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = publicInstanceSettingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Ungültige öffentliche Einstellungen.' }, { status: 400 });
    }
    const data = parsed.data;

    if (data.loginLogoUrl) {
      const logo = await prisma.uploadedAsset.findFirst({
        where: { ownerUserId: userSession.id, purpose: 'logo', url: data.loginLogoUrl },
        select: { id: true },
      });
      if (!logo) return NextResponse.json({ error: 'Das Login-Logo muss ein eigenes, hochgeladenes Schulamtslogo sein.' }, { status: 400 });
    }

    await prisma.$transaction(PUBLIC_INSTANCE_SETTING_IDS.map((id) => prisma.systemSetting.upsert({
      where: { id }, create: { id, value: data[id] }, update: { value: data[id] },
    })));

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
