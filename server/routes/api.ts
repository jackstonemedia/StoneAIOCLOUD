import { Router } from 'express';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import crypto from 'crypto';
import { chatService } from '../services/chatService.js';
import { containerService } from '../services/containerService.js';
import { agentScheduler } from '../services/agentService.js';

import { mcpService } from '../services/mcpService.js';
import { usageService } from '../services/usageService.js';
import { limitBy } from '../middleware/usageLimiter.js';
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const router = Router();

// MCP SSE transport
let transports: Map<string, SSEServerTransport> = new Map();

router.get('/mcp/:apiKey/sse', async (req, res) => {
  try {
    const { apiKey } = req.params;
    const server = await mcpService.getOrCreateServer(apiKey);
    
    const transport = new SSEServerTransport(`/api/v1/public/mcp/${apiKey}/messages`, res);
    transports.set(apiKey, transport);
    
    await server.connect(transport);
    
    logger.info(`MCP client connected for API key ${apiKey.substring(0, 8)}...`);
  } catch (err: any) {
    logger.error('MCP SSE error', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/mcp/:apiKey/messages', async (req, res) => {
  try {
    const { apiKey } = req.params;
    const transport = transports.get(apiKey);
    
    if (!transport) {
      return res.status(404).json({ error: 'Transport not found' });
    }
    
    await transport.handlePostMessage(req, res);
  } catch (err: any) {
    logger.error('MCP Messages error', err);
    res.status(500).json({ error: err.message });
  }
});

// Middleware to validate API Key
const validateApiKey = async (req: any, res: any, next: any) => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey) {
    return res.status(401).json({ error: 'X-API-Key header is missing' });
  }

  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const db = getDb();
  const keyRecord = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hash) as any;

  if (!keyRecord) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(keyRecord.user_id) as any;
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  // Rate limiting check (simplified)
  const plan = user.plan || 'free';
  const limits: any = {
    free: { req: 100, exec: 10 },
    pro: { req: 1000, exec: 100 },
    ultra: { req: Infinity, exec: Infinity }
  };

  // In a real app, we'd track usage in Redis or DB
  // For now, we'll just attach the user and key info
  req.user = user;
  req.apiKey = keyRecord;
  req.planLimits = limits[plan];

  next();
};

router.use(validateApiKey);
router.use(limitBy('api_requests'));

// Helper for responses
const apiResponse = (res: any, data: any, meta: any = {}) => {
  res.json({
    data,
    meta: {
      requestId: crypto.randomUUID(),
      timestamp: Math.floor(Date.now() / 1000),
      ...meta
    }
  });
};

// Chat
router.post('/chat', async (req, res) => {
  try {
    const { message, conversationId, model, skillId } = req.body;
    const userId = (req as any).user.id;
    
    const db = getDb();
    const integrations = db.prepare('SELECT provider FROM integrations WHERE user_id = ?').all(userId) as any[];
    const tools = await chatService.getToolsForUser(userId);
    const stats = await containerService.getStats(userId);
    
    const systemPrompt = chatService.buildSystemPrompt((req as any).user, [], stats, skillId || null, integrations, tools.anthropicTools);
    
    const result = await chatService.runAgentChat(userId, systemPrompt, message);
    
    // Record usage
    usageService.recordApiRequest(userId).catch(() => {});
    usageService.recordTokens(userId, result.tokensUsed.input, result.tokensUsed.output).catch(() => {});

    apiResponse(res, {
      response: result.output,
      conversationId: conversationId || crypto.randomBytes(8).toString('hex'),
      tokensUsed: result.tokensUsed,
      toolCallsMade: result.toolCalls.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Files
router.get('/files', async (req, res) => {
  try {
    const path = (req.query.path as string) || '/home/stone';
    const userId = (req as any).user.id;
    const files = await containerService.listDirectory(userId, path);
    apiResponse(res, { files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/files/read', async (req, res) => {
  try {
    const path = req.query.path as string;
    if (!path) return res.status(400).json({ error: 'Path is required' });
    const userId = (req as any).user.id;
    const content = await containerService.readFile(userId, path);
    apiResponse(res, { content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/files/write', async (req, res) => {
  try {
    const { path, content } = req.body;
    if (!path || content === undefined) return res.status(400).json({ error: 'Path and content are required' });
    const userId = (req as any).user.id;
    await containerService.writeFile(userId, path, content);
    apiResponse(res, { success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Exec
router.post('/exec', async (req, res) => {
  try {
    const { command, timeout, workdir } = req.body;
    const userId = (req as any).user.id;
    
    const startTime = Date.now();
    const result = await containerService.execInContainer(userId, command, { timeout, workdir });
    const duration = Date.now() - startTime;
    
    // Record usage
    usageService.recordApiRequest(userId).catch(() => {});
    usageService.recordExecution(userId).catch(() => {});

    apiResponse(res, {
      ...result,
      duration
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Container
router.get('/container/status', async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const status = await containerService.getContainerStatus(userId);
    apiResponse(res, { status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/container/stats', async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const stats = await containerService.getStats(userId);
    apiResponse(res, stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Agents
router.get('/agents', async (req, res) => {
  const userId = (req as any).user.id;
  const db = getDb();
  const agents = db.prepare('SELECT * FROM agents WHERE user_id = ?').all(userId);
  apiResponse(res, agents);
});

router.post('/agents/:id/run', async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const result = await agentScheduler.runAgentManually(userId, id);
    apiResponse(res, result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sites
router.get('/sites', async (req, res) => {
  const userId = (req as any).user.id;
  const db = getDb();
  const sites = db.prepare('SELECT * FROM sites WHERE user_id = ?').all(userId);
  apiResponse(res, sites);
});

// Memories
router.get('/memories', async (req, res) => {
  const userId = (req as any).user.id;
  const db = getDb();
  const memories = db.prepare('SELECT * FROM memories WHERE user_id = ?').all(userId);
  apiResponse(res, memories);
});

// MCP Config
router.get('/mcp-config', (req, res) => {
  const apiKey = req.header('X-API-Key'); // We use the one they provided to validate
  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
  
  res.json({
    claudeDesktopConfig: {
      "mcpServers": {
        "stone-aio": {
          "command": "npx",
          "args": ["-y", "mcp-remote", `${baseUrl}/api/v1/public/mcp/${apiKey}/sse`]
        }
      }
    },
    cursorConfig: {
      "mcpServers": {
        "stone-aio": {
          "url": `${baseUrl}/api/v1/public/mcp/${apiKey}/sse`
        }
      }
    }
  });
});

export default router;
