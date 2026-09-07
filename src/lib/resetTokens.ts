export const MAX_OUTSTANDING_RESET_TOKENS = 3;

/** Public reset requests never revoke a valid link; this bounds their count. */
export function mayIssueAnotherResetToken(outstanding: number): boolean {
  return outstanding < MAX_OUTSTANDING_RESET_TOKENS;
}
