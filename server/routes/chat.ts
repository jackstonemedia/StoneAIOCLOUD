import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { chatService } from '../services/chatService.js';
import { usageService } from '../services/usageService.js';
import { logger } from '../lib/logger.js';
import { limitBy } from '../middleware/usageLimiter.js';
import { getDb } from '../db/index.js';

const router = Router();

router.use(requireAuth);

// 1. SSE Streaming Endpoint
router.post('/message', limitBy('tokens'), async (req: AuthRequest, res, next) => {
  try {
    const { conversationId, content, model = 'claude-3-5-sonnet-20241022', attachments, skillId } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required', code: 'MISSING_CONTENT', statusCode: 400 });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const stream = chatService.streamChat({
        userId: req.user.id,
        conversationId,
        content,
        model,
        attachments,
        skillId
      });

      let finalConvId = conversationId;
      let finalTokens = { input: 0, output: 0 };

      for await (const event of stream) {
        if (event.conversationId) {
          finalConvId = event.conversationId;
          finalTokens = event.tokensUsed;
        } else {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done', conversationId: finalConvId, usage: { input_tokens: finalTokens.input, output_tokens: finalTokens.output } })}\n\n`);
      
      // Record usage
      usageService.recordTokens(req.user.id, finalTokens.input, finalTokens.output, model).catch(err => {
        logger.error('Failed to record token usage', err);
      });

      res.end();
    } catch (streamErr: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: streamErr.message || 'Streaming error' })}\n\n`);
      res.end();
    }
  } catch (err) {
    next(err);
  }
});

// 2. Get Conversations
router.get('/conversations', async (req: AuthRequest, res, next) => {
  try {
    const db = getDb();
    const conversations = db.prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

// 3. Get Conversation by ID
router.get('/conversations/:id', async (req: AuthRequest, res, next) => {
  try {
    const db = getDb();
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id) as any;
    
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND', statusCode: 404 });
    }

    const messages = db.prepare('SELECT id, role, content, tool_calls, tool_call_id, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id);
    
    res.json({ ...conv, messages });
  } catch (err) {
    next(err);
  }
});

// 4. Delete Conversation
router.delete('/conversations/:id', async (req: AuthRequest, res, next) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND', statusCode: 404 });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 5. Rename Conversation
router.patch('/conversations/:id', async (req: AuthRequest, res, next) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required', code: 'MISSING_TITLE', statusCode: 400 });
    }

    const db = getDb();
    const result = db.prepare('UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ? RETURNING *').get(title, req.params.id, req.user.id);
    
    if (!result) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND', statusCode: 404 });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 6. Clear Messages
router.post('/conversations/:id/clear', async (req: AuthRequest, res, next) => {
  try {
    const db = getDb();
    // Verify ownership
    const conv = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND', statusCode: 404 });
    }

    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 7. Get Models
router.get('/models', async (req: AuthRequest, res, next) => {
  try {
    // Return a static list of supported models for now
    const models = [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic' },
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai' },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google' },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'google' }
    ];
    res.json(models);
  } catch (err) {
    next(err);
  }
});

// 8. Search Messages
router.get('/search', async (req: AuthRequest, res, next) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: 'Search query required', code: 'MISSING_QUERY', statusCode: 400 });
    }

    const db = getDb();
    const results = db.prepare(`
      SELECT m.id, m.content, m.created_at, c.id as conversation_id, c.title as conversation_title
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.user_id = ? AND m.content LIKE ? AND m.role = 'user'
      ORDER BY m.created_at DESC
      LIMIT 50
    `).all(req.user.id, `%${query}%`);

    res.json(results);
  } catch (err) {
    next(err);
  }
});

export default router;
