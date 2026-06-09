import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { jwtVerify, SignJWT } from 'jose';

const secretKey = process.env.JWT_SECRET;
if (!secretKey) {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET environment variable is required in production');
  console.warn('WARNING: JWT_SECRET not set, using insecure development fallback');
}
const key = new TextEncoder().encode(secretKey || 'dev_fallback_key_not_for_production');

export async function signToken(payload: { id: string }) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, key);
    return payload as { id: string };
  } catch (error) {
    return null;
  }
}

/**
 * Lightweight session lookup – used in all API routes for auth checks.
 * Only fetches school/teacher IDs + role; no heavy assignment joins.
 */
export async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || !payload.id) return null;

  return prisma.user.findUnique({
    where: { id: payload.id },
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
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || !payload.id) return null;

  return prisma.user.findUnique({
    where: { id: payload.id },
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
