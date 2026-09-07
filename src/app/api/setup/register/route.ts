import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRateLimiter, getClientIp } from "@/lib/rateLimit";
import { BAYTGV_LEGAL_TEXT, schulamtOnboardingSchema } from "@/lib/onboarding";
import { persistOnboardingImage, removePersistedImages } from "@/lib/imageUploads";
import { protectSecret } from "@/lib/secrets";
import { hasValidSetupToken } from "@/lib/setupToken";

const setupLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxAttempts: 10 });
const MAX_SETUP_REQUEST_BYTES = 12 * 1024 * 1024;

function hasPlausibleContentLength(request: Request): boolean {
  const value = request.headers.get("content-length");
  return Boolean(value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= MAX_SETUP_REQUEST_BYTES);
}

async function readRequest(request: Request): Promise<{ payload: unknown; logo: File | null; signature: File | null }> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return { payload: await request.json(), logo: null, signature: null };
  }

  const formData = await request.formData();
  const rawPayload = formData.get("payload");
  if (typeof rawPayload !== "string") throw new Error("INVALID_SETUP_PAYLOAD");
  return {
    payload: JSON.parse(rawPayload),
    logo: formData.get("logo") instanceof File ? formData.get("logo") as File : null,
    signature: formData.get("signature") instanceof File ? formData.get("signature") as File : null,
  };
}

