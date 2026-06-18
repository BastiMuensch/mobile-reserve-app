import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const settings = await prisma.systemSetting.findMany({
      where: {
        id: { in: ['impressum'] }
      }
    });
    
    const settingsObj = settings.reduce((acc, curr) => {
      acc[curr.id] = curr.value;
      return acc;
    }, {} as Record<string, string>);

    return NextResponse.json(settingsObj);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch public settings' }, { status: 500 });
  }
}
