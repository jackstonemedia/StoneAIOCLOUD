import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { siteService } from '../services/siteService.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const sites = await siteService.listSites(req.user.id);
    res.json(sites);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const { name, type, template } = req.body;
    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required', code: 'MISSING_PARAMS', statusCode: 400 });
    }
    
    const site = await siteService.createSite(req.user.id, { name, type, template });
    res.json(site);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const status = await siteService.getSiteStatus(req.user.id, req.params.id);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/start', async (req: AuthRequest, res, next) => {
  try {
    const result = await siteService.startSite(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/stop', async (req: AuthRequest, res, next) => {
  try {
    await siteService.stopSite(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/redeploy', async (req: AuthRequest, res, next) => {
  try {
    await siteService.redeploySite(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    await siteService.deleteSite(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required', code: 'MISSING_DOMAIN', statusCode: 400 });
    }
    
    await siteService.setCustomDomain(req.user.id, req.params.id, domain);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/logs', async (req: AuthRequest, res, next) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stop = await siteService.streamSiteLogs(
      req.user.id,
      req.params.id,
      (data) => {
        res.write(`data: ${JSON.stringify({ log: data })}\n\n`);
      },
      () => {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    );

    req.on('close', () => {
      if (stop) stop();
    });
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
