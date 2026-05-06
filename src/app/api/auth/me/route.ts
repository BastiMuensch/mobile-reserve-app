export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('session_userId')?.value;

    if (!userId) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { 
        school: true, 
        teachers: {
          include: {
            assignments: {
              include: {
                request: {
                  include: { school: true }
                }
              },
              orderBy: { date: 'asc' }
            }
          }
        } 
      }
    });

    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const { password: _, ...userWithoutPassword } = user;
    return NextResponse.json({ user: userWithoutPassword });

  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
