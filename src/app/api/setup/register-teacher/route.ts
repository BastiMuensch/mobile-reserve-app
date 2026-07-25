export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getCurrentSchoolYear } from '@/lib/schoolYear';
import { createRateLimiter, getClientIp } from '@/lib/rateLimit';

// This is a public, unauthenticated endpoint that creates user rows and
// triggers an external geocoding request per call, so it needs an IP limit.
const ipLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxAttempts: 5 });

const GENERIC_REGISTRATION_ERROR = 'Registrierung nicht möglich. Bitte überprüfen Sie Ihre Angaben oder versuchen Sie es später erneut.';

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const { success: ipAllowed } = ipLimiter.check(ip);
    if (!ipAllowed) {
      return NextResponse.json(
        { error: 'Zu viele Registrierungsversuche von dieser Adresse. Bitte versuchen Sie es später erneut.' },
        { status: 429 }
      );
    }

    const data = await request.json();

    const RegisterSchema = z.object({
      name: z.string().min(1, 'Name ist erforderlich'),
      email: z.string().email('Ungültige E-Mail Adresse'),
      password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen lang sein'),
      stammschuleId: z.string().uuid('Ungültige Schul-ID'),
      address: z.string().min(1, 'Adresse ist erforderlich'),
      qualifications: z.string().min(1, 'Qualifikationen sind erforderlich'),
      preferredType: z.enum(['GRUNDSCHULE', 'MITTELSCHULE', 'BOTH']),
      isPartTime: z.boolean(),
      schedule: z.any().optional().nullable(),
      maxWeeklyHours: z.union([z.string(), z.number()]).transform(v => parseInt(v as string)),
      homeLat: z.number().optional(),
      homeLng: z.number().optional(),
    });

    const parsedData = RegisterSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const validatedData = parsedData.data;

    // Check if email is already taken. To avoid leaking which addresses are
    // already registered, we don't return a distinct error here — we just
    // skip creating a duplicate user and fall through to the same generic
    // response as any other failure.
    const existingUser = await prisma.user.findUnique({
      where: { email: validatedData.email.toLowerCase() }
    });
    if (existingUser) {
      return NextResponse.json({ error: GENERIC_REGISTRATION_ERROR }, { status: 400 });
    }

    // Geocode address if no lat/lng is provided
    let lat = validatedData.homeLat || 48.01;
    let lng = validatedData.homeLng || 10.5;

    if (!validatedData.homeLat || !validatedData.homeLng) {
      let geo: unknown;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(validatedData.address)}`, {
          headers: { 'User-Agent': 'MobileReservenApp/1.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          return NextResponse.json({ error: 'Adresse konnte derzeit nicht überprüft werden. Bitte versuchen Sie es später erneut.' }, { status: 503 });
        }
        geo = await res.json();
      } catch (geoError) {
        console.error('Geocoding request failed:', geoError);
        return NextResponse.json({ error: 'Adresse konnte derzeit nicht überprüft werden. Bitte versuchen Sie es später erneut.' }, { status: 503 });
      }

      if (Array.isArray(geo) && geo.length > 0 && geo[0]?.lat && geo[0]?.lon) {
        lat = parseFloat(geo[0].lat);
        lng = parseFloat(geo[0].lon);
      } else {
        return NextResponse.json({ error: 'Adresse konnte nicht gefunden werden.' }, { status: 400 });
      }
    }

    // Create User
    const hashedPassword = await bcrypt.hash(validatedData.password, 10);
    const newUser = await prisma.user.create({
      data: {
        email: validatedData.email.toLowerCase(),
        password: hashedPassword,
        name: validatedData.name,
        role: 'TEACHER',
      }
    });

    // Create Teacher (with PENDING status)
    const newTeacher = await prisma.teacher.create({
      data: {
        name: validatedData.name,
        email: validatedData.email.toLowerCase(),
        stammschuleId: validatedData.stammschuleId,
        userId: newUser.id,
        status: 'PENDING', // They are not active yet
        address: validatedData.address,
        homeLat: lat,
        homeLng: lng,
        qualifications: validatedData.qualifications,
        preferredType: validatedData.preferredType,
        isPartTime: validatedData.isPartTime,
        schedule: validatedData.isPartTime && validatedData.schedule ? JSON.stringify(validatedData.schedule) : null,
        maxWeeklyHours: validatedData.maxWeeklyHours,
        schoolYear: getCurrentSchoolYear(),
      }
    });

    return NextResponse.json({ success: true, teacherId: newTeacher.id });
  } catch (error) {
    console.error('Failed to register teacher:', error);
    return NextResponse.json({ error: 'Registrierung fehlgeschlagen. Bitte versuchen Sie es später noch einmal.' }, { status: 500 });
  }
}