export async function POST(request: Request) {
  const { success } = setupLimiter.check(getClientIp(request));
  if (!success) {
    return NextResponse.json({ error: "Zu viele Einrichtungsversuche. Bitte später erneut versuchen." }, { status: 429 });
  }
  if (!hasPlausibleContentLength(request)) {
    return NextResponse.json({ error: "Die Einrichtungsdaten sind zu groß oder enthalten keine gültige Content-Length." }, { status: 413 });
  }

  const persistedImages: Array<{ url: string; path: string } | null> = [];
  try {
    if (!hasValidSetupToken(request.headers.get("x-setup-token") || undefined)) {
      return NextResponse.json({ error: "Ungültiger Einrichtungsschlüssel oder SETUP_TOKEN fehlt auf dem Server." }, { status: 403 });
    }
    const { payload, logo, signature } = await readRequest(request);
    const parsed = schulamtOnboardingSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Ungültige Einrichtungsdaten." }, { status: 400 });
    }
    const data = parsed.data;
    if (!hasValidSetupToken(data.setupToken)) {
      return NextResponse.json({ error: "Ungültiger Einrichtungsschlüssel oder SETUP_TOKEN fehlt auf dem Server." }, { status: 403 });
    }

    const [existingMarker, existingUsers] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { id: "initialSetupCompleted" } }),
      prisma.user.count(),
    ]);
    if (existingMarker || existingUsers > 0) {
      return NextResponse.json({ error: "Die Ersteinrichtung ist bereits abgeschlossen oder diese Installation enthält bereits Konten." }, { status: 409 });
    }

    const logoImage = await persistOnboardingImage(logo);
    persistedImages.push(logoImage);
    const signatureImage = await persistOnboardingImage(signature, "private-signature");
    persistedImages.push(signatureImage);

    let protectedSmtpPass: string | null = null;
    if (data.profile.mailProvider === "SMTP") {
      try {
        protectedSmtpPass = protectSecret(data.profile.smtpPass);
      } catch (error) {
        console.error("SMTP encryption is not configured:", error);
        await removePersistedImages(persistedImages);
        return NextResponse.json({ error: "Der Server kann Mail-Zugangsdaten noch nicht sicher speichern. SMTP_ENCRYPTION_KEY fehlt oder ist ungültig." }, { status: 503 });
      }
    }

    const [schulamtPassword, ...schoolPasswords] = await Promise.all([
      bcrypt.hash(data.password, 12),
      ...data.schools.map((school) => bcrypt.hash(school.password, 12)),
    ]);

    const created = await prisma.$transaction(async (tx) => {
      // Auch innerhalb der serialisierbaren Transaktion prüfen: Eine Altinstallation
      // ohne den neuen Marker darf niemals ein zweites Schulamt per Setup erhalten.
      if (await tx.user.count() > 0) throw new Error("SETUP_NOT_EMPTY");
      await tx.systemSetting.create({
        data: { id: "initialSetupCompleted", value: new Date().toISOString() },
      });

      const schulamt = await tx.user.create({
        data: {
          name: data.name,
          email: data.email.toLowerCase(),
          password: schulamtPassword,
          role: "SCHULAMT",
          schulamtProfile: {
            create: {
              headerText: data.profile.headerText,
              returnAddress: data.profile.returnAddress,
              contactAddress: data.profile.contactAddress,
              contactPerson: data.profile.contactPerson,
              city: data.profile.city,
              amtsleitungName: data.profile.amtsleitungName,
              amtsleitungTitle: data.profile.amtsleitungTitle,
              latitude: data.profile.latitude ?? null,
              longitude: data.profile.longitude ?? null,
              logoUrl: logoImage?.url ?? null,
              signatureUrl: signatureImage?.url ?? null,
              documentSubject: data.profile.documentSubject,
              documentIntro: data.profile.documentIntro,
              documentLegalText: BAYTGV_LEGAL_TEXT,
              documentClosing: data.profile.documentClosing,
              mailProvider: data.profile.mailProvider,
              smtpHost: data.profile.mailProvider === "SMTP" ? data.profile.smtpHost : null,
              smtpPort: data.profile.mailProvider === "SMTP" ? data.profile.smtpPort : null,
              smtpSecure: data.profile.mailProvider === "SMTP" ? data.profile.smtpSecure : false,
              smtpUser: data.profile.mailProvider === "SMTP" ? data.profile.smtpUser : null,
              smtpPass: protectedSmtpPass,
              smtpFromName: data.profile.mailProvider === "SMTP" ? data.profile.smtpFromName : null,
              smtpFromAddress: data.profile.mailProvider === "SMTP" ? data.profile.smtpFromAddress : null,
              teacherInviteValidityDays: data.profile.teacherInviteValidityDays,
            },
          },
        },
        select: { id: true, email: true, role: true },
      });

      // The files have been written before the transaction so a failed setup can
      // remove them. Create their ownership records in the same transaction as
      // the account/profile; an uploaded signature can never become a freely
      // claimable orphan.
      const setupAssets = [
        logoImage ? { ownerUserId: schulamt.id, url: logoImage.url, purpose: "logo" } : null,
        signatureImage ? { ownerUserId: schulamt.id, url: signatureImage.url, purpose: "signature" } : null,
      ].filter((asset): asset is { ownerUserId: string; url: string; purpose: string } => asset !== null);
      if (setupAssets.length) {
        await tx.uploadedAsset.createMany({ data: setupAssets });
      }

      for (const [index, school] of data.schools.entries()) {
        const hasCoordinates = school.latitude != null && school.longitude != null;
        await tx.school.create({
          data: {
            name: school.name,
            address: school.address,
            type: school.type,
            latitude: school.latitude ?? null,
            longitude: school.longitude ?? null,
            geocodingStatus: hasCoordinates
              ? (school.geocodingStatus === "MANUAL" ? "MANUAL" : "RESOLVED")
              : "PENDING",
            geocodingLastAttemptAt: hasCoordinates ? new Date() : null,
            geocodingError: hasCoordinates ? null : "Standort wird nach der Einrichtung automatisch ermittelt.",
            isSmall: school.isSmall,
            schulamtId: schulamt.id,
            user: {
              create: {
                name: school.name,
                email: school.email.toLowerCase(),
                password: schoolPasswords[index],
                role: "SCHOOL",
              },
            },
          },
        });
      }
      return schulamt;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({
      success: true,
      user: created,
      geocodingPending: data.schools.filter((school) => school.latitude == null).map((school) => school.name),
    }, { status: 201 });
  } catch (error) {
    await removePersistedImages(persistedImages);
    if (error instanceof SyntaxError || (error instanceof Error && error.message === "INVALID_SETUP_PAYLOAD")) {
      return NextResponse.json({ error: "Ungültige Einrichtungsdaten." }, { status: 400 });
    }
    if (error instanceof Error && error.message === "SETUP_NOT_EMPTY") {
      return NextResponse.json({ error: "Diese Installation enthält bereits Konten und kann nicht erneut eingerichtet werden." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        const marker = await prisma.systemSetting.findUnique({ where: { id: "initialSetupCompleted" } }).catch(() => null);
        return NextResponse.json({
          error: marker ? "Die Ersteinrichtung wurde bereits abgeschlossen." : "Eine der E-Mail-Adressen wird bereits verwendet.",
        }, { status: 409 });
      }
      if (error.code === "P2034") {
        return NextResponse.json({ error: "Die Einrichtung wurde gleichzeitig in einem anderen Fenster abgeschlossen. Bitte laden Sie die Seite neu." }, { status: 409 });
      }
    }
    console.error("Initial setup failed:", error);
    return NextResponse.json({ error: "Die Ersteinrichtung konnte nicht abgeschlossen werden." }, { status: 500 });
  }
}
