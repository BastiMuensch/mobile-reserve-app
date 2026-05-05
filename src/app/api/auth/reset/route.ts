import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { sendEmail } from '@/lib/email';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'E-Mail ist erforderlich' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      // Return success anyway to prevent email enumeration
      return NextResponse.json({ success: true, message: 'Falls ein Konto mit dieser E-Mail existiert, wurde eine E-Mail gesendet.' });
    }

    // Generate a secure temporary password
    const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
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
