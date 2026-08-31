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
