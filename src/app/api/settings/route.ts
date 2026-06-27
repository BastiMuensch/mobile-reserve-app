import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession || (userSession.role !== 'SCHULAMT' && userSession.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const settings = await prisma.systemSetting.findMany();
    // Convert array of { id, value } to an object
    const settingsObj = settings.reduce((acc, curr) => {
      acc[curr.id] = curr.value;
      return acc;
    }, {} as Record<string, string>);

    // Mask SMTP password before returning
    if (settingsObj['smtpPass']) {
      settingsObj['smtpPass'] = '********';
    }
    
    return NextResponse.json(settingsObj);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await request.json();
    
    // data is expected to be an object of key-value pairs
    // Update or create each setting
    const ALLOWED_SETTINGS = ['smtpHost', 'smtpUser', 'smtpPass', 'impressum', 'privacyPolicy'];

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && ALLOWED_SETTINGS.includes(key)) {
        // If the frontend sends back the masked password, don't overwrite the real one
        if (key === 'smtpPass' && (value === '********' || value === '')) {
          continue;
        }
        await prisma.systemSetting.upsert({
          where: { id: key },
          update: { value },
          create: { id: key, value }
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
