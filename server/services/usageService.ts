import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import crypto from 'crypto';

export const STONE_PLANS: Record<string, any> = {
  free: {
    tokens_per_month: 100_000,
    sms_per_month: 20,
    storage_gb: 2,
    sites_max: 2,
    api_requests_per_day: 100,
    executions_per_day: 50,
    agents_max: 3,
    container_ram_mb: 512,
  },
  pro: {
    tokens_per_month: 2_000_000,
    sms_per_month: 500,
    storage_gb: 10,
    sites_max: 20,
    api_requests_per_day: 1000,
    executions_per_day: 500,
    agents_max: 25,
    container_ram_mb: 1024,
  },
  ultra: {
    tokens_per_month: Infinity,
    sms_per_month: Infinity,
    storage_gb: 100,
    sites_max: Infinity,
    api_requests_per_day: Infinity,
    executions_per_day: Infinity,
    agents_max: Infinity,
    container_ram_mb: 4096,
  }
};

class UsageService {
  private getMonthlyPeriodKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private getDailyPeriodKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  async recordTokens(userId: string, inputTokens: number, outputTokens: number, _model?: string) {
    const db = getDb();
    const amount = inputTokens + outputTokens;
    const periodKey = this.getMonthlyPeriodKey();
    
    db.prepare(`
      INSERT INTO usage_events (user_id, resource, amount, period_key)
      VALUES (?, 'tokens', ?, ?)
    `).run(userId, amount, periodKey);
    
    logger.info(`Recorded ${amount} tokens for user ${userId}`);
  }

  async recordSMS(userId: string) {
    const db = getDb();
    const periodKey = this.getMonthlyPeriodKey();
    
    db.prepare(`
      INSERT INTO usage_events (user_id, resource, amount, period_key)
      VALUES (?, 'sms', 1, ?)
    `).run(userId, periodKey);
  }

  async recordExecution(userId: string) {
    const db = getDb();
    const periodKey = this.getDailyPeriodKey();
    
    db.prepare(`
      INSERT INTO usage_events (user_id, resource, amount, period_key)
      VALUES (?, 'executions', 1, ?)
    `).run(userId, periodKey);
  }

  async recordApiRequest(userId: string) {
    const db = getDb();
    const periodKey = this.getDailyPeriodKey();
    
    db.prepare(`
      INSERT INTO usage_events (user_id, resource, amount, period_key)
      VALUES (?, 'api_requests', 1, ?)
    `).run(userId, periodKey);
  }

  async updateStorageUsed(userId: string, bytes: number) {
    const db = getDb();
    const gb = bytes / (1024 * 1024 * 1024);
    // Storage is a point-in-time value, but we can record it as an event to track history
    // For simplicity, we'll just update a field in users table if it existed, 
    // but here we follow the prompt's table structure.
    const periodKey = this.getMonthlyPeriodKey();
    
    // We replace the previous storage record for this period to keep it current
    db.prepare(`DELETE FROM usage_events WHERE user_id = ? AND resource = 'storage' AND period_key = ?`).run(userId, periodKey);
    db.prepare(`
      INSERT INTO usage_events (user_id, resource, amount, period_key)
      VALUES (?, 'storage', ?, ?)
    `).run(userId, Math.round(gb * 100) / 100, periodKey);
  }

