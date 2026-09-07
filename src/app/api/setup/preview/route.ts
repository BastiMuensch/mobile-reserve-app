import { NextResponse } from "next/server";
import { createRateLimiter, getClientIp } from "@/lib/rateLimit";
import { schulamtOnboardingSchema } from "@/lib/onboarding";
import { generateProfilePreview } from "@/lib/profilePreview";
import { hasValidSetupToken } from "@/lib/setupToken";
import { prisma } from "@/lib/prisma";

const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_SETUP_PREVIEW_BYTES = 12 * 1024 * 1024;

function hasPlausibleContentLength(request: Request): boolean {
  const value = request.headers.get("content-length");
  return Boolean(value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= MAX_SETUP_PREVIEW_BYTES);
}

async function readOptionalImage(value: FormDataEntryValue | null): Promise<Buffer | null> {
  if (!(value instanceof File) || value.size === 0) return null;
  if (!['image/png', 'image/jpeg'].includes(value.type) || value.size > MAX_IMAGE_SIZE) {
    throw new Error("INVALID_IMAGE");
  }
  return Buffer.from(await value.arrayBuffer());
}

export async function POST(request: Request) {
  const { success } = limiter.check(getClientIp(request));
  if (!success) return NextResponse.json({ error: "Zu viele Vorschauen. Bitte später erneut versuchen." }, { status: 429 });
  if (!hasPlausibleContentLength(request)) {
    return NextResponse.json({ error: "Die Vorschaudaten sind zu groß oder enthalten keine gültige Content-Length." }, { status: 413 });
  }

  try {
    if (!hasValidSetupToken(request.headers.get("x-setup-token") || undefined)) {
      return NextResponse.json({ error: "Ungültiger Einrichtungsschlüssel." }, { status: 403 });
    }
    const [marker, userCount] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { id: "initialSetupCompleted" }, select: { id: true } }),
      prisma.user.count(),
    ]);
    if (marker || userCount > 0) {
      return NextResponse.json({ error: "Die Ersteinrichtung ist bereits geschlossen." }, { status: 409 });
    }
    const formData = await request.formData();
    const rawPayload = formData.get("payload");
    if (typeof rawPayload !== "string") return NextResponse.json({ error: "Ungültige Vorschaudaten." }, { status: 400 });
    const parsed = schulamtOnboardingSchema.safeParse(JSON.parse(rawPayload));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Ungültige Vorschaudaten." }, { status: 400 });
    if (!hasValidSetupToken(parsed.data.setupToken)) return NextResponse.json({ error: "Ungültiger Einrichtungsschlüssel." }, { status: 403 });

    const [logo, signature] = await Promise.all([
      readOptionalImage(formData.get("logo")),
      readOptionalImage(formData.get("signature")),
    ]);
    // Setup previews use only the multipart files received in this request.
    // Never dereference a URL supplied in setup JSON; before setup there is no
    // authenticated owner for an existing private asset.
    const output = await generateProfilePreview(
      { ...parsed.data.profile, logoUrl: null, signatureUrl: null },
      { logo, signature },
    );
    return new NextResponse(output, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=\"Einrichtung-Vorschau.pdf\"",
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.message === "INVALID_IMAGE")) {
      return NextResponse.json({ error: "Ungültige Vorschau- oder Bilddaten." }, { status: 400 });
    }
    console.error("Initial setup preview failed:", error);
    return NextResponse.json({ error: "Die PDF-Vorschau konnte nicht erstellt werden." }, { status: 500 });
  }
}
