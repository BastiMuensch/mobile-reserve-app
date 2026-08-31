import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const [userCount, setupMarker] = await Promise.all([
      prisma.user.count(),
      prisma.systemSetting.findUnique({ where: { id: 'initialSetupCompleted' }, select: { value: true } }),
    ]);
    const setupTokenConfigured = Boolean(process.env.SETUP_TOKEN);

    return NextResponse.json({
      needsSetup: !setupMarker && userCount === 0,
      legacyInstallation: !setupMarker && userCount > 0,
      setupTokenRequired: setupTokenConfigured,
      setupBlocked: process.env.NODE_ENV === 'production' && !setupTokenConfigured,
    });
  } catch (error) {
    console.error("Error checking setup status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
