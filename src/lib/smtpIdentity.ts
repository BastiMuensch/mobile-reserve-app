export interface SmtpIdentity { smtpHost?: string | null; smtpPort?: number | null; smtpSecure?: boolean | null; smtpUser?: string | null }
/** A masked secret is only reusable for the same transport identity. Internal
 * school SMTP servers remain supported; no blanket public-host restriction. */
export function sameSmtpIdentity(previous: SmtpIdentity | null, next: SmtpIdentity): boolean {
  if (!previous) return false;
  const host = (value?: string | null) => (value || '').trim().toLowerCase().replace(/\.$/, '');
  return host(previous.smtpHost) === host(next.smtpHost)
    && (previous.smtpPort ?? 587) === (next.smtpPort ?? 587)
    && Boolean(previous.smtpSecure) === Boolean(next.smtpSecure)
    && (previous.smtpUser || '').trim() === (next.smtpUser || '').trim();
}
