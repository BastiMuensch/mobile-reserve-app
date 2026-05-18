import { cookies } from 'next/headers';
import { prisma } from './prisma';

/**
 * Lightweight session lookup – used in all API routes for auth checks.
 * Only fetches school/teacher IDs + role; no heavy assignment joins.
 */
export async function getSessionUser() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('session_userId')?.value;
  if (!userId) return null;

  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      school: { select: { id: true, schulamtId: true } },
      teachers: { select: { id: true, schoolYear: true, stammschule: { select: { schulamtId: true } } } },
    },
  });
}

/**
 * Full session lookup – only used by /api/auth/me to hydrate the client session.
 * Loads full assignment history for the TeacherDashboard.
 */
export async function getFullSessionUser() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('session_userId')?.value;
  if (!userId) return null;

  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      school: true,
      teachers: {
        include: {
          assignments: {
            include: { request: { include: { school: true } } },
            orderBy: { date: 'asc' },
          },
        },
      },
    },
  });
}
