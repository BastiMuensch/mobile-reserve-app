import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { z } from 'zod';
import { protectSecret } from '@/lib/secrets';
import { BAYTGV_LEGAL_TEXT } from '@/lib/onboarding';

const uploadPath = z.string().regex(/^\/uploads\/[a-f0-9-]+\.(png|jpe?g)$/i).optional().nullable();
const profileSchema = z.object({
  headerText: z.string().trim().min(1).max(500),
  returnAddress: z.string().trim().min(1).max(500),
  contactAddress: z.string().trim().min(1).max(500),
  contactPerson: z.string().trim().min(1).max(500),
  city: z.string().trim().min(1).max(120),
  amtsleitungName: z.string().trim().min(1).max(200),
  amtsleitungTitle: z.string().trim().min(1).max(200),
  logoUrl: uploadPath,
  signatureUrl: uploadPath,
  documentSubject: z.string().trim().min(1).max(300),
  documentIntro: z.string().trim().min(1).max(1000),
  documentLegalText: z.string().trim().min(1).max(4000),
  documentClosing: z.string().trim().min(1).max(300),
  smtpEnabled: z.boolean().default(false),
  smtpHost: z.string().trim().max(255).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().default(false),
  smtpUser: z.string().trim().max(320).optional(),
  smtpPass: z.string().max(1000).optional(),
  smtpFromName: z.string().trim().max(200).optional(),
  smtpFromAddress: z.string().trim().email().optional().or(z.literal('')),
}).superRefine((value, ctx) => {
  if (!value.smtpEnabled) return;
  for (const key of ['smtpHost', 'smtpUser', 'smtpPass'] as const) {
    if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'SMTP Host, Benutzer und Passwort sind gemeinsam erforderlich.' });
  }
});

const schoolSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(500),
  type: z.enum(['GRUNDSCHULE', 'MITTELSCHULE']),
  email: z.string().trim().email(),
  password: z.string().min(12).max(200),
  isSmall: z.boolean().default(false),
});

const createSchulamtSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  password: z.string().min(12).max(200),
  profile: profileSchema,
  schools: z.array(schoolSchema).max(100).default([]),
}).superRefine((value, ctx) => {
  const emails = [value.email, ...value.schools.map(s => s.email)].map(email => email.toLowerCase());
  if (new Set(emails).size !== emails.length) {
    ctx.addIssue({ code: 'custom', path: ['schools'], message: 'Login-E-Mail-Adressen müssen eindeutig sein.' });
  }
});

async function geocodeAddress(address: string): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, {
      headers: { 'User-Agent': 'MobileReserve-App/1.0' },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || !data[0]?.lat || !data[0]?.lon) return null;
    const latitude = Number(data[0].lat);
    const longitude = Number(data[0].lon);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  } catch {
    return null;
  }
}

