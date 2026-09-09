import { ENV } from '../config/env.js';

/**
 * Fixed-window rate limiter, per authenticated tenant or per client IP.
 *
 * Two problems with the previous version are fixed here:
 *  - The tracking Map grew without bound, so a stream of distinct source IPs
 *    was an unauthenticated memory-exhaustion vector.
 *  - It read `x-forwarded-for` unconditionally. That header is attacker-
 *    controlled unless a trusted proxy sets it, so any client could pick a
 *    fresh identity per request and bypass the limit entirely.
 */

const buckets = new Map();

/** Resolves the client identity, trusting proxy headers only when configured. */
export function resolveClientIp(req, env = ENV) {
  if (env.TRUST_PROXY_HOPS > 0) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    // Count from the right: the rightmost entries were appended by our own
    // proxies, so the first untrusted value is at that offset.
    const index = forwarded.length - env.TRUST_PROXY_HOPS;
    if (index >= 0 && forwarded[index]) return forwarded[index];
  }

  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Frees space in the tracking table.
 *
 * Eviction order matters. Dropping buckets in insertion order — the previous
 * behaviour — meant an attacker could flood the table with fresh identities and
 * push a throttled client out of it, which handed that client back a full
 * quota. Verified: a victim at its limit was serving requests again after 200
 * junk identities.
 *
 * Expired windows go first, then windows still under their limit, which are
 * harmless to forget. A bucket that is currently over quota is never evicted.
 *
 * @returns {boolean} false when the table is full of throttled clients and no
 *                    new identity can be admitted.
 */
function sweep(now, maxClients, maxRequests) {
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
  if (buckets.size <= maxClients) return true;

  for (const [key, bucket] of buckets) {
    if (buckets.size <= maxClients) break;
    if (bucket.count <= maxRequests) buckets.delete(key);
  }

  // Everything left is actively throttled. Forgetting any of it would reward
  // the flood, so new identities are refused instead.
  return buckets.size <= maxClients;
}

export function createRateLimiter(env = ENV) {
  const { WINDOW_MS, MAX_REQUESTS, MAX_TRACKED_CLIENTS } = env.RATE_LIMIT;

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    req.clientIp = resolveClientIp(req, env);

    // An authenticated tenant gets its own budget; anonymous traffic shares by IP.
    const identity = req.auth?.tenantId && req.auth.authenticated
      ? `tenant:${req.auth.tenantId}`
      : `ip:${req.clientIp}`;

    let bucket = buckets.get(identity);

    if (!bucket && buckets.size >= MAX_TRACKED_CLIENTS) {
      const admitted = sweep(now, MAX_TRACKED_CLIENTS - 1, MAX_REQUESTS);
      if (!admitted) {
        // Shed load rather than lose the state that is holding abusers back.
        res.setHeader('Retry-After', Math.ceil(WINDOW_MS / 1000));
        return res.status(429).json({
          error: {
            message: 'El gateway está aplicando control de carga: la tabla de clientes está saturada.',
            type: 'RateLimitError',
            code: 429
          }
        });
      }
      bucket = buckets.get(identity);
    }

    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(identity, bucket);
    }

    bucket.count++;
    const remaining = Math.max(0, MAX_REQUESTS - bucket.count);
    res.setHeader('RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', Math.ceil((bucket.resetAt - now) / 1000));

    if (bucket.count > MAX_REQUESTS) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: {
          message: `Límite de ${MAX_REQUESTS} peticiones por ventana de ${Math.round(WINDOW_MS / 1000)}s alcanzado.`,
          type: 'RateLimitError',
          code: 429,
          retryAfterSeconds: retryAfter
        }
      });
    }

    next();
  };
}

/** Test helper: clears all windows. */
export function resetRateLimiter() {
  buckets.clear();
}
