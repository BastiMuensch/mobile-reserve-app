import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Bewusst nur unkritische, für den Login-Screen nötige Werte – diese Route ist
    // öffentlich erreichbar. loginLogoUrl ist instanzweit (nicht pro Schulamt), weil vor
    // der Anmeldung noch nicht feststeht, um welches Schulamt es geht.
    const settings = await prisma.systemSetting.findMany({
      where: {
        id: { in: ['impressum', 'privacyPolicy', 'loginLogoUrl', 'loginLogoAlt'] }
      }
    });
    
    const settingsObj = settings.reduce((acc, curr) => {
      acc[curr.id] = curr.value;
      return acc;
    }, {} as Record<string, string>);

    return NextResponse.json(settingsObj);
  } catch (error) {
    console.error('Failed to fetch public settings:', error);
    return NextResponse.json({ error: 'Failed to fetch public settings' }, { status: 500 });
  }
}
