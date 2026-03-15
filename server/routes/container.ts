import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { containerService } from '../services/containerService.js';
import { usageService } from '../services/usageService.js';
import { limitBy } from '../middleware/usageLimiter.js';

const router = Router();

router.use(requireAuth);

router.get('/status', async (req: AuthRequest, res, next) => {
  try {
    const status = await containerService.getContainerStatus(req.user.id);
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (req: AuthRequest, res, next) => {
  try {
    const stats = await containerService.getStats(req.user.id);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

router.post('/start', async (req: AuthRequest, res, next) => {
  try {
    await containerService.startContainer(req.user.id);
    res.json({ success: true, message: 'Container started' });
  } catch (err) {
    next(err);
  }
});

router.post('/stop', async (req: AuthRequest, res, next) => {
  try {
    await containerService.stopContainer(req.user.id);
    res.json({ success: true, message: 'Container stopped' });
  } catch (err) {
    next(err);
  }
});

router.post('/restart', async (req: AuthRequest, res, next) => {
  try {
    await containerService.restartContainer(req.user.id);
    res.json({ success: true, message: 'Container restarted' });
  } catch (err) {
    next(err);
  }
});

router.get('/logs', async (req: AuthRequest, res, next) => {
  try {
    const tail = parseInt(req.query.tail as string) || 100;
    const logs = await containerService.getLogs(req.user.id, tail);
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

router.post('/exec-direct', limitBy('executions'), async (req: AuthRequest, res, next) => {
  try {
    const { command, timeout, workdir } = req.body;
    if (!command) return res.status(400).json({ error: 'Command is required' });

    const result = await containerService.execInContainer(req.user.id, command, { timeout, workdir });
    
    // Record usage
    usageService.recordExecution(req.user.id).catch(() => {});

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
