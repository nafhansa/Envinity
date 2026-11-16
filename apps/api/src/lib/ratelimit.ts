import type { NextFunction, Request, Response } from 'express';
import { withSystem } from '../db/pool.ts';
import { clientIp } from './http.ts';
import { tooManyRequests } from './errors.ts';
import { logger } from './logger.ts';

export interface LimitSpec {
  windowSec: number;
  max: number;
  /** Bucket prefix so different routes never share a counter. */
  scope: string;
  /** Identity being limited. Defaults to the client IP. */
  key?: (req: Request) => string;
}

/**
 * Two-tier fixed-window limiter (Securinity's design): a process-local counter
 * absorbs the common case, the Postgres counter keeps the limit correct across
 * instances. If Postgres is unavailable it degrades to local counters instead of
 * failing open.
 */
const local = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of local) if (v.resetAt <= now) local.delete(k);
}, 30_000).unref();

async function consume(bucket: string, windowSec: number, max: number) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${bucket}:${windowStart}`;

  const entry = local.get(key);
  if (entry && entry.count >= max) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000), remaining: 0 };
  }

  try {
    const count = await withSystem(async (db) => {
      const { rows } = await db.query<{ count: number }>(
        `INSERT INTO rate_limits (bucket, window_start, count, expires_at)
         VALUES ($1, to_timestamp($2 / 1000.0), 1, to_timestamp($3 / 1000.0))
         ON CONFLICT (bucket) DO UPDATE SET
           count = CASE WHEN rate_limits.window_start < to_timestamp($2 / 1000.0) THEN 1 ELSE rate_limits.count + 1 END,
           window_start = GREATEST(rate_limits.window_start, to_timestamp($2 / 1000.0)),
           expires_at = to_timestamp($3 / 1000.0)
         RETURNING count`,
        [bucket, windowStart, windowStart + windowMs],
      );
      return rows[0]?.count ?? 1;
    });
    local.set(key, { count, resetAt: windowStart + windowMs });
    return { allowed: count <= max, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000), remaining: Math.max(0, max - count) };
  } catch (err) {
    logger.warn('rate limiter degraded to in-process counters', { error: err instanceof Error ? err.message : String(err) });
    const fallback = local.get(key) ?? { count: 0, resetAt: windowStart + windowMs };
    fallback.count += 1;
    local.set(key, fallback);
    return { allowed: fallback.count <= max, retryAfter: Math.ceil((fallback.resetAt - now) / 1000), remaining: Math.max(0, max - fallback.count) };
  }
}

export function rateLimit(spec: LimitSpec) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identity = spec.key ? spec.key(req) : clientIp(req);
      const result = await consume(`${spec.scope}:${identity}`, spec.windowSec, spec.max);
      res.setHeader('X-RateLimit-Limit', String(spec.max));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      res.setHeader('X-RateLimit-Reset', String(result.retryAfter));
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfter));
        next(tooManyRequests('Too many attempts. Please wait and try again.', result.retryAfter));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export async function sweepRateLimits(): Promise<number> {
  return withSystem(async (db) => {
    const { rowCount } = await db.query("DELETE FROM rate_limits WHERE expires_at < now() - INTERVAL '1 hour'");
    return rowCount ?? 0;
  });
}
