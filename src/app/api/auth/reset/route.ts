import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { sendEmail } from '@/lib/email';
import crypto from 'crypto';

// Rate limiter for password reset
const resetAttempts = new Map<string, { count: number; firstAttempt: number }>();
const MAX_RESET_ATTEMPTS = 3;
const RESET_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'E-Mail ist erforderlich' }, { status: 400 });
    }

    // Rate limit check
    const key = email.toLowerCase();
    const now = Date.now();
    const entry = resetAttempts.get(key);
    if (entry && now - entry.firstAttempt < RESET_WINDOW_MS && entry.count >= MAX_RESET_ATTEMPTS) {
      return NextResponse.json({ success: true, message: 'Falls ein Konto mit dieser E-Mail existiert, wurde eine E-Mail gesendet.' });
    }
    if (!entry || now - entry.firstAttempt > RESET_WINDOW_MS) {
      resetAttempts.set(key, { count: 1, firstAttempt: now });
    } else {
      entry.count++;
    }

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      // Return success anyway to prevent email enumeration
      return NextResponse.json({ success: true, message: 'Falls ein Konto mit dieser E-Mail existiert, wurde eine E-Mail gesendet.' });
    }

    // Generate a cryptographically secure temporary password
    const tempPassword = crypto.randomBytes(12).toString('base64url');
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // Update user
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    // Send email
    const emailBody = `Hallo,\n\nIhr Passwort für das Mobile Reserven Portal wurde zurückgesetzt.\n\nIhr neues temporäres Passwort lautet:\n\n${tempPassword}\n\nBitte loggen Sie sich damit ein. (Die Funktion zum Ändern des Passworts wird bald im Dashboard verfügbar sein).`;
    
    await sendEmail(
      user.email,
      'Passwort zurücksetzen - Mobile Reserven',
      emailBody
    );

    return NextResponse.json({ success: true, message: 'Falls ein Konto mit dieser E-Mail existiert, wurde eine E-Mail gesendet.' });
  } catch (error) {
    console.error('Password reset error:', error);
    return NextResponse.json({ error: 'Ein Fehler ist aufgetreten' }, { status: 500 });
  }
}
