import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }

    const now = new Date();
    
    // 1. Anonymize teacher names in requests older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);
    
    const anonymizedRequests = await prisma.request.updateMany({
      where: {
        date: { lt: thirtyDaysAgo },
        substitutedTeacher: { not: '*** gelöscht (DSGVO) ***' }
      },
      data: {
        substitutedTeacher: '*** gelöscht (DSGVO) ***'
      }
    });

    // 2. Delete assignments older than 400 days
    const fourHundredDaysAgo = new Date();
    fourHundredDaysAgo.setDate(now.getDate() - 400);

    const deletedAssignments = await prisma.assignment.deleteMany({
      where: {
        date: { lt: fourHundredDaysAgo }
      }
    });

    // 3. Delete requests older than 400 days
    const deletedRequests = await prisma.request.deleteMany({
      where: {
        date: { lt: fourHundredDaysAgo }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'DSGVO Cleanup erfolgreich durchgeführt',
      stats: {
        anonymizedTeacherNames: anonymizedRequests.count,
        deletedAssignments: deletedAssignments.count,
        deletedRequests: deletedRequests.count
      }
    });
  } catch (error) {
    console.error('DSGVO Cleanup Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
