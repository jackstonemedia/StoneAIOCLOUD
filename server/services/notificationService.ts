import { Response } from 'express';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';

export interface NotificationEvent {
  type: string;
  title: string;
  body: string;
  data?: any;
  severity?: 'info' | 'success' | 'warn' | 'error';
  id?: string;
}

class NotificationService {
  private clients: Map<string, Set<Response>> = new Map();

  constructor() {
    // Start heartbeat interval
    setInterval(() => {
      this.heartbeat();
    }, 30000);
  }

  private heartbeat() {
    this.clients.forEach((clientSet) => {
      clientSet.forEach((res) => {
        res.write(': heartbeat\n\n');
      });
    });
  }

  subscribe(userId: string, res: Response) {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    
    const clientSet = this.clients.get(userId)!;
    clientSet.add(res);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write('retry: 10000\n\n');

    logger.info(`User ${userId} subscribed to notifications`);

    res.on('close', () => {
      clientSet.delete(res);
      if (clientSet.size === 0) {
        this.clients.delete(userId);
      }
      logger.info(`User ${userId} unsubscribed from notifications`);
    });
  }

  async emit(userId: string, event: NotificationEvent) {
    const db = getDb();
    const severity = event.severity || 'info';
    
    try {
      // Save to database
      const result = db.prepare(`
        INSERT INTO notifications (user_id, type, title, message, read)
        VALUES (?, ?, ?, ?, 0)
      `).run(userId, event.type, event.title, event.body);
      
      const notificationId = result.lastInsertRowid.toString();
      const notification = {
        ...event,
        id: notificationId,
        severity,
        created_at: Math.floor(Date.now() / 1000)
      };

      // Push to SSE clients
      const clientSet = this.clients.get(userId);
      if (clientSet) {
        const data = JSON.stringify(notification);
        clientSet.forEach((res) => {
          res.write(`id: ${notificationId}\n`);
          res.write(`event: notification\n`);
          res.write(`data: ${data}\n\n`);
        });
      }

      logger.info(`Notification emitted for user ${userId}: ${event.type}`);
    } catch (err) {
      logger.error(`Failed to emit notification for user ${userId}`, err);
    }
  }
}

export const notificationService = new NotificationService();
