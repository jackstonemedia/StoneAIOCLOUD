import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { usageService } from '../services/usageService.js';

export function limitBy(resource: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const userId = req.user.id;
      const limitInfo = await usageService.checkLimit(userId, resource);

      if (!limitInfo.allowed) {
        return res.status(429).json({
          error: 'Usage limit reached',
          resource,
          used: limitInfo.used,
          limit: limitInfo.limit,
          resetAt: limitInfo.resetAt,
          upgradeUrl: 'https://stoneaio.com/upgrade',
          message: `You've used all your ${resource} for this period.`
        });
      }

      // Set response headers
      res.setHeader('X-RateLimit-Resource', resource);
      res.setHeader('X-RateLimit-Remaining', limitInfo.remaining === Infinity ? '999999' : limitInfo.remaining.toString());
      res.setHeader('X-RateLimit-Limit', limitInfo.limit === Infinity ? '999999' : limitInfo.limit.toString());
      res.setHeader('X-RateLimit-Reset', limitInfo.resetAt.getTime().toString());

      next();
    } catch (err) {
      next(err);
    }
  };
}
