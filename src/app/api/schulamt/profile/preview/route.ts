import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { onboardingProfileSchema } from "@/lib/onboarding";
import { generateProfilePreview } from "@/lib/profilePreview";

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
    const output = await generateProfilePreview(parsed.data);
    return new NextResponse(output, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=\"Vorschau.pdf\"",
      },
    });
  } catch (error) {
    console.error("Error generating preview PDF:", error);
    return NextResponse.json({ error: "Die PDF-Vorschau konnte nicht erstellt werden." }, { status: 500 });
  }
}
