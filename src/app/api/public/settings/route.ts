import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isLocalLoginLogoUrl, PUBLIC_INSTANCE_SETTING_IDS, settingsFromRecords } from '@/lib/publicInstanceSettings';

export async function GET() {
  try {
    // Bewusst nur unkritische, für den Login-Screen nötige Werte – diese Route ist
    // öffentlich erreichbar. loginLogoUrl ist instanzweit (nicht pro Schulamt), weil vor
    // der Anmeldung noch nicht feststeht, um welches Schulamt es geht.
    const settings = await prisma.systemSetting.findMany({
      where: {
        id: { in: [...PUBLIC_INSTANCE_SETTING_IDS] }
      }
    });
    
    const publicSettings = settingsFromRecords(settings);
    // Existing installations may contain settings written before validation was
    // introduced. Never turn a legacy arbitrary URL into a public image source.
    if (publicSettings.loginLogoUrl && !isLocalLoginLogoUrl(publicSettings.loginLogoUrl)) {
      publicSettings.loginLogoUrl = "";
      publicSettings.loginLogoAlt = "";
    }
    return NextResponse.json(publicSettings);
  } catch (error) {
    console.error('Failed to fetch public settings:', error);
    return NextResponse.json({ error: 'Failed to fetch public settings' }, { status: 500 });
  }
}
