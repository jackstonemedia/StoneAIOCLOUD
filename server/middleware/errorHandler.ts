import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  logger.error(`${err.name}: ${err.message}\n${err.stack}`);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  const code = err.code || 'INTERNAL_ERROR';

  res.status(statusCode).json({
    message,
    error: message,
    code,
    statusCode,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}
