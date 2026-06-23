import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateBackupData } from '@/lib/backup';
import { sendEmail } from '@/lib/email';

export async function POST(request: Request) {
  // 1. Authentifizierung prüfen
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('CRON_SECRET is not configured in environment variables.');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 2. Alle Schulämter finden, die das Auto-Backup aktiviert haben
    const profiles = await prisma.schulamtProfile.findMany({
      where: {
        autoBackupEnabled: true,
        autoBackupEmail: { not: null }
      }
    });

    let successCount = 0;
    let failCount = 0;

    // 3. Für jedes Schulamt das Backup generieren und senden
    for (const profile of profiles) {
      if (!profile.autoBackupEmail) continue;

      try {
        const backupData = await generateBackupData(profile.userId);
        const jsonString = JSON.stringify(backupData, null, 2);
        
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `schulamt_backup_${dateStr}.json`;

        const emailBody = `Guten Tag,\n\nanbei erhalten Sie das automatische, tägliche Backup Ihres Schulamts-Accounts.\nBitte bewahren Sie diese Datei sicher auf. Sie kann im Notfall im Admin-Panel zur vollständigen Wiederherstellung Ihrer Daten genutzt werden.\n\nMit freundlichen Grüßen\nIhr Mobile Reserven System`;

        const sent = await sendEmail(
          profile.autoBackupEmail,
          `Automatisches System-Backup (${dateStr})`,
          emailBody,
          profile.userId,
          [{
            filename,
            content: jsonString,
            contentType: 'application/json'
          }]
        );

        if (sent) {
          successCount++;
        } else {
          console.error(`Failed to send backup email for Schulamt ${profile.userId}`);
          failCount++;
        }
      } catch (err) {
        console.error(`Error processing backup for Schulamt ${profile.userId}:`, err);
        failCount++;
      }
    }

    return NextResponse.json({
      message: 'Cronjob executed successfully',
      processed: profiles.length,
      successCount,
      failCount
    });

  } catch (error) {
    console.error('Backup cronjob failed:', error);
    return NextResponse.json({ error: 'Cronjob failed' }, { status: 500 });
  }
}
