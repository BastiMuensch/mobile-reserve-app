import { cookies } from 'next/headers';
import { prisma } from './prisma';

export async function getSessionUser() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('session_userId')?.value;

  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { 
      school: true, 
      teachers: {
        include: { assignments: { include: { request: { include: { school: true } } } } }
      } 
    }
  });

  return user;
}