  async checkLimit(userId: string, resource: string) {
    const db = getDb();
    const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(userId) as any;
    const planName = user?.plan || 'free';
    const plan = STONE_PLANS[planName];

    let periodKey: string;
    let limit: number;
    let resetAt: Date;

    const now = new Date();

    if (resource === 'tokens') {
      periodKey = this.getMonthlyPeriodKey();
      limit = plan.tokens_per_month;
      resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else if (resource === 'sms') {
      periodKey = this.getMonthlyPeriodKey();
      limit = plan.sms_per_month;
      resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else if (resource === 'executions') {
      periodKey = this.getDailyPeriodKey();
      limit = plan.executions_per_day;
      resetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    } else if (resource === 'api_requests') {
      periodKey = this.getDailyPeriodKey();
      limit = plan.api_requests_per_day;
      resetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    } else if (resource === 'storage') {
      periodKey = this.getMonthlyPeriodKey();
      limit = plan.storage_gb;
      resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else {
      throw new Error(`Unknown resource: ${resource}`);
    }

    const usage = db.prepare(`
      SELECT SUM(amount) as total FROM usage_events 
      WHERE user_id = ? AND resource = ? AND period_key = ?
    `).get(userId, resource, periodKey) as any;

    const used = usage?.total || 0;
    const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
    const allowed = limit === Infinity || used < limit;

    return {
      allowed,
      used,
      limit,
      remaining,
      resetAt
    };
  }

  async getUserUsage(userId: string) {
    const db = getDb();
    const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(userId) as any;
    const planName = user?.plan || 'free';
    
    const resources = ['tokens', 'sms', 'executions', 'api_requests', 'storage'];
    const usageStats = [];

    for (const res of resources) {
      const limitInfo = await this.checkLimit(userId, res);
      usageStats.push({
        resource: res,
        used: limitInfo.used,
        limit: limitInfo.limit,
        percent: limitInfo.limit === Infinity ? 0 : (limitInfo.used / limitInfo.limit) * 100,
        period: res === 'tokens' || res === 'sms' || res === 'storage' ? 'Monthly' : 'Daily'
      });
    }

    return { plan: planName, usage: usageStats };
  }

  async resetMonthlyUsage(userId: string) {
    const db = getDb();
    const periodKey = this.getMonthlyPeriodKey();
    // In a real app, this might involve archiving or just deleting current month's events 
    // if we want to start fresh on renewal. But usually we just let the period_key handle it.
    // Here we'll just log it.
    logger.info(`Resetting monthly usage for user ${userId} for period ${periodKey}`);
  }

  async updateUserPlan(userId: string, plan: 'free' | 'pro' | 'ultra') {
    const db = getDb();
    db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);
    logger.info(`Updated user ${userId} plan to ${plan}`);
  }

  async getUsageHistory(userId: string, limit: number = 6) {
    const db = getDb();
    return db.prepare(`
      SELECT resource, SUM(amount) as total, period_key 
      FROM usage_events 
      WHERE user_id = ? 
      GROUP BY resource, period_key 
      ORDER BY period_key DESC 
      LIMIT ?
    `).all(userId, limit * 5); // 5 resources per period
  }

  async getDailyHistory(userId: string, days: number = 30) {
    const db = getDb();
    const history = db.prepare(`
      SELECT 
        period_key as date,
        SUM(CASE WHEN resource = 'tokens' THEN amount ELSE 0 END) as tokens,
        SUM(CASE WHEN resource = 'executions' THEN amount ELSE 0 END) as executions,
        SUM(CASE WHEN resource = 'api_requests' THEN amount ELSE 0 END) as api_requests,
        SUM(CASE WHEN resource = 'sms' THEN amount ELSE 0 END) as sms
      FROM usage_events
      WHERE user_id = ? AND period_key LIKE '____-__-__'
      GROUP BY period_key
      ORDER BY period_key DESC
      LIMIT ?
    `).all(userId, days) as any[];

    return history.reverse();
  }

  async getAggregateStats() {
    const db = getDb();
    return db.prepare(`
      SELECT resource, SUM(amount) as total, period_key 
      FROM usage_events 
      GROUP BY resource, period_key 
      ORDER BY period_key DESC 
      LIMIT 50
    `).all();
  }

  async getTopUsersByTokens(limit: number = 10) {
    const db = getDb();
    const periodKey = this.getMonthlyPeriodKey();
    return db.prepare(`
      SELECT u.id, u.email, u.name, SUM(e.amount) as total_tokens
      FROM users u
      JOIN usage_events e ON u.id = e.user_id
      WHERE e.resource = 'tokens' AND e.period_key = ?
      GROUP BY u.id
      ORDER BY total_tokens DESC
      LIMIT ?
    `).all(periodKey, limit);
  }
}

export const usageService = new UsageService();
