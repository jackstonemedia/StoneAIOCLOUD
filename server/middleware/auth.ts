import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import { getDb } from '../db/index.js';

export interface AuthRequest extends Request {
  user?: any;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', code: 'MISSING_TOKEN', statusCode: 401 });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized', code: 'INVALID_TOKEN', statusCode: 401 });
  }
}

export function requirePlan(allowedPlans: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'MISSING_USER', statusCode: 401 });
    }

    try {
      const db = getDb();
      const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(req.user.id) as { plan: string } | undefined;

      if (!user) {
        return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND', statusCode: 404 });
      }

      if (!allowedPlans.includes(user.plan)) {
        return res.status(403).json({ error: 'Forbidden: Upgrade required', code: 'PLAN_UPGRADE_REQUIRED', statusCode: 403 });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
