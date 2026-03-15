import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import crypto from 'crypto';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobOptions {
  priority?: number;
  delayMs?: number;
  maxAttempts?: number;
  scheduledAt?: Date;
}

export interface ProcessorOptions {
  concurrency?: number;
  timeoutMs?: number;
}

export type JobHandler = (payload: any) => Promise<any>;

class JobQueue {
  private processors: Map<string, { handler: JobHandler, options: ProcessorOptions }> = new Map();
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private activeCounts: Map<string, number> = new Map();

  async enqueue(type: string, payload: any, options: JobOptions = {}) {
    const db = getDb();
    const id = crypto.randomBytes(16).toString('hex');
    const priority = options.priority ?? 5;
    const maxAttempts = options.maxAttempts ?? 3;
    const scheduledAt = options.scheduledAt 
      ? Math.floor(options.scheduledAt.getTime() / 1000)
      : Math.floor((Date.now() + (options.delayMs ?? 0)) / 1000);

    db.prepare(`
      INSERT INTO jobs (id, type, payload_json, priority, max_attempts, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, type, JSON.stringify(payload), priority, maxAttempts, scheduledAt);

    logger.info(`Job enqueued: ${type} (${id})`);
    return id;
  }

  process(type: string, handler: JobHandler, options: ProcessorOptions = {}) {
    this.processors.set(type, { handler, options: { concurrency: 1, timeoutMs: 300000, ...options } });
    this.activeCounts.set(type, 0);
    logger.info(`Processor registered for: ${type}`);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollInterval = setInterval(() => this.tick(), 2000);
    logger.info('Job queue started');
  }

  stop() {
    this.isRunning = false;
    if (this.pollInterval) clearInterval(this.pollInterval);
    logger.info('Job queue stopped');
  }

  private async tick() {
    if (!this.isRunning) return;

    for (const [type, processor] of this.processors.entries()) {
      const activeCount = this.activeCounts.get(type) || 0;
      const concurrency = processor.options.concurrency || 1;

      if (activeCount < concurrency) {
        const slotsAvailable = concurrency - activeCount;
        await this.processNextJobs(type, slotsAvailable);
      }
    }
  }

  private async processNextJobs(type: string, limit: number) {
    const db = getDb();
    
    // Find pending jobs for this type
    const jobs = db.prepare(`
      SELECT * FROM jobs 
      WHERE type = ? AND status = 'pending' AND scheduled_at <= unixepoch()
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `).all(type, limit) as any[];

    for (const job of jobs) {
      // Atomically mark as running
      const result = db.prepare(`
        UPDATE jobs SET status = 'running', started_at = unixepoch(), attempts = attempts + 1
        WHERE id = ? AND status = 'pending'
      `).run(job.id);

      if (result.changes > 0) {
        this.runJob(job);
      }
    }
  }

  private async runJob(job: any) {
    const type = job.type;
    const processor = this.processors.get(type);
    if (!processor) return;

    this.activeCounts.set(type, (this.activeCounts.get(type) || 0) + 1);

    try {
      const payload = JSON.parse(job.payload_json);
      
      // Timeout handling
      const timeoutMs = processor.options.timeoutMs || 300000;
      const result = await Promise.race([
        processor.handler(payload),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Job timed out')), timeoutMs))
      ]);

      const db = getDb();
      db.prepare(`
        UPDATE jobs SET status = 'completed', completed_at = unixepoch(), result_json = ?
        WHERE id = ?
      `).run(JSON.stringify(result));

      logger.info(`Job completed: ${type} (${job.id})`);
    } catch (err: any) {
      logger.error(`Job failed: ${type} (${job.id})`, err);
      
      const db = getDb();
      if (job.attempts < job.max_attempts) {
        // Exponential backoff: 2^attempts * 1000ms
        const backoffSeconds = Math.pow(2, job.attempts) * 1;
        const nextRun = Math.floor(Date.now() / 1000) + backoffSeconds;
        
        db.prepare(`
          UPDATE jobs SET status = 'pending', scheduled_at = ?, error = ?
          WHERE id = ?
        `).run(nextRun, err.message, job.id);
        
        logger.info(`Job rescheduled: ${type} (${job.id}) for ${new Date(nextRun * 1000).toISOString()}`);
      } else {
        db.prepare(`
          UPDATE jobs SET status = 'failed', completed_at = unixepoch(), error = ?
          WHERE id = ?
        `).run(err.message, job.id);
      }
    } finally {
      this.activeCounts.set(type, Math.max(0, (this.activeCounts.get(type) || 0) - 1));
    }
  }

  async getJob(jobId: string) {
    const db = getDb();
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  }

  async cancelJob(jobId: string) {
    const db = getDb();
    return db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(jobId);
  }

  async retryJob(jobId: string) {
    const db = getDb();
    return db.prepare("UPDATE jobs SET status = 'pending', attempts = 0, scheduled_at = unixepoch() WHERE id = ?").run(jobId);
  }

  async cleanupOld(days: number = 7) {
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
    return db.prepare("DELETE FROM jobs WHERE completed_at < ? OR (status = 'failed' AND completed_at < ?)").run(cutoff, cutoff);
  }
}

export const jobQueue = new JobQueue();
