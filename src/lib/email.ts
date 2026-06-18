import { prisma } from './prisma';
import nodemailer from 'nodemailer';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function sendEmail(to: string, subject: string, body: string, schulamtId?: string) {
  // Sanitize subject to prevent email header injection
  subject = subject.replace(/[\r\n]/g, '');

  try {
    if (!to) {
      console.warn("sendEmail: No recipient address provided.");
      return false;
    }
    
    let host, user, pass;

    // Try to get tenant-specific settings first
    if (schulamtId) {
      const profile = await prisma.schulamtProfile.findUnique({
        where: { userId: schulamtId }
      });
      if (profile && profile.smtpHost && profile.smtpUser && profile.smtpPass) {
        host = profile.smtpHost;
        user = profile.smtpUser;
        pass = profile.smtpPass;
      }
    }

    // Fallback to global settings if tenant settings are incomplete
    if (!host || !user || !pass) {
      const settings = await prisma.systemSetting.findMany();
      const settingsObj = settings.reduce((acc, curr) => {
        acc[curr.id] = curr.value;
        return acc;
      }, {} as Record<string, string>);

      host = settingsObj['smtpHost'];
      user = settingsObj['smtpUser'];
      pass = settingsObj['smtpPass'];
    }

    if (!host || !user || !pass) {
      console.warn("sendEmail: Incomplete SMTP configuration. Missing host, user, or pass.");
      return false;
    }

    const transporter = nodemailer.createTransport({
      host,
      port: 587,
      secure: false, // use TLS
      auth: {
        user,
        pass,
      },
    });

    await transporter.sendMail({
      from: `"Mobile Reserven System" <${user}>`,
      to,
      subject,
      text: body,
      html: `<div style="font-family: sans-serif; padding: 20px; color: #333;">
              <h2 style="color: #4f46e5;">Mobile Reserven Update</h2>
              <p style="white-space: pre-wrap;">${escapeHtml(body)}</p>
             </div>`
    });

    return true;
  } catch (error) {
    console.error(`Failed to send email to "${to}" with subject "${subject}":`, error);
    return false;
  }
}
