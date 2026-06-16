/**
 * Simple in-memory rate limiter for API routes.
 * Tracks attempts by a key (typically an IP address) within a sliding time window.
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

  return { check };
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
