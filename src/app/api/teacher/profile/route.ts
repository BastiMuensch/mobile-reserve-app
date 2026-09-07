import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { teacherSelfProfileSchema } from "@/lib/teacherSelfProfile";
import { getCurrentSchoolYear } from "@/lib/schoolYear";
import { selectTeacherProfileRow } from "@/lib/teacherProfileSelection";

const teacherSelect = {
  id: true,
  address: true,
  postalCode: true,
  homeLat: true,
  homeLng: true,
  phone: true,
  schoolYear: true,
} as const;

export async function GET() {
  const session = await getSessionUser();
  if (!session || session.role !== "TEACHER") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teachers = await prisma.teacher.findMany({
    where: { userId: session.id },
    orderBy: { schoolYear: "desc" },
    select: teacherSelect,
  });
  const teacher = selectTeacherProfileRow(teachers, getCurrentSchoolYear());
  if (!teacher) return NextResponse.json({ error: "Lehrkraftprofil nicht gefunden." }, { status: 404 });
  return NextResponse.json(teacher, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const session = await getSessionUser();
  if (!session || session.role !== "TEACHER") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = teacherSelfProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Ungültige Profildaten." }, { status: 400 });

  const profile = parsed.data;
  const result = await prisma.teacher.updateMany({
    // A login identity can span copied school-year rows. Contact and home
    // location are person data, so keep each of those rows in sync.
    where: { userId: session.id },
    data: { address: profile.address, postalCode: profile.postalCode, homeLat: profile.homeLat, homeLng: profile.homeLng, phone: profile.phone || null },
  });
  if (result.count === 0) return NextResponse.json({ error: "Lehrkraftprofil nicht gefunden." }, { status: 404 });
  return NextResponse.json({ success: true, updatedRows: result.count });
}
