export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const schulamtId = searchParams.get('schulamtId');

  if (!schulamtId) {
    return NextResponse.json({ error: 'schulamtId is required' }, { status: 400 });
  }

  try {
    const schools = await prisma.school.findMany({
      where: { schulamtId },
      select: {
        id: true,
        name: true,
        type: true,
      },
      orderBy: {
        name: 'asc'
      }
    });

    return NextResponse.json(schools);
  } catch (error) {
    console.error('Failed to fetch public schools:', error);
    return NextResponse.json({ error: 'Failed to fetch schools' }, { status: 500 });
  }
}
