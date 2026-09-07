import { createHmac, randomBytes } from "crypto";

function invitationPepper(): string {
  const pepper = process.env.INVITATION_TOKEN_PEPPER;
  if (pepper) return pepper;
  if (process.env.NODE_ENV !== "production" && process.env.JWT_SECRET) return process.env.JWT_SECRET;
  throw new Error("INVITATION_TOKEN_PEPPER is required");
}
export function createInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHmac("sha256", invitationPepper()).update(token).digest("hex");
}

export function activeInvitationKey(schulamtId: string, recipientEmail: string): string {
  return `${schulamtId}:${recipientEmail.trim().toLowerCase()}`;
}

export function resolveAppBaseUrl(request?: Request): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV !== 'production' && request) {
    try {
      const url = new URL(request.url);
      return url.origin.replace(/\/$/, '');
    } catch {
      const origin = request.headers.get('origin');
      if (origin) return origin.replace(/\/$/, '');
      const host = request.headers.get('host');
      if (host) return `http://${host}`;
    }
  }

  console.error(
    'NEXT_PUBLIC_APP_URL ist nicht gesetzt. In Produktion muss NEXT_PUBLIC_APP_URL konfiguriert sein.'
  );
  return null;
}

export function toInvitationLink(token: string, request?: Request): string | null {
  const baseUrl = resolveAppBaseUrl(request);
  if (!baseUrl) return null;
  const url = new URL('/register/teacher', baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}
