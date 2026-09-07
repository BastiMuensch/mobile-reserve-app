import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { jwtVerify, SignJWT } from 'jose';
import { isWebRole } from './webRoles';

function getKey() {
  const secretKey = process.env.JWT_SECRET;
  if (!secretKey) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return new TextEncoder().encode(secretKey);
}

type SessionPayload = { id: string; sessionVersion: number };

export async function signToken(payload: SessionPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getKey());
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getKey());
    if (typeof payload.id !== 'string' || typeof payload.sessionVersion !== 'number') {
      return null;
    }
    return { id: payload.id, sessionVersion: payload.sessionVersion };
  } catch {
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

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    include: {
      school: { select: { id: true, schulamtId: true } },
      teachers: { select: { id: true, schoolYear: true, status: true, stammschule: { select: { schulamtId: true } } } },
    },
  });

  // Tokens are intentionally tied to an account version. This invalidates every
  // existing browser session after a password reset and immediately blocks pending
  // or deactivated accounts, even when their JWT has not yet expired.
  // A single installation is operated by exactly one Schulamt. Historic ADMIN
  // records stay in the database for compatibility, but must not retain a
  // browser session after the technical web-admin was retired.
  if (!user || !isWebRole(user.role) || !user.isActive || user.sessionVersion !== payload.sessionVersion) return null;
  if (user.role === 'TEACHER' && user.teachers.some(teacher => teacher.status === 'PENDING')) return null;
  return user;
}

/**
 * Full session lookup – only used by /api/auth/me to hydrate the client session.
 * Einsatzdaten werden getrennt geladen und nicht in jede Session-Antwort eingebettet.
 */
export async function getFullSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || !payload.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    include: {
      school: true,
      teachers: true,
    },
  });

  if (!user || !isWebRole(user.role) || !user.isActive || user.sessionVersion !== payload.sessionVersion) return null;
  if (user.role === 'TEACHER' && user.teachers.some(teacher => teacher.status === 'PENDING')) return null;
  return user;
}
