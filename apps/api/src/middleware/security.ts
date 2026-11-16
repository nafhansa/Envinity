import cors from 'cors';
import helmet from 'helmet';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../env.ts';
import { ApiError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';

const allowedOrigins = new Set([env.appUrl, ...env.extraOrigins].filter(Boolean));
// Dev servers hop ports (4321, 4322, ...). Outside production any loopback origin is fine;
// production only ever accepts APP_URL and CORS_EXTRA_ORIGINS.
const devLoopback = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;
const isAllowed = (origin: string) => allowedOrigins.has(origin) || (!env.isProd && devLoopback.test(origin));

export const corsMiddleware: RequestHandler = cors({
  origin(origin, callback) {
    if (!origin || isAllowed(origin)) {
      callback(null, true);
      return;
    }
    logger.warn('blocked cross-origin request', { origin });
    callback(new ApiError(403, 'forbidden_origin', 'Origin not allowed.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After', 'X-Request-Id'],
  maxAge: 600,
});

export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"], 'base-uri': ["'none'"], 'form-action': ["'none'"] },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: env.isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  xFrameOptions: { action: 'deny' },
  noSniff: true,
});

/** Rejects non-JSON bodies on mutating routes: stops simple-form CSRF before parsing. */
export function requireJsonBody(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method)) {
    next();
    return;
  }
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    next(new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.'));
    return;
  }
  next();
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = crypto.randomUUID();
  (req as Request & { id: string }).id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function accessLog(req: Request, res: Response, next: NextFunction): void {
  const started = performance.now();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level](`${req.method} ${req.path} ${res.statusCode}`, {
      durationMs: Math.round(performance.now() - started),
      tenantId: req.auth?.tenantId,
      requestId: (req as Request & { id?: string }).id,
    });
  });
  next();
}
