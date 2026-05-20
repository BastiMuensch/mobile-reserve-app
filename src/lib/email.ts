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

export async function sendEmail(to: string, subject: string, body: string) {
  try {
    if (!to) {
      console.warn("sendEmail: No recipient address provided.");
      return false;
    }
    // Get settings
    const settings = await prisma.systemSetting.findMany();
    const settingsObj = settings.reduce((acc, curr) => {
      acc[curr.id] = curr.value;
      return acc;
    }, {} as Record<string, string>);

    const host = settingsObj['smtpHost'];
    const user = settingsObj['smtpUser'];
    const pass = settingsObj['smtpPass'];

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
    console.error('Failed to send email:', error);
    return false;
  }
}
