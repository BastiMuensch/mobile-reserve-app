import { prisma } from '../src/lib/prisma';
import * as auth from '../src/lib/auth';
import { GET } from '../src/app/api/schulamt/profile/route';
import { NextResponse } from 'next/server';

async function test() {
  const user = await prisma.user.findFirst({ where: { role: 'SCHULAMT' } });
  if (!user) return console.log('no user');
  
  // mock cookies() inside getSessionUser
  const mockCookieStore = {
     get: (key: string) => ({ value: 'mocked_token' })
  };
  
  // Override verifyToken to just return the user payload
  (auth as any).verifyToken = async () => ({ id: user.id });
  (auth as any).getSessionUser = async () => user as any;

  try {
     const res = await GET() as NextResponse;
     console.log('Status:', res.status);
     const text = await res.text();
     console.log('Body:', text);
  } catch(e) {
     console.log('Exception:', e);
  }
}
test();
