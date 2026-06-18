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
          headerText: "Staatliche Schulämter im Landkreis Unterallgäu und in der Stadt Memmingen",
          returnAddress: "Staatliches Schulamt Unterallgäu - Memminger Str. 18 - 87719 Mindelheim",
          logoUrl: null,
          contactAddress: "Memminger Str. 18\n87719 Mindelheim\nTelefon 08261 995 341\nTelefax 08261 995 383",
          contactPerson: "Tamara Schmidt\nDurchwahl: 08261 995 441\nSchA\nschulamts@lra.unterallgaeu.de\nwww.schulamt.mm.unterallgaeu.de",
          city: "Mindelheim",
          amtsleitungName: "Ursula Abt",
          amtsleitungTitle: "Schulamtsdirektorin",
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

    const data: any = {
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