// GET: List all SCHULAMT users
export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const schulaemter = await prisma.user.findMany({
      where: { role: 'SCHULAMT' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
    return NextResponse.json(schulaemter);
  } catch (error) {
    console.error('GET /api/admin/schulaemter error:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

// POST: Create a new SCHULAMT user
export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = createSchulamtSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Ungültige Einrichtungsdaten.' }, { status: 400 });
    }
    const data = parsed.data;
    const email = data.email.toLowerCase();

    const officeCoordinates = await geocodeAddress(`${data.profile.contactAddress.replace(/\n/g, ' ')}, ${data.profile.city}`);
    const schoolsWithCoordinates: Array<z.infer<typeof schoolSchema> & { latitude: number; longitude: number }> = [];
    for (const school of data.schools) {
      const coordinates = await geocodeAddress(school.address);
      if (!coordinates) {
        return NextResponse.json({ error: `Adresse der Schule „${school.name}“ konnte nicht gefunden werden.` }, { status: 400 });
      }
      schoolsWithCoordinates.push({ ...school, ...coordinates });
    }

    const [hashedPassword, ...schoolPasswordHashes] = await Promise.all([
      bcrypt.hash(data.password, 12),
      ...data.schools.map(school => bcrypt.hash(school.password, 12)),
    ]);
    const protectedSmtpPass = data.profile.smtpEnabled && data.profile.smtpPass
      ? protectSecret(data.profile.smtpPass)
      : null;

    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          role: 'SCHULAMT',
          name: data.name,
          schulamtProfile: {
            create: {
              headerText: data.profile.headerText,
              returnAddress: data.profile.returnAddress,
              contactAddress: data.profile.contactAddress,
              contactPerson: data.profile.contactPerson,
              city: data.profile.city,
              amtsleitungName: data.profile.amtsleitungName,
              amtsleitungTitle: data.profile.amtsleitungTitle,
              logoUrl: data.profile.logoUrl || null,
              signatureUrl: data.profile.signatureUrl || null,
              documentSubject: data.profile.documentSubject,
              documentIntro: data.profile.documentIntro,
              documentLegalText: BAYTGV_LEGAL_TEXT,
              documentClosing: data.profile.documentClosing,
              mailProvider: data.profile.smtpEnabled ? 'SMTP' : 'NONE',
              latitude: officeCoordinates?.latitude ?? null,
              longitude: officeCoordinates?.longitude ?? null,
              smtpHost: data.profile.smtpEnabled ? data.profile.smtpHost : null,
              smtpPort: data.profile.smtpEnabled ? (data.profile.smtpPort ?? 587) : null,
              smtpSecure: data.profile.smtpEnabled ? data.profile.smtpSecure : false,
              smtpUser: data.profile.smtpEnabled ? data.profile.smtpUser : null,
              smtpPass: protectedSmtpPass,
              smtpFromName: data.profile.smtpEnabled ? (data.profile.smtpFromName || data.name) : null,
              smtpFromAddress: data.profile.smtpEnabled ? (data.profile.smtpFromAddress || data.profile.smtpUser) : null,
            },
          },
        },
        select: { id: true, email: true, name: true, role: true },
      });

      for (const [index, school] of schoolsWithCoordinates.entries()) {
        await tx.school.create({
          data: {
            name: school.name,
            address: school.address,
            type: school.type,
            latitude: school.latitude,
            longitude: school.longitude,
            isSmall: school.isSmall,
            schulamtId: created.id,
            user: {
              create: {
                email: school.email.toLowerCase(),
                password: schoolPasswordHashes[index],
                name: school.name,
                role: 'SCHOOL',
              },
            },
          },
        });
      }
      return created;
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}

// PATCH: Update password of a SCHULAMT user
export async function PATCH(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { userId, newPassword } = await request.json();
    if (!userId || !newPassword) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 12) {
      return NextResponse.json({ error: 'Passwort muss mindestens 12 Zeichen lang sein.' }, { status: 400 });
    }

    // Safety: only reset password for SCHULAMT users, never ADMIN
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.role !== 'SCHULAMT') {
      return NextResponse.json({ error: 'Kann nur Passwörter von Schulamts-Accounts zurücksetzen.' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword, sessionVersion: { increment: 1 } },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

// DELETE: Remove a SCHULAMT user
export async function DELETE(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { userId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Safety: only delete SCHULAMT users, never ADMIN
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.role !== 'SCHULAMT') {
      return NextResponse.json({ error: 'Kann nur Schulamts-Accounts löschen.' }, { status: 400 });
    }

    // School.schulamtId ist ON DELETE SET NULL: Ein Schulamt mit Schulen einfach zu löschen
    // würde dessen Schulen (samt Lehrkräften, Anforderungen, Einsätzen) verwaisen lassen –
    // sie blieben mit schulamtId = null in der Datenbank, für niemanden mehr sichtbar und
    // auch für die DSGVO-Bereinigung nicht mehr erreichbar. Deshalb verweigern wir das
    // Löschen, solange noch Schulen hängen, mit einer klaren Meldung statt stiller Waisen.
    const schoolCount = await prisma.school.count({ where: { schulamtId: userId } });
    if (schoolCount > 0) {
      return NextResponse.json({
        error: `Dieses Schulamt verwaltet noch ${schoolCount} Schule(n). Bitte zuerst diese Schulen (mit ihren Lehrkräften und Anforderungen) entfernen, bevor das Schulamt gelöscht werden kann.`,
      }, { status: 409 });
    }

    // SchulamtProfile, PasswordResetToken und PushSubscription hängen per ON DELETE CASCADE
    // am User und verschwinden mit ihm – ein leeres Schulamt lässt sich also sauber löschen.
    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
