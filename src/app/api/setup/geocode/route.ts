import { NextResponse } from "next/server";
import { z } from "zod";
import { geocodeAddress } from "@/lib/geocoding";
import { createRateLimiter, getClientIp } from "@/lib/rateLimit";
import { hasValidSetupToken } from "@/lib/setupToken";
import { prisma } from "@/lib/prisma";

const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 120 });
const requestSchema = z.object({
  setupToken: z.string().optional(),
  address: z.string().trim().min(5).max(500),
});

export async function POST(request: Request) {
  const { success } = limiter.check(getClientIp(request));
  if (!success) return NextResponse.json({ error: "Zu viele Standortabfragen. Bitte später erneut versuchen." }, { status: 429 });

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

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bitte geben Sie eine vollständige Adresse ein." }, { status: 400 });
  if (!hasValidSetupToken(parsed.data.setupToken)) return NextResponse.json({ error: "Ungültiger Einrichtungsschlüssel." }, { status: 403 });

  const result = await geocodeAddress(parsed.data.address);
  return NextResponse.json(result, { status: result.status === "UNAVAILABLE" ? 503 : result.status === "NOT_FOUND" ? 404 : 200 });
}
