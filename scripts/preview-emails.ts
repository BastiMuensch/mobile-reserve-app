// Offline preview with synthetic data only. No database or SMTP connections.
// Run: node --import tsx scripts/preview-emails.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { buildUnfilledEmail } from '../src/lib/requestEmail';
import { renderEmailHtml } from '../src/lib/emailTemplate';
import { enqueueAssignmentEmailsInTransaction } from '../src/lib/assignService';
import { revealSecret } from '../src/lib/secrets';

async function main() {
  const output = resolve('output/email-preview');
  await mkdir(output, { recursive: true });
  const request = {
    id: '4fd3aca7-819b-4361-89d8-35b656254b00',
    substitutedTeacher: 'Anna Beispiel', className: '3b', date: new Date('2026-11-09'), endDate: new Date('2026-11-13'),
    school: { name: 'Grundschule am Park', address: 'Schulstraße 12, 80331 München', user: { id: 'preview-school', email: 'schule@example.invalid' } },
    schoolType: 'GRUNDSCHULE', startHour: 1, comments: 'Bitte melden Sie sich vor Unterrichtsbeginn im Sekretariat. Die Unterrichtsmaterialien liegen im Klassenzimmer bereit.',
  };
  const refusal = buildUnfilledEmail(request, [{ date: '2026-11-10', hours: 5 }], 'Für diesen Tag sind alle verfügbaren Mobilen Reserven bereits im Einsatz.');
  await writeFile(resolve(output, 'absage.html'), renderEmailHtml(refusal.subject, refusal.body));
  await writeFile(resolve(output, 'absage.txt'), `${refusal.subject}\n\n${refusal.body}`);

  const previous = { DEMO_MODE: process.env.DEMO_MODE, SMTP_ENCRYPTION_KEY: process.env.SMTP_ENCRYPTION_KEY };
  process.env.DEMO_MODE = 'false';
  process.env.SMTP_ENCRYPTION_KEY = Buffer.alloc(32, 47).toString('base64');
  try {
    const tx = {
      systemSetting: { findUnique: async () => null },
      schulamtProfile: { findUnique: async () => ({ mailProvider: 'SMTP' }) },
      assignment: { findMany: async () => [] },
      emailOutbox: { create: async ({ data }: { data: { payloadEncrypted: string } }) => {
        const mail = JSON.parse(revealSecret(data.payloadEncrypted));
        const name = mail.to === 'reserve@example.invalid' ? 'einsatz' : 'zuweisung-schule';
        await writeFile(resolve(output, `${name}.html`), renderEmailHtml(mail.subject, mail.body));
        await writeFile(resolve(output, `${name}.txt`), `${mail.subject}\n\n${mail.body}`);
        return { id: `preview-${name}` };
      } },
    } as unknown as Prisma.TransactionClient;
    await enqueueAssignmentEmailsInTransaction(tx, {
      teacher: { id: 'preview-reserve', name: 'Maria Muster', email: 'reserve@example.invalid', userId: null },
      request, entries: [{ date: '2026-11-11', hours: 4, lessonHours: '[1,2,3,4]' }, { date: '2026-11-12', hours: 3, lessonHours: '[2,3,4]' }],
      schulamtId: 'preview-office',
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  console.log(`E-Mail-Vorschauen: ${output}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
