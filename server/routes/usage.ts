import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { usageService } from '../services/usageService.js';

const router = Router();

// Current usage for authenticated user
router.get('/current', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const usage = await usageService.getUserUsage(req.user.id);
    res.json(usage);
  } catch (err) {
    next(err);
  }
});

// Usage history for authenticated user
router.get('/history', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const history = await usageService.getDailyHistory(req.user.id);
    res.json({ history });
  } catch (err) {
    next(err);
  }
});

// Admin: Aggregate stats
router.get('/admin/stats', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const stats = await usageService.getAggregateStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// Admin: Top users by token usage
router.get('/admin/top-users', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const topUsers = await usageService.getTopUsersByTokens();
    res.json(topUsers);
  } catch (err) {
    next(err);
  }
});

export default router;
