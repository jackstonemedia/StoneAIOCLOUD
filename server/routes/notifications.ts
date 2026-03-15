import { Router } from 'express';
import { notificationService } from '../services/notificationService.js';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

// SSE endpoint
router.get('/stream', async (req, res) => {
  // Auth via query token for SSE
  const token = req.query.token as string;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getDb();
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > unixepoch()').get(token) as any;
  
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  notificationService.subscribe(session.user_id, res);
});

// Paginated list
router.get('/', requireAuth, (req, res) => {
  const userId = (req as any).user.id;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  
  const db = getDb();
  const notifications = db.prepare(`
    SELECT * FROM notifications 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ?').get(userId) as any;

  res.json({
    data: notifications,
    meta: {
      total: total.count,
      limit,
      offset
    }
  });
});

// Read all
router.post('/read-all', requireAuth, (req, res) => {
  const userId = (req as any).user.id;
  const db = getDb();
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
  res.json({ success: true });
});

// Mark one as read
router.patch('/:id/read', requireAuth, (req, res) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const db = getDb();
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  res.json({ success: true });
});

// Clear all
router.delete('/', requireAuth, (req, res) => {
  const userId = (req as any).user.id;
  const db = getDb();
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
  res.json({ success: true });
});

export default router;
