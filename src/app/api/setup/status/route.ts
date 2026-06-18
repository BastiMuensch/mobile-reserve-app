import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const adminCount = await prisma.user.count({
      where: {
        role: "ADMIN"
      }
    });

    return NextResponse.json({ needsSetup: adminCount === 0 });
  } catch (error) {
    console.error("Error checking setup status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
