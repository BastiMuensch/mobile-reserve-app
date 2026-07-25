/**
 * Simple in-memory rate limiter for API routes.
 * Tracks attempts by a key (typically an IP address) within a sliding time window.
 *
 * NOTE: State is held in a process-local Map and is NOT shared across multiple
 * instances (e.g. horizontally scaled deployments) or persisted across process
 * restarts/deploys. Each instance/restart starts with an empty limiter. This is
 * fine for a single-instance deployment but should be replaced with a shared
 * store (e.g. Redis) if the app is ever run with multiple concurrent instances.
 */

interface RateLimitConfig {
  windowMs: number;
  maxAttempts: number;
}

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
}

export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs, maxAttempts } = config;
  const attempts = new Map<string, RateLimitEntry>();

  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (now - entry.firstAttempt > windowMs) {
        attempts.delete(key);
      }
    }
  }

  /**
   * Check whether the given key is rate-limited.
   * Returns { success: true, remaining } if the request is allowed,
   * or { success: false, remaining: 0 } if the limit has been exceeded.
   */
  function check(key: string): { success: boolean; remaining: number } {
    cleanup();
    const now = Date.now();
    const entry = attempts.get(key);

    if (!entry || now - entry.firstAttempt > windowMs) {
      attempts.set(key, { count: 1, firstAttempt: now });
      return { success: true, remaining: maxAttempts - 1 };
    }

    entry.count++;
    if (entry.count > maxAttempts) {
      return { success: false, remaining: 0 };
    }

    return { success: true, remaining: maxAttempts - entry.count };
  }

  /**
   * Clear any tracked attempts for the given key (e.g. after a successful
   * login), so the key starts with a fresh window on its next check.
   */
  function reset(key: string): void {
    attempts.delete(key);
  }

  return { check, reset };
}

/**
 * Extract the client IP address from request headers.
 * Falls back to 'unknown' if no IP header is present.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}
