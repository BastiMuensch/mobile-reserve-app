import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth';
import { sanitizeFilenamePart } from '@/lib/pdfGenerator';
import { getAssignmentSeries, assignmentDay } from '@/lib/assignmentSeries';
import { createDeploymentProof } from '@/lib/deploymentProof';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const assignment = await prisma.$transaction(async tx => tx.assignment.findUnique({
      where: { id },
      include: {
        teacher: { include: { stammschule: true } },
        request: { include: {
          school: { include: { schulamt: { include: { schulamtProfile: true } } } },
          assignments: { select: { id: true, teacherId: true, date: true, hours: true, status: true } },
        } },
      },
    }), { isolationLevel: 'RepeatableRead' });
    if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    const isOwner = user.role === 'TEACHER' && (assignment.teacher.userId === user.id || user.teachers?.some(t => t.id === assignment.teacherId));
    const isOffice = user.role === 'SCHULAMT' && assignment.request.school.schulamtId === user.id;
    if (!isOwner && !isOffice) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const profile = assignment.request.school.schulamt?.schulamtProfile;
    if (!profile || [profile.headerText, profile.returnAddress, profile.contactAddress, profile.contactPerson, profile.city, profile.amtsleitungName, profile.amtsleitungTitle, profile.documentSubject, profile.documentIntro, profile.documentClosing].some(value => !value.trim())) {
      return NextResponse.json({ error: 'Das Schulamtsprofil ist unvollständig. Bitte Briefkopf und Dokumenttexte zuerst einrichten.' }, { status: 409 });
    }
    const series = getAssignmentSeries({ id: assignment.id, teacherId: assignment.teacherId, date: assignment.date, hours: assignment.hours, status: assignment.status }, assignment.request.assignments.filter(a => a.teacherId === assignment.teacherId));
    const doc = await createDeploymentProof({ teacher: assignment.teacher, school: assignment.request.school, profile,
      assignments: series, substitutedTeacher: assignment.request.substitutedTeacher, priority: assignment.request.priority });
    const prefix = assignment.status === 'REJECTED' ? 'STORNIERT_' : '';
    const filename = `${prefix}${sanitizeFilenamePart(assignment.teacher.name)}_${assignmentDay(series[0].date)}.pdf`;
    return new Response(doc.output('arraybuffer'), { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    console.error('Error generating deployment proof PDF:', error);
    return NextResponse.json({ error: 'Nachweis konnte nicht erstellt werden.' }, { status: 500 });
  }
}
