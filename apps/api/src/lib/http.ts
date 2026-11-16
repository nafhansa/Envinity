import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { env } from '../env.ts';
import { badRequest } from './errors.ts';

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function handler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function parse<S extends ZodTypeAny>(schema: S, value: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
    throw badRequest(`Invalid ${label}.`, details);
  }
  return result.data;
}

export const parseBody = <S extends ZodTypeAny>(req: Request, schema: S) => parse(schema, req.body, 'request body');
export const parseParams = <S extends ZodTypeAny>(req: Request, schema: S) => parse(schema, req.params, 'path parameter');

export const uuid = z.string().uuid('must be a UUID');

/** base64url string with a byte-length range, for keys, IVs and ciphertext from the browser. */
export function b64url(minBytes: number, maxBytes: number) {
  const minChars = Math.floor((minBytes * 4) / 3);
  const maxChars = Math.ceil((maxBytes * 4) / 3);
  return z
    .string()
    .min(minChars)
    .max(maxChars)
    .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url');
}

/** Only the number of proxy hops the operator declared is trusted (same as Securinity). */
export function clientIp(req: Request): string {
  if (env.trustProxyHops > 0) {
    const header = req.headers['x-forwarded-for'];
    const chain = (Array.isArray(header) ? header.join(',') : (header ?? ''))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (chain.length > 0) {
      const candidate = chain[Math.max(0, chain.length - env.trustProxyHops)];
      if (candidate && /^[0-9a-f:.]+$/i.test(candidate)) return normalizeIp(candidate);
    }
  }
  return normalizeIp(req.socket.remoteAddress ?? '0.0.0.0');
}

export function normalizeIp(ip: string): string {
  const out = ip.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(out);
  if (mapped) return mapped[1];
  if (out === '::1') return '127.0.0.1';
  return out || '0.0.0.0';
}

export function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
}

/** Consistent envelope: `{ data }` on success, `{ error }` on failure. */
export function ok(res: Response, data: unknown, status = 200): void {
  noStore(res);
  res.status(status).json({ data });
}

export const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
