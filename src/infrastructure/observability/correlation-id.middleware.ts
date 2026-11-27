import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header('x-correlation-id');
  const correlationId =
    incoming && /^[A-Za-z0-9._:-]{1,120}$/.test(incoming)
      ? incoming
      : randomUUID();

  res.setHeader('x-correlation-id', correlationId);
  req.headers['x-correlation-id'] = correlationId;
  next();
}
