export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getFullSessionUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getFullSessionUser();

    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const { password: _, ...userWithoutPassword } = user;
    return NextResponse.json({ user: userWithoutPassword });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
