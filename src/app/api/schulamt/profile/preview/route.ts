import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { onboardingProfileSchema } from "@/lib/onboarding";
import { generateProfilePreview } from "@/lib/profilePreview";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== "SCHULAMT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = onboardingProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Ungültige Profildaten." }, { status: 400 });
  }

  try {
    const profileUrls = [
      { url: parsed.data.logoUrl || null, purpose: "logo" },
      { url: parsed.data.signatureUrl || null, purpose: "signature" },
    ].filter((asset): asset is { url: string; purpose: string } => Boolean(asset.url));
    if (profileUrls.length) {
      const owned = await prisma.uploadedAsset.findMany({
        where: {
          ownerUserId: userSession.id,
          OR: profileUrls.map((asset) => ({ url: asset.url, purpose: asset.purpose })),
        },
        select: { url: true, purpose: true },
      });
      if (owned.length !== profileUrls.length) {
        return NextResponse.json({ error: "Die Vorschau darf nur eigene hochgeladene Dateien verwenden." }, { status: 400 });
      }
    }
    const output = await generateProfilePreview(parsed.data);
    return new NextResponse(output, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=\"Vorschau.pdf\"",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Error generating preview PDF:", error);
    return NextResponse.json({ error: "Die PDF-Vorschau konnte nicht erstellt werden." }, { status: 500 });
  }
}
