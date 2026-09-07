export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSchoolYear, getNextSchoolYear, schoolYearSchema } from "@/lib/schoolYear";
import {
  clampLeaveToTargetSchoolYear,
  existingIdentityKeysForTargetYear,
  identityKeys,
  MAX_TEACHERS_PER_COPY_BATCH,
  schoolYearDayBounds,
} from "@/lib/teacherCopy";

const copySchema = z.object({
  sourceYear: schoolYearSchema,
  targetYear: schoolYearSchema,
  teacherIds: z.array(z.string().uuid()).min(1, "Bitte wählen Sie mindestens eine Lehrkraft aus.").max(MAX_TEACHERS_PER_COPY_BATCH),
  copyLeaveTeacherIds: z.array(z.string().uuid()).max(MAX_TEACHERS_PER_COPY_BATCH).default([]),
}).superRefine((value, ctx) => {
  const selected = new Set(value.teacherIds);
  if (value.copyLeaveTeacherIds.some(id => !selected.has(id))) {
    ctx.addIssue({ code: "custom", path: ["copyLeaveTeacherIds"], message: "Abwesenheiten können nur für ausgewählte Lehrkräfte übernommen werden." });
  }
});

function validateTargetYear(targetYear: string): string | null {
  const parsed = schoolYearSchema.safeParse(targetYear);
  if (!parsed.success) return parsed.error.issues[0]?.message || "Ungültiges Ziel-Schuljahr.";
  if (targetYear !== getCurrentSchoolYear() && targetYear !== getNextSchoolYear()) {
    return "Lehrkräfte können nur in das aktuelle oder das nächste Schuljahr übernommen werden.";
  }
  return null;
}

function isEarlierSchoolYear(sourceYear: string, targetYear: string): boolean {
  return Number(sourceYear.slice(0, 4)) < Number(targetYear.slice(0, 4));
}

async function availableSourceYears(schulamtId: string, targetYear: string): Promise<string[]> {
  const rows = await prisma.teacher.findMany({
    where: { stammschule: { schulamtId } },
    distinct: ["schoolYear"],
    select: { schoolYear: true },
  });
  return rows
    .map(row => row.schoolYear)
    .filter(year => schoolYearSchema.safeParse(year).success && isEarlierSchoolYear(year, targetYear))
    .sort((a, b) => b.localeCompare(a));
}

