import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';
import { z } from 'zod';
import { POSTAL_CODE_SCHEMA } from '@/lib/geocoding';
import { normalizeEmptyOptionalTeacherFields, omitBlankPassword, statusForTeacherUpdate, teacherStatusSchema } from '@/lib/teacherUpdate';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const p = await params;
    const rawData = await request.json();
    // The edit dialog deliberately omits an unchanged password. Treat a blank
    // legacy/client value identically so an ordinary profile edit is not
    // rejected by the minimum password-length rule.
    const data = normalizeEmptyOptionalTeacherFields(omitBlankPassword(rawData));

    const TeacherUpdateSchema = z.object({
      name: z.string().min(1, 'Name ist erforderlich').optional(),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      stammschuleId: z.string().uuid('Ungültige Schul-ID').optional(),
      maxWeeklyHours: z.union([z.string(), z.number()]).transform(v => parseInt(v as string)).optional(),
      isPartTime: z.boolean().optional(),
      schedule: z.any().optional().nullable(),
      qualifications: z.string().optional(),
      status: teacherStatusSchema.optional(),
      address: z.string().optional().nullable(),
      postalCode: POSTAL_CODE_SCHEMA.optional(),
      gender: z.enum(['FEMALE', 'MALE', 'DIVERSE']).optional().nullable(),
      homeLat: z.coerce.number().finite().min(-90).max(90).optional(),
      homeLng: z.coerce.number().finite().min(-180).max(180).optional(),
      preferredType: z.enum(['GRUNDSCHULE', 'MITTELSCHULE', 'BOTH']).optional(),
      password: z.string().min(12, 'Passwort muss mindestens 12 Zeichen lang sein').max(200).optional().nullable(),
    }).superRefine((value, ctx) => {
      if (value.password && !value.email) {
        ctx.addIssue({ code: 'custom', path: ['email'], message: 'Für einen Lehrkraft-Zugang ist eine E-Mail-Adresse erforderlich.' });
      }
    });

    const parsedData = TeacherUpdateSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const validatedData = parsedData.data;

    const existingTeacher = await prisma.teacher.findUnique({
      where: { id: p.id },
      include: { stammschule: true }
    });

    if (!existingTeacher || existingTeacher.stammschule?.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: You can only modify teachers from your own Schulamt.' }, { status: 403 });
    }

    // Wird die Stammschule geändert, muss auch die ZIEL-Schule zum eigenen Schulamt gehören.
    // Sonst ließe sich eine Lehrkraft an eine fremde Schule umhängen (Kenntnis der fremden
    // UUID genügte); die Herkunfts-Schule ist oben bereits geprüft.
    if (validatedData.stammschuleId && validatedData.stammschuleId !== existingTeacher.stammschuleId) {
      const targetSchool = await prisma.school.findUnique({
        where: { id: validatedData.stammschuleId },
        select: { schulamtId: true },
      });
      if (!targetSchool || targetSchool.schulamtId !== userSession.id) {
        return NextResponse.json({ error: 'Forbidden: Die Ziel-Schule gehört nicht zu Ihrem Schulamt.' }, { status: 403 });
      }
    }

    const isFullUpdate = validatedData.name !== undefined;
    if (isFullUpdate && existingTeacher.userId && !validatedData.email) {
      return NextResponse.json({ error: 'Für eine Lehrkraft mit Zugang ist eine E-Mail-Adresse erforderlich.' }, { status: 400 });
    }
    const { password, ...restData } = validatedData;
    void password;
    let finalData: Prisma.TeacherUncheckedUpdateInput = { ...restData } as Prisma.TeacherUncheckedUpdateInput;

    if (isFullUpdate) {
      if (!validatedData.address?.trim() || !validatedData.postalCode ||
          validatedData.homeLat === undefined || validatedData.homeLng === undefined) {
        return NextResponse.json({ error: 'Postalische Anschrift, Postleitzahl und ein bestätigter Karten-Pin sind erforderlich.' }, { status: 400 });
      }

      finalData = {
        name: validatedData.name,
        email: validatedData.email || null,
        phone: validatedData.phone || null,
        stammschuleId: validatedData.stammschuleId,
        maxWeeklyHours: validatedData.maxWeeklyHours !== undefined ? validatedData.maxWeeklyHours : existingTeacher.maxWeeklyHours,
        isPartTime: validatedData.isPartTime !== undefined ? validatedData.isPartTime : existingTeacher.isPartTime,
        schedule: validatedData.isPartTime && validatedData.schedule ? JSON.stringify(validatedData.schedule) : null,
        qualifications: validatedData.qualifications !== undefined ? validatedData.qualifications : existingTeacher.qualifications,
        address: validatedData.address,
        postalCode: validatedData.postalCode,
        // Full form submissions historically omitted status. Preserve the
        // existing lifecycle state rather than implicitly reactivating people.
        status: statusForTeacherUpdate(validatedData.status, existingTeacher.status),
        preferredType: validatedData.preferredType !== undefined ? validatedData.preferredType : existingTeacher.preferredType,
        gender: validatedData.gender || null,
        homeLat: validatedData.homeLat,
        homeLng: validatedData.homeLng,
      };
    }

    const hashedPassword = (isFullUpdate && validatedData.password)
      ? await bcrypt.hash(validatedData.password, 12)
      : null;

    const teacher = await prisma.$transaction(async (tx) => {
      if (isFullUpdate && validatedData.email) {
        const userEmail = validatedData.email.trim().toLowerCase();
        const existingUserWithEmail = await tx.user.findUnique({
          where: { email: userEmail },
        });
        if (existingUserWithEmail && existingUserWithEmail.id !== existingTeacher.userId) {
          throw new Error('EMAIL_EXISTS');
        }
      }

      const updatedTeacher = await tx.teacher.update({
        where: { id: p.id },
        data: finalData,
      });

      // userId is the person/login identity shared by copied school-year rows.
      // Keep its denormalized display identity in sync across those rows; do
      // not copy year-specific workload, school, address, or lifecycle state.
      if (isFullUpdate && updatedTeacher.userId) {
        await tx.teacher.updateMany({
          where: { userId: updatedTeacher.userId },
          data: { name: updatedTeacher.name, email: updatedTeacher.email },
        });
      }

      if (isFullUpdate && hashedPassword) {
        const userEmail = validatedData.email!.trim().toLowerCase();
        const user = updatedTeacher.userId ? await tx.user.findUnique({ where: { id: updatedTeacher.userId } }) : null;
        if (user) {
          await tx.user.update({
            where: { id: user.id },
            data: { email: userEmail, name: updatedTeacher.name, password: hashedPassword, isActive: updatedTeacher.status !== 'PENDING', sessionVersion: { increment: 1 } },
          });
        } else {
          const newUser = await tx.user.create({
            data: { email: userEmail, name: updatedTeacher.name, password: hashedPassword, role: 'TEACHER', isActive: updatedTeacher.status !== 'PENDING' },
          });
          await tx.teacher.update({ where: { id: p.id }, data: { userId: newUser.id } });
        }
      } else if (isFullUpdate && validatedData.email) {
        const user = updatedTeacher.userId ? await tx.user.findUnique({ where: { id: updatedTeacher.userId } }) : null;
        if (user) {
          await tx.user.update({
            where: { id: user.id },
            data: { email: validatedData.email.trim().toLowerCase(), name: updatedTeacher.name },
          });
        }
      }

      return updatedTeacher;
    });

    return NextResponse.json(teacher);
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_EXISTS') {
      return NextResponse.json({ error: 'Diese E-Mail-Adresse wird bereits von einem anderen Benutzer verwendet.' }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Diese E-Mail-Adresse wird bereits von einem anderen Benutzer verwendet.' }, { status: 409 });
    }
    console.error('Failed to update teacher:', error);
    return NextResponse.json({ error: 'Failed to update teacher' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'SCHULAMT') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const p = await params;
    
    const existingTeacher = await prisma.teacher.findUnique({
      where: { id: p.id },
      include: { stammschule: true }
    });

    if (!existingTeacher || existingTeacher.stammschule?.schulamtId !== userSession.id) {
      return NextResponse.json({ error: 'Forbidden: You can only delete teachers from your own Schulamt.' }, { status: 403 });
    }

    // Assignment.teacherId ist ON DELETE RESTRICT: Hätte die Lehrkraft Einsätze (auch
    // stornierte zählen für den Fremdschlüssel), bräche das Löschen mit einem 500 ab.
    // Statt eines unverständlichen Fehlers verweigern wir es klar – Einsätze sind Teil der
    // Abrechnungs-/Nachweishistorie und sollen nicht beiläufig verschwinden. Diese Route
    // dient im Alltag nur dem Ablehnen frisch registrierter (einsatzloser) Lehrkräfte;
    // die Prüfung schützt gegen künftige Aufrufer.
    const assignmentCount = await prisma.assignment.count({ where: { teacherId: p.id } });
    if (assignmentCount > 0) {
      return NextResponse.json({
        error: 'Diese Lehrkraft hat Einsätze im System und kann nicht gelöscht werden. Bitte setzen Sie sie stattdessen auf "inaktiv".',
      }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      // Absencen blockieren als ON DELETE RESTRICT ebenfalls; sie sind – anders als Einsätze –
      // reine Tagesmarkierungen ohne Nachweiswert und werden mitgelöscht. LeavePeriods hängen
      // per Cascade am Teacher, werden hier der Klarheit halber aber explizit entfernt.
      await tx.absence.deleteMany({ where: { teacherId: p.id } });
      await tx.leavePeriod.deleteMany({ where: { teacherId: p.id } });
      await tx.teacher.delete({ where: { id: p.id } });

      // Das Login-Konto nur löschen, wenn keine ANDERE Lehrkraft es mehr nutzt: Beim Kopieren
      // in ein neues Schuljahr (POST /api/teachers/copy) teilen sich mehrere Teacher-Zeilen
      // denselben userId; ein Löschen würde sonst den Login der Kopie kappen.
      if (existingTeacher.userId) {
        const otherWithSameUser = await tx.teacher.count({ where: { userId: existingTeacher.userId } });
        if (otherWithSameUser === 0) {
          await tx.user.delete({ where: { id: existingTeacher.userId } });
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete teacher' }, { status: 500 });
  }
}
