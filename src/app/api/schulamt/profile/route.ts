import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';

const MAX_FIELD_LENGTH = 500;
const URL_PATH_PATTERN = /^\/uploads\/[a-f0-9-]+\.(png|jpg|jpeg|gif|webp|svg)$/i;

function validateProfileInput(body: Record<string, unknown>): { valid: boolean; error?: string } {
  const requiredStrings = ['headerText', 'returnAddress', 'contactAddress', 'contactPerson', 'city', 'amtsleitungName', 'amtsleitungTitle'];
  
  for (const field of requiredStrings) {
    const val = body[field];
    if (typeof val !== 'string' || val.trim().length === 0) {
      return { valid: false, error: `Feld "${field}" ist erforderlich.` };
    }
    if (val.length > MAX_FIELD_LENGTH) {
      return { valid: false, error: `Feld "${field}" darf maximal ${MAX_FIELD_LENGTH} Zeichen lang sein.` };
    }
  }

  // logoUrl and signatureUrl are optional but must match upload path pattern if set
  for (const urlField of ['logoUrl', 'signatureUrl']) {
    const val = body[urlField];
    if (val !== null && val !== undefined && val !== '') {
      if (typeof val !== 'string') {
        return { valid: false, error: `Feld "${urlField}" muss ein String sein.` };
      }
      if (!URL_PATH_PATTERN.test(val)) {
        return { valid: false, error: `Feld "${urlField}" enthält einen ungültigen Pfad. Nur hochgeladene Dateien aus /uploads/ sind erlaubt.` };
      }
    }
  }

  return { valid: true };
}

export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Role check: only Schulamt managers and Admins may access profiles
  if (userSession.role !== 'SCHULAMT' && userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    let profile = await prisma.schulamtProfile.findUnique({
      where: { userId: userSession.id }
    });

    // If profile doesn't exist, create it with default fallback values
    if (!profile) {
      profile = await prisma.schulamtProfile.create({
        data: {
          userId: userSession.id,
          headerText: "Staatliches Schulamt Musterstadt",
          returnAddress: "Staatliches Schulamt Musterstadt - Musterstr. 1 - 12345 Musterstadt",
          logoUrl: null,
          contactAddress: "Musterstr. 1\n12345 Musterstadt\nTelefon 01234 56789",
          contactPerson: "Max Mustermann\nschulamt@musterstadt.de",
          city: "Musterstadt",
          amtsleitungName: "Max Mustermann",
          amtsleitungTitle: "Schulamtsdirektor/in",
          signatureUrl: null
        }
      });
    }

    // Mask SMTP password before returning
    const safeProfile = { ...profile };
    if (safeProfile.smtpPass) {
      safeProfile.smtpPass = '********';
    }

    return NextResponse.json(safeProfile);
  } catch (error) {
    console.error('Failed to get Schulamt profile:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Role check: only Schulamt managers and Admins may modify profiles
  if (userSession.role !== 'SCHULAMT' && userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();

    // Input validation
    const validation = validateProfileInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const {
      headerText,
      returnAddress,
      contactAddress,
      contactPerson,
      city,
      amtsleitungName,
      amtsleitungTitle,
      smtpHost,
      smtpUser,
      smtpPass,
    } = body;

    // Normalize empty URL strings to null
    const logoUrl = (typeof body.logoUrl === 'string' && body.logoUrl.trim() !== '') ? body.logoUrl.trim() : null;
    const signatureUrl = (typeof body.signatureUrl === 'string' && body.signatureUrl.trim() !== '') ? body.signatureUrl.trim() : null;

    const data: Record<string, string | number | null> = {
      headerText: (headerText as string).trim(),
      returnAddress: (returnAddress as string).trim(),
      logoUrl,
      contactAddress: (contactAddress as string).trim(),
      contactPerson: (contactPerson as string).trim(),
      city: (city as string).trim(),
      amtsleitungName: (amtsleitungName as string).trim(),
      amtsleitungTitle: (amtsleitungTitle as string).trim(),
      signatureUrl
    };

    if (smtpHost !== undefined) data.smtpHost = (smtpHost as string).trim();
    if (smtpUser !== undefined) data.smtpUser = (smtpUser as string).trim();
    if (smtpPass !== undefined && smtpPass !== '********') data.smtpPass = (smtpPass as string);

    if (body.latitude !== undefined) data.latitude = body.latitude as number | null;
    if (body.longitude !== undefined) data.longitude = body.longitude as number | null;

    // Geocode if address has changed and no manual coordinates provided
    const existingProfile = await prisma.schulamtProfile.findUnique({ where: { userId: userSession.id } });
    if (body.latitude === undefined && (!existingProfile || existingProfile.contactAddress !== data.contactAddress || !existingProfile.latitude)) {
      try {
        const queryAddress = (data.contactAddress as string).replace(/\n/g, ' ');
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryAddress)}`, {
          headers: { 'User-Agent': 'MobileReserve-App' }
        });
        if (res.ok) {
          const geoData = await res.json();
          if (geoData && geoData.length > 0) {
            data.latitude = parseFloat(geoData[0].lat);
            data.longitude = parseFloat(geoData[0].lon);
          }
        }
      } catch (err) {
        console.error('Failed to geocode Schulamt address during profile update', err);
      }
    }

    const profile = await prisma.schulamtProfile.upsert({
      where: { userId: userSession.id },
      update: data,
      create: { userId: userSession.id, ...data }
    });

    return NextResponse.json({ success: true, profile });
  } catch (error) {
    console.error('Failed to save Schulamt profile:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
