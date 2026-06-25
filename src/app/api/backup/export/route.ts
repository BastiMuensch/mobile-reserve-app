import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { generateBackupData } from '@/lib/backup';
export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const schulamtId = userSession.id;
    const backupData = await generateBackupData(schulamtId);

    // Update lastBackupDate in SchulamtProfile
    await prisma.schulamtProfile.update({
      where: { userId: schulamtId },
      data: { lastBackupDate: new Date() }
    });

    return new NextResponse(JSON.stringify(backupData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="schulamt_backup_${new Date().toISOString().split('T')[0]}.json"`
      }
    });

  } catch (error) {
    console.error('Backup export failed:', error);
    return NextResponse.json({ error: 'Backup Export fehlgeschlagen', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
