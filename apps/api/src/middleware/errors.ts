import type { NextFunction, Request, Response } from 'express';
import { env } from '../env.ts';
import { ApiError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: `No route matches ${req.method} ${req.path}.` } });
}

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

function translateDbError(err: PgError): ApiError | null {
  switch (err.code) {
    case '23505':
      return new ApiError(409, 'conflict', 'That record already exists.', { constraint: err.constraint });
    case '23503':
      return new ApiError(409, 'conflict', 'A referenced record does not exist.');
    case '23514':
      return new ApiError(422, 'unprocessable', 'A value failed a database constraint.', { constraint: err.constraint });
    case '22P02':
      return new ApiError(400, 'bad_request', 'A parameter had the wrong format.');
    case '57014':
      return new ApiError(503, 'timeout', 'The query took too long. Try again.');
    default:
      return null;
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const requestId = (req as Request & { id?: string }).id;

  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error('request failed', { code: err.code, message: err.message, requestId });
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    return;
  }

  const anyErr = err as { type?: string };
  if (anyErr?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body exceeds the allowed size.', requestId } });
    return;
  }
  if (anyErr?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_request', message: 'Request body is not valid JSON.', requestId } });
    return;
  }

  const translated = err instanceof Error ? translateDbError(err as PgError) : null;
  if (translated) {
    logger.warn('database constraint rejected a request', { code: (err as PgError).code, requestId });
    res.status(translated.status).json({ error: { code: translated.code, message: translated.message, details: translated.details, requestId } });
    return;
  }

  logger.error('unhandled error', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    requestId,
  });
  res.status(500).json({
    error: {
      code: 'server_error',
      message: env.isProd ? 'Something went wrong on our side.' : String(err instanceof Error ? err.message : err),
      requestId,
    },
  });
}
