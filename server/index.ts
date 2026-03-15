import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';

import { errorHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { logger } from './lib/logger.js';
import { initDb, getDb } from './db/index.js';
import { terminalService } from './services/terminalService.js';
import { notificationService } from './services/notificationService.js';
import { agentScheduler } from './services/agentService.js';
import { jobQueue } from './services/jobQueue.js';
import { containerService } from './services/containerService.js';
import { emailService } from './services/emailService.js';
import { smsService } from './services/smsService.js';
import cron from 'node-cron';

// Routes
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import filesRoutes from './routes/files.js';
import containerRoutes from './routes/container.js';
import sitesRoutes from './routes/sites.js';
import agentsRoutes from './routes/agents.js';
import integrationsRoutes from './routes/integrations.js';
import notificationsRoutes from './routes/notifications.js';
import webhooksRoutes from './routes/webhooks.js';
import apiRoutes from './routes/api.js';
import usageRoutes from './routes/usage.js';

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);

  // Initialize Database
  initDb();

  // Initialize Agent Scheduler
  await agentScheduler.init();

  // Register Job Processors
  jobQueue.process('provision_container', async (payload) => {
    const { userId, subdomain } = payload;
    try {
      await containerService.provisionContainer(userId, subdomain);
      await notificationService.emit(userId, {
        type: 'container:ready',
        title: 'Your Stone computer is ready!',
        body: 'Start chatting at stoneaio.com/chat',
        severity: 'success'
      });
    } catch (err: any) {
      await notificationService.emit(userId, {
        type: 'container:error',
        title: 'Container setup failed',
        body: `Error: ${err.message}. Contact support@stoneaio.com`,
        severity: 'error'
      });
      throw err;
    }
  }, { concurrency: 3, timeoutMs: 300000 });

  jobQueue.process('run_agent', async ({ agentId }) => {
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (agent) {
      await agentScheduler.runAgent(agent);
    }
  }, { concurrency: 5, timeoutMs: 600000 });

  jobQueue.process('send_email', async ({ userId, subject, body, html }) => {
    await emailService.sendToUser(userId, { subject, body, html });
  }, { concurrency: 10 });

  jobQueue.process('send_sms', async ({ userId, message }) => {
    await smsService.sendToUser(userId, message);
  }, { concurrency: 10 });

  jobQueue.process('site_build', async ({ userId, siteId }) => {
    await containerService.execInContainer(userId, 'npm run build', {
      workdir: `/home/stone/sites/${siteId}`,
      timeout: 180000
    });
    await notificationService.emit(userId, { 
      type: 'site:built', 
      title: 'Site built successfully', 
      body: `Site ${siteId} has been built.`,
      severity: 'success' 
    });
  }, { concurrency: 2, timeoutMs: 300000 });

  jobQueue.process('cleanup', async () => {
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    db.prepare("DELETE FROM agent_runs WHERE completed_at < ?").run(cutoff);
    db.prepare("DELETE FROM notifications WHERE created_at < ? AND read = 1").run(cutoff);
    await jobQueue.cleanupOld(7);
  }, { concurrency: 1 });

  // Start Job Queue
  jobQueue.start();

  // Schedule daily cleanup
  cron.schedule('0 3 * * *', () => {
    jobQueue.enqueue('cleanup', {});
  });

  // Middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Disabled for Vite development
  }));
  app.use(cors());
  app.use(compression());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
  
  // Rate limiting for API routes
  app.use('/api', apiLimiter);

  // API Routes (Mounting at /api/v1/*)
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/chat', chatRoutes);
  app.use('/api/v1/files', filesRoutes);
  app.use('/api/v1/container', containerRoutes);
  app.use('/api/v1/sites', sitesRoutes);
  app.use('/api/v1/agents', agentsRoutes);
  app.use('/api/v1/integrations', integrationsRoutes);
  app.use('/api/v1/notifications', notificationsRoutes);
  app.use('/api/v1/webhooks', webhooksRoutes);
  app.use('/api/v1/usage', usageRoutes);
  app.use('/api/v1/public', apiRoutes);

  // WebSocket Server for Terminal
  const wss = new WebSocketServer({ noServer: true });
  
  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const pathname = url.pathname;
    
    if (pathname === '/terminal/connect') {
      const token = url.searchParams.get('token');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const db = getDb();
      const session = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > unixepoch()').get(token) as any;
      
      if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as any;
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        terminalService.handleConnection(ws, user);
      });
    } else if (process.env.NODE_ENV !== 'production' && pathname === '/vite-hmr') {
       // Let Vite handle its own HMR upgrade
    }
  });

  // Global Error Handler
  app.use(errorHandler);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      configFile: path.resolve(process.cwd(), 'client/vite.config.js'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist/client');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, () => {
    logger.info(`Stone AIO Server running on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down gracefully...');
    httpServer.close(() => {
      logger.info('Closed out remaining connections.');
      process.exit(0);
    });
    
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
