import { prisma } from './prisma';
import { isDemoMode } from './demoMode';
import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { protectSecret, revealSecret, secretNeedsReencryption } from './secrets';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

import { enqueueAndSendEmail, enqueueAndSendEmailWithStatus, type EmailQueueResult } from './emailOutbox';

export async function sendEmail(
  to: string, 
  subject: string, 
  body: string, 
  schulamtId?: string,
  attachments?: { filename: string, content: string, contentType?: string }[]
): Promise<boolean> {
  return enqueueAndSendEmail(to, subject, body, schulamtId, attachments);
}

/**
 * Use this where the HTTP response should distinguish an immediate SMTP
 * delivery from a durable queued retry. Existing callers keep sendEmail's
 * boolean for backwards compatibility.
 */
export async function sendEmailWithStatus(
  to: string,
  subject: string,
  body: string,
  schulamtId?: string,
  attachments?: { filename: string, content: string, contentType?: string }[],
): Promise<EmailQueueResult> {
  return enqueueAndSendEmailWithStatus(to, subject, body, schulamtId, attachments);
}

export async function sendEmailDirect(
  to: string,
  subject: string,
  body: string,
  schulamtId?: string,
  attachments?: { filename: string, content: string, contentType?: string }[]
): Promise<boolean> {
  // Sanitize subject to prevent email header injection
  subject = subject.replace(/[\r\n]/g, '');

  try {
    if (await isDemoMode()) return false;
    if (!to) {
      console.warn("sendEmailDirect: No recipient address provided.");
      return false;
    }
    
    let host, user, storedPass, fromName, fromAddress;
    let tenantProfileId: string | null = null;
    let port = 587;
    let secure = false;

    // Try to get tenant-specific settings first
    if (schulamtId) {
      const profile = await prisma.schulamtProfile.findUnique({
        where: { userId: schulamtId }
      });
      if (profile?.mailProvider === 'SMTP' && profile.smtpHost && profile.smtpUser && profile.smtpPass) {
        host = profile.smtpHost;
        user = profile.smtpUser;
        storedPass = profile.smtpPass;
        tenantProfileId = profile.id;
        port = profile.smtpPort ?? 587;
        secure = profile.smtpSecure;
        fromName = profile.smtpFromName || undefined;
        fromAddress = profile.smtpFromAddress || undefined;
      } else {
        console.warn('sendEmailDirect: Tenant mail provider is not configured.');
        return false;
      }
    }

    // Legacy global settings are used only for calls that do not belong to a tenant.
    if (!host || !user || !storedPass) {
      const settings = await prisma.systemSetting.findMany();
      const settingsObj = settings.reduce((acc, curr) => {
        acc[curr.id] = curr.value;
        return acc;
      }, {} as Record<string, string>);

      host = settingsObj['smtpHost'];
      user = settingsObj['smtpUser'];
      storedPass = settingsObj['smtpPass'];
    }

    if (!host || !user || !storedPass) {
      console.warn("sendEmailDirect: Incomplete SMTP configuration. Missing host, user, or pass.");
      return false;
    }

    const pass = revealSecret(storedPass);
    if (tenantProfileId && secretNeedsReencryption(storedPass)) {
      // Rückwärtskompatible Migration von Klartext oder dem vorherigen Schlüssel.
      await prisma.schulamtProfile.update({ where: { id: tenantProfileId }, data: { smtpPass: protectSecret(pass) } });
    } else if (!tenantProfileId && secretNeedsReencryption(storedPass)) {
      await prisma.systemSetting.update({ where: { id: 'smtpPass' }, data: { value: protectSecret(pass) } });
    }
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: {
        user,
        pass,
      },
    });

    await transporter.sendMail({
      from: `"${(fromName || 'Mobile Reserven System').replace(/[\r\n"]/g, '')}" <${fromAddress || user}>`,
      to,
      subject,
      text: body,
      html: `<div style="font-family: sans-serif; padding: 20px; color: #333;">
              <h2 style="color: #4f46e5;">Mobile Reserven Update</h2>
              <p style="white-space: pre-wrap;">${escapeHtml(body)}</p>
             </div>`,
      attachments
    });

    return true;
  } catch (error) {
    // Empfänger und Betreff sind personenbezogene Daten und gehören nicht in
    // zentrale Container-Logs oder externe Log-Aggregatoren.
    console.error('Direkter E-Mail-Versand über den konfigurierten SMTP-Server fehlgeschlagen:', error);
    return false;
  }
}

// RFC 5545 (iCalendar) TEXT escaping: Backslash MUSS zuerst escaped werden,
// da die nachfolgenden Ersetzungen sonst selbst wieder mit dem Backslash
// kollidieren würden. Danach Komma, Semikolon und Zeilenumbruch.
function escapeIcalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

export function generateIcalEvent(events: { start: Date; end: Date; summary: string; description: string; location: string }[]): string {
  const formatDate = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const vevents = events.map(options => {
    return [
      'BEGIN:VEVENT',
      `UID:${randomUUID()}@mobilereserve.de`,
      `DTSTAMP:${formatDate(new Date())}`,
      `DTSTART:${formatDate(options.start)}`,
      `DTEND:${formatDate(options.end)}`,
      `SUMMARY:${escapeIcalText(options.summary)}`,
      `DESCRIPTION:${escapeIcalText(options.description)}`,
      `LOCATION:${escapeIcalText(options.location)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT'
    ].join('\r\n');
  }).join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MobileReserve//App//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    vevents,
    'END:VCALENDAR'
  ].join('\r\n');
}
