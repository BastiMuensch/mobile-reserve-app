import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { geocodePostalCode, POSTAL_CODE_SCHEMA } from "@/lib/geocoding";
import { prisma } from "@/lib/prisma";
import { createRateLimiter, getClientIp } from "@/lib/rateLimit";
import { hashInvitationToken } from "@/lib/teacherInvitations";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxAttempts: 30 });
const requestSchema = z.object({
  postalCode: POSTAL_CODE_SCHEMA,
  token: z.string().min(32).max(200).optional(),
});

async function readSmallJsonBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 2_048) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return JSON.parse(body);
}

async function hasUsableInvitation(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const invitation = await prisma.teacherInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: { revokedAt: true, completedAt: true, expiresAt: true },
  });
  return Boolean(
    invitation &&
    !invitation.revokedAt &&
    !invitation.completedAt &&
    invitation.expiresAt > new Date(),
  );
}

export async function POST(request: Request) {
  const { success } = limiter.check(getClientIp(request));
  if (!success) {
    return NextResponse.json(
      { error: "Zu viele Standortabfragen. Bitte versuchen Sie es später erneut." },
      { status: 429, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await readSmallJsonBody(request);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
    return NextResponse.json(
      { error: tooLarge ? "Die Anfrage ist zu groß." : "Ungültige Eingaben." },
      { status: tooLarge ? 413 : 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Ungültige Eingaben." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const session = await getSessionUser();
    const authorizedBySession = session?.role === "SCHULAMT" || session?.role === "TEACHER";
    const authorizedByInvitation = authorizedBySession ? false : await hasUsableInvitation(parsed.data.token);
    if (!authorizedBySession && !authorizedByInvitation) {
      return NextResponse.json(
        { error: "Die Standortabfrage ist nicht berechtigt." },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const result = await geocodePostalCode(parsed.data.postalCode);
    if (result.status === "RESOLVED") {
      return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(
      { error: result.error },
      {
        status: result.status === "NOT_FOUND" ? 404 : 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    console.error("Postal-code geocoding failed:", error);
    return NextResponse.json(
      { error: "Die Standortabfrage ist derzeit nicht verfügbar." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