export async function GET(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== "SCHULAMT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const targetYear = searchParams.get("targetYear") || "";
  const targetError = validateTargetYear(targetYear);
  if (targetError) return NextResponse.json({ error: targetError }, { status: 400 });

  try {
    const sourceYears = await availableSourceYears(userSession.id, targetYear);
    const requestedSourceYear = searchParams.get("sourceYear");
    const sourceYear = requestedSourceYear || sourceYears[0] || null;
    if (sourceYear && !sourceYears.includes(sourceYear)) {
      return NextResponse.json({ error: "Im gewählten Quell-Schuljahr wurden keine Lehrkräfte dieses Schulamts gefunden." }, { status: 400 });
    }
    if (!sourceYear) {
      return NextResponse.json({ sourceYears, sourceYear: null, targetYear, candidates: [] });
    }

    const { start: targetStart, end: targetEnd } = schoolYearDayBounds(targetYear);
    const [sourceTeachers, targetTeachers] = await Promise.all([
      prisma.teacher.findMany({
        where: { schoolYear: sourceYear, stammschule: { schulamtId: userSession.id } },
        include: {
          stammschule: { select: { name: true } },
          leavePeriods: {
            where: {
              startDate: { lte: targetEnd },
              OR: [{ endDate: null }, { endDate: { gte: targetStart } }],
            },
            orderBy: { startDate: "asc" },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.teacher.findMany({
        where: { schoolYear: targetYear, stammschule: { schulamtId: userSession.id } },
        select: { userId: true, email: true, name: true, stammschuleId: true, schoolYear: true },
      }),
    ]);

    const existingKeys = existingIdentityKeysForTargetYear(targetTeachers, targetYear);
    const candidates = sourceTeachers.map(teacher => {
      const alreadyExists = identityKeys(teacher).some(key => existingKeys.has(key));
      const isPending = teacher.status === "PENDING";
      return {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        schoolName: teacher.stammschule.name,
        sourceStatus: teacher.status,
        targetStatus: "ACTIVE" as const,
        alreadyExists,
        skipReason: isPending
          ? "Registrierung im Quelljahr noch nicht freigegeben."
          : alreadyExists
            ? "Im Zieljahr bereits vorhanden."
            : null,
        selectedByDefault: !isPending && !alreadyExists,
        ongoingLeavePeriods: teacher.leavePeriods,
      };
    });

    return NextResponse.json({ sourceYears, sourceYear, targetYear, candidates });
  } catch (error) {
    console.error("Teacher copy preview failed:", error);
    return NextResponse.json({ error: "Die Vorschau konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== "SCHULAMT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = copySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Ungültige Auswahl." }, { status: 400 });
  }
  const { sourceYear, targetYear } = parsed.data;
  const targetError = validateTargetYear(targetYear);
  if (targetError) return NextResponse.json({ error: targetError }, { status: 400 });
  if (!isEarlierSchoolYear(sourceYear, targetYear)) {
    return NextResponse.json({ error: "Das Quell-Schuljahr muss vor dem Ziel-Schuljahr liegen." }, { status: 400 });
  }

  const teacherIds = [...new Set(parsed.data.teacherIds)];
  const copyLeaveTeacherIds = new Set(parsed.data.copyLeaveTeacherIds);
  const { start: targetStart, end: targetEnd } = schoolYearDayBounds(targetYear);

  try {
    const result = await prisma.$transaction(async tx => {
      // Quelle und Ziel müssen in derselben serialisierbaren Transaktion gelesen
      // werden. Sonst könnte sich Status oder Mandantenzuordnung zwischen Prüfung
      // und Anlage ändern.
      const sourceTeachers = await tx.teacher.findMany({
        where: {
          id: { in: teacherIds },
          schoolYear: sourceYear,
          stammschule: { schulamtId: userSession.id },
        },
        include: {
          leavePeriods: {
            where: {
              startDate: { lte: targetEnd },
              OR: [{ endDate: null }, { endDate: { gte: targetStart } }],
            },
          },
        },
      });
      if (sourceTeachers.length !== teacherIds.length) {
        throw new InvalidSelectionError();
      }

      const targetTeachers = await tx.teacher.findMany({
        where: { schoolYear: targetYear, stammschule: { schulamtId: userSession.id } },
        select: { userId: true, email: true, name: true, stammschuleId: true, schoolYear: true },
      });
      const existingKeys = existingIdentityKeysForTargetYear(targetTeachers, targetYear);
      let skipped = 0;
      const eligibleSources: typeof sourceTeachers = [];

      for (const source of sourceTeachers) {
        const keys = identityKeys(source);
        if (source.status === "PENDING" || keys.some(key => existingKeys.has(key))) {
          skipped += 1;
          continue;
        }
        keys.forEach(key => existingKeys.add(key));
        eligibleSources.push(source);
      }

      const createdTeachers = eligibleSources.length > 0
        ? await tx.teacher.createManyAndReturn({
          data: eligibleSources.map(source => ({
            name: source.name,
            email: source.email,
            phone: source.phone,
            stammschuleId: source.stammschuleId,
            maxWeeklyHours: source.maxWeeklyHours,
            isPartTime: source.isPartTime,
            schedule: source.schedule,
            qualifications: source.qualifications,
            status: "ACTIVE",
            address: source.address,
            postalCode: source.postalCode,
            gender: source.gender,
            homeLat: source.homeLat,
            homeLng: source.homeLng,
            preferredType: source.preferredType,
            schoolYear: targetYear,
            userId: source.userId,
          })),
          select: { id: true, userId: true, email: true, name: true, stammschuleId: true },
        })
        : [];

      if (createdTeachers.length !== eligibleSources.length) {
        throw new Error('Nicht alle Lehrkräfte konnten im Zieljahr angelegt werden.');
      }

      const createdIdByIdentity = new Map<string, string>();
      for (const created of createdTeachers) {
        for (const key of identityKeys(created)) createdIdByIdentity.set(key, created.id);
      }

      let leavesCopied = 0;
      const leaveRows = eligibleSources.flatMap(source => {
        if (!copyLeaveTeacherIds.has(source.id)) return [];
        const targetId = identityKeys(source)
          .map(key => createdIdByIdentity.get(key))
          .find((id): id is string => Boolean(id));
        if (!targetId) throw new Error(`Zielzeile für Lehrkraft ${source.id} fehlt.`);
        return source.leavePeriods.flatMap(leave => {
          const copy = clampLeaveToTargetSchoolYear(leave, targetYear);
          if (!copy) return [];
          leavesCopied += 1;
          // Bei einer angemeldeten Lehrkraft gilt der vorhandene Zeitraum über
          // userId bereits für jede Schuljahreszeile. Eine physische Kopie wäre
          // redundant und könnte bei späteren Änderungen veralten.
          return source.userId ? [] : [{ teacherId: targetId, ...copy }];
        });
      });
      if (leaveRows.length > 0) await tx.leavePeriod.createMany({ data: leaveRows });

      return { copied: createdTeachers.length, skipped, leavesCopied };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InvalidSelectionError) {
      return NextResponse.json({ error: "Die Lehrkräfteauswahl ist nicht mehr gültig. Bitte laden Sie die Vorschau neu." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Die Übernahme wurde gleichzeitig verändert. Bitte öffnen Sie die Vorschau erneut." }, { status: 409 });
    }
    console.error("Teacher copy failed:", error);
    return NextResponse.json({ error: "Die Lehrkräfte konnten nicht übernommen werden." }, { status: 500 });
  }
}

class InvalidSelectionError extends Error {
  constructor() {
    super("Invalid teacher selection");
    this.name = "InvalidSelectionError";
  }
}
