/**
 * Roles that may use the regular web application of a single-school-authority
 * installation. `ADMIN` deliberately remains a possible persisted value for
 * backwards compatibility, but is not a browser-facing role anymore.
 */
export const WEB_ROLES = ["SCHULAMT", "SCHOOL", "TEACHER"] as const;

export type WebRole = (typeof WEB_ROLES)[number];

export function isWebRole(role: string): role is WebRole {
  return (WEB_ROLES as readonly string[]).includes(role);
}
