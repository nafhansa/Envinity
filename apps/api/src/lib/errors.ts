/** Errors that are safe to surface verbatim to an API client. Same shape as Securinity. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) => new ApiError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Authentication required.') => new ApiError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have access to this resource.') => new ApiError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found.') => new ApiError(404, 'not_found', msg);
export const conflict = (msg: string, details?: unknown) => new ApiError(409, 'conflict', msg, details);
export const gone = (msg: string, details?: unknown) => new ApiError(410, 'gone', msg, details);
export const unprocessable = (msg: string, details?: unknown) => new ApiError(422, 'unprocessable', msg, details);
export const tooManyRequests = (msg: string, retryAfterSec: number) =>
  new ApiError(429, 'rate_limited', msg, { retryAfterSec });
export const planLimit = (msg: string, details?: unknown) => new ApiError(402, 'plan_limit', msg, details);
