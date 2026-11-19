import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

export const asyncHandler = (
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler => (req, res, next) => {
  handler(req, res, next).catch(next);
};

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.status).json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? null },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid.',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
    return;
  }

  if (error instanceof Error && error.message === 'PRIZE_IN_USE') {
    res.status(409).json({
      ok: false,
      error: {
        code: 'PRIZE_IN_USE',
        message: 'This prize already appears in spin history. Disable it instead of deleting.',
      },
    });
    return;
  }

  console.error('[api] unhandled error', error);
  res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' },
  });
}
