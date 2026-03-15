import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { agentScheduler, parseCronFromNaturalLanguage, getNextRun } from '../services/agentService.js';
import { getDb } from '../db/index.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req: AuthRequest, res, next) => {
  try {
    const db = getDb();
    const agents = db.prepare('SELECT * FROM agents WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json(agents);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const config = req.body;
    if (!config.name || !config.prompt) {
      return res.status(400).json({ error: 'Name and prompt are required', code: 'MISSING_PARAMS', statusCode: 400 });
    }
    
    const agent = await agentScheduler.createAgent(req.user.id, config);
    res.json(agent);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req: AuthRequest, res, next) => {
  try {
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found', code: 'NOT_FOUND', statusCode: 404 });
    }
    res.json(agent);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const updates = req.body;
    const agent = await agentScheduler.updateAgent(req.user.id, req.params.id, updates);
    res.json(agent);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    await agentScheduler.deleteAgent(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/run', async (req: AuthRequest, res, next) => {
  try {
    const result = await agentScheduler.runAgentManually(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/enable', async (req: AuthRequest, res, next) => {
  try {
    const agent = await agentScheduler.enableAgent(req.user.id, req.params.id);
    res.json(agent);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/disable', async (req: AuthRequest, res, next) => {
  try {
    const agent = await agentScheduler.disableAgent(req.user.id, req.params.id);
    res.json(agent);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/runs', (req: AuthRequest, res, next) => {
  try {
    const db = getDb();
    const runs = db.prepare('SELECT * FROM agent_runs WHERE agent_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.params.id, req.user.id);
    res.json(runs);
  } catch (err) {
    next(err);
  }
});

router.get('/runs/:runId', (req: AuthRequest, res, next) => {
  try {
    const db = getDb();
    const run = db.prepare('SELECT * FROM agent_runs WHERE id = ? AND user_id = ?').get(req.params.runId, req.user.id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found', code: 'NOT_FOUND', statusCode: 404 });
    }
    res.json(run);
  } catch (err) {
    next(err);
  }
});

router.post('/parse-cron', (req: AuthRequest, res, next) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required', code: 'MISSING_PARAMS', statusCode: 400 });
    }
    
    const parsed = parseCronFromNaturalLanguage(text);
    res.json(parsed);
  } catch (err) {
    next(err);
  }
});

export default router;
