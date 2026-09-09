import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';
import { createDeploymentProof } from '../src/lib/deploymentProof';
import { generateIcalEvent } from '../src/lib/email';

test('Nodemailer stream transport serializes application calendar and PDF attachments offline', async () => {
  const calendar = generateIcalEvent([{
    start: new Date('2026-09-14T08:00:00.000Z'),
    end: new Date('2026-09-14T11:00:00.000Z'),
    summary: 'Mobile Reserve',
    description: 'Vertretung, Raum 2',
    location: 'Musterstraße 1',
  }]);
  const proof = await createDeploymentProof({
    teacher: { name: 'Ada Beispiel', address: 'Beispielweg 4, 80333 München', stammschule: { name: 'Stammschule', address: 'Stammweg 1' } },
    school: { name: 'Zielschule', address: 'Zielweg 2' },
    profile: {
      headerText: 'Schulamt Musterstadt', returnAddress: 'Postfach 1', contactAddress: 'Musterplatz 1', contactPerson: 'Max Mustermann', city: 'Musterstadt',
      documentSubject: 'Einsatznachweis', documentIntro: 'Vielen Dank für Ihren Einsatz.', documentClosing: 'Mit freundlichen Grüßen', amtsleitungName: 'Max Mustermann', amtsleitungTitle: 'Amtsleitung', logoUrl: null, signatureUrl: null,
    },
    assignments: [{ id: 'assignment-1', date: '2026-09-14', hours: 3, status: 'ACCEPTED' }],
    substitutedTeacher: 'Erika Vertretung', priority: 'UNPLANNED_ABSENCE', now: new Date('2026-09-01T00:00:00.000Z'),
  });

  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const info = await transport.sendMail({
    from: 'Mobile Reserve <office@example.test>',
    to: 'teacher@example.test',
    subject: 'Einsatzunterlagen',
    text: 'Im Anhang finden Sie Kalender und Einsatznachweis.',
    attachments: [
      { filename: 'einsatz.ics', content: calendar, contentType: 'text/calendar; charset=utf-8' },
      { filename: 'einsatznachweis.pdf', content: Buffer.from(proof.output('arraybuffer')), contentType: 'application/pdf' },
    ],
  });

  assert.ok(Buffer.isBuffer(info.message));
  const mime = info.message.toString('utf8');
  assert.match(mime, /filename=einsatz\.ics/);
  assert.match(mime, /text\/calendar; charset=utf-8/);
  assert.match(mime, /filename=einsatznachweis\.pdf/);
  assert.match(mime, /application\/pdf/);
  assert.match(calendar, /BEGIN:VCALENDAR/);
  assert.match(Buffer.from(proof.output('arraybuffer')).toString('ascii', 0, 5), /^%PDF-/);
});
