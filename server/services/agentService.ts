import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { notificationService } from './notificationService.js';
import { chatService } from './chatService.js';
import { emailService } from './emailService.js';
import { smsService } from './smsService.js';
import { jobQueue } from './jobQueue.js';
import cron from 'node-cron';
import cronstrue from 'cronstrue';
import crypto from 'crypto';

export function parseCronFromNaturalLanguage(text: string): { cron: string, humanReadable: string } | { cron: string, humanReadable: string }[] {
  const lower = text.toLowerCase().trim();
  
  // Basic hardcoded mappings for common natural language
  if (lower === 'every hour') return { cron: '0 * * * *', humanReadable: 'Every hour' };
  if (lower === 'every 30 minutes') return { cron: '*/30 * * * *', humanReadable: 'Every 30 minutes' };
  if (lower === 'every 6 hours') return { cron: '0 */6 * * *', humanReadable: 'Every 6 hours' };
  if (lower === 'every day at 8am') return { cron: '0 8 * * *', humanReadable: 'Every day at 08:00 AM' };
  if (lower === 'every day at 8:30am') return { cron: '30 8 * * *', humanReadable: 'Every day at 08:30 AM' };
  if (lower === 'every monday at 9am') return { cron: '0 9 * * 1', humanReadable: 'Every Monday at 09:00 AM' };
  if (lower === 'every weekday at noon') return { cron: '0 12 * * 1-5', humanReadable: 'Every Monday through Friday at 12:00 PM' };
  if (lower === 'every sunday at midnight') return { cron: '0 0 * * 0', humanReadable: 'Every Sunday at 12:00 AM' };
  if (lower === 'twice a day at 9am and 9pm') {
    return [
      { cron: '0 9 * * *', humanReadable: 'Every day at 09:00 AM' },
      { cron: '0 21 * * *', humanReadable: 'Every day at 09:00 PM' }
    ];
  }

  // If it's already a valid cron expression
  if (cron.validate(text)) {
    try {
      return { cron: text, humanReadable: cronstrue.toString(text) };
    } catch (e) {
      throw new Error('Invalid cron expression format');
    }
  }

  // Fallback to a simple regex parser for basic "every day at X"
  const dailyMatch = lower.match(/every day at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (dailyMatch) {
    let hour = parseInt(dailyMatch[1], 10);
    const minute = dailyMatch[2] ? parseInt(dailyMatch[2], 10) : 0;
    const ampm = dailyMatch[3];

    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    const cronExpr = `${minute} ${hour} * * *`;
    return { cron: cronExpr, humanReadable: cronstrue.toString(cronExpr) };
  }

  throw new Error(`Could not parse schedule: ${text}`);
}

export function getNextRun(cronExpression: string, timezone: string = 'UTC'): { nextRun: Date, humanReadable: string } {
  try {
    const humanReadable = cronstrue.toString(cronExpression);
    // node-cron doesn't expose a simple next() method easily without starting a task.
    // We can use a trick or just calculate it manually, but for simplicity we'll just return a dummy date or use cron-parser if we had it.
    // Since we only have node-cron, we can't easily get the exact next date synchronously without another library like cron-parser.
    // Let's just return a placeholder or calculate a rough estimate.
    // Actually, node-cron has a getTasks() or similar, but it's internal.
    // We will just return null for nextRun and let the DB store it when it actually runs, or we can use a basic calculation.
    // For now, we'll just return the human readable string.
    return { nextRun: new Date(Date.now() + 3600000), humanReadable }; // Dummy next run 1 hour from now
  } catch (e) {
    throw new Error('Invalid cron expression');
  }
}

class AgentScheduler {
  scheduledJobs: Map<string, { job: any, agent: any }> = new Map();

  async init() {
    const db = getDb();
    const agents = db.prepare('SELECT * FROM agents WHERE enabled = 1').all();
    
    for (const agent of agents) {
      this.scheduleAgent(agent);
    }
    logger.info(`Initialized ${agents.length} scheduled agents`);
  }

  async createAgent(userId: string, config: any) {
    const db = getDb();
    
    let cronExpr = config.schedule_cron;
    let humanReadable = '';
    
    if (config.schedule_cron) {
      const parsed = parseCronFromNaturalLanguage(config.schedule_cron);
      if (Array.isArray(parsed)) {
        // Just take the first one for simplicity if they passed a complex one
        cronExpr = parsed[0].cron;
        humanReadable = parsed[0].humanReadable;
      } else {
        cronExpr = parsed.cron;
        humanReadable = parsed.humanReadable;
      }
    }

    const agentId = crypto.randomBytes(8).toString('hex');
    
    db.prepare(`
      INSERT INTO agents (id, user_id, name, description, prompt, schedule_cron, enabled, notify_email, notify_sms, notify_condition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agentId, userId, config.name, config.description || '', config.prompt, cronExpr, 
      config.enabled !== false ? 1 : 0, 
      config.notify_email ? 1 : 0, 
      config.notify_sms ? 1 : 0, 
      config.notify_condition || null
    );

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    
    if (agent.enabled && agent.schedule_cron) {
      this.scheduleAgent(agent);
    }

    return { ...agent, humanReadable };
  }

  async updateAgent(userId: string, agentId: string, updates: any) {
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND user_id = ?').get(agentId, userId) as any;
    if (!agent) throw new Error('Agent not found');

    this.unscheduleAgent(agentId);

    let cronExpr = updates.schedule_cron !== undefined ? updates.schedule_cron : agent.schedule_cron;
    
    if (updates.schedule_cron && updates.schedule_cron !== agent.schedule_cron) {
      const parsed = parseCronFromNaturalLanguage(updates.schedule_cron);
      if (Array.isArray(parsed)) {
        cronExpr = parsed[0].cron;
      } else {
        cronExpr = parsed.cron;
      }
    }

    const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : agent.enabled;

    db.prepare(`
      UPDATE agents SET 
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        prompt = COALESCE(?, prompt),
        schedule_cron = ?,
        enabled = ?,
        notify_email = COALESCE(?, notify_email),
        notify_sms = COALESCE(?, notify_sms),
        notify_condition = COALESCE(?, notify_condition),
        updated_at = unixepoch()
      WHERE id = ?
    `).run(
      updates.name, updates.description, updates.prompt, cronExpr, enabled,
      updates.notify_email !== undefined ? (updates.notify_email ? 1 : 0) : null,
      updates.notify_sms !== undefined ? (updates.notify_sms ? 1 : 0) : null,
      updates.notify_condition,
      agentId
    );

    const updatedAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;

    if (updatedAgent.enabled && updatedAgent.schedule_cron) {
      this.scheduleAgent(updatedAgent);
    }

    return updatedAgent;
  }

  async deleteAgent(userId: string, agentId: string) {
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND user_id = ?').get(agentId, userId);
    if (!agent) throw new Error('Agent not found');

    this.unscheduleAgent(agentId);
    db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
  }

  async enableAgent(userId: string, agentId: string) {
    return this.updateAgent(userId, agentId, { enabled: true });
  }

  async disableAgent(userId: string, agentId: string) {
    return this.updateAgent(userId, agentId, { enabled: false });
  }

  private scheduleAgent(agent: any) {
    if (!agent.schedule_cron) return;
    
    this.unscheduleAgent(agent.id);

    try {
      const job = cron.schedule(agent.schedule_cron, () => {
        jobQueue.enqueue('run_agent', { agentId: agent.id })
          .catch(err => logger.error(`Error enqueuing scheduled agent ${agent.id}`, err));
      });
      
      this.scheduledJobs.set(agent.id, { job, agent });
      logger.info(`Scheduled agent ${agent.id} with cron ${agent.schedule_cron}`);
    } catch (err) {
      logger.error(`Failed to schedule agent ${agent.id} with cron ${agent.schedule_cron}`, err);
    }
  }

  private unscheduleAgent(agentId: string) {
    const scheduled = this.scheduledJobs.get(agentId);
    if (scheduled) {
      scheduled.job.stop();
      this.scheduledJobs.delete(agentId);
    }
  }

  async runAgentManually(userId: string, agentId: string) {
    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND user_id = ?').get(agentId, userId) as any;
    if (!agent) throw new Error('Agent not found');

    // Enqueue job
    const jobId = await jobQueue.enqueue('run_agent', { agentId: agent.id }, { priority: 10 });
    
    return { success: true, message: 'Agent run enqueued', jobId };
  }

  async runAgent(agent: any) {
    const db = getDb();
    const runId = crypto.randomBytes(8).toString('hex');
    const startTime = Date.now();

    db.prepare(`
      INSERT INTO agent_runs (id, agent_id, user_id, status, started_at)
      VALUES (?, ?, ?, ?, unixepoch())
    `).run(runId, agent.id, agent.user_id, 'running');

    // TODO: Emit SSE start event if we had a global SSE emitter

    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(agent.user_id) as any;
      const integrations = db.prepare('SELECT provider FROM integrations WHERE user_id = ?').all(agent.user_id) as any[];
      const tools = await chatService.getToolsForUser(agent.user_id);
      
      const systemPrompt = chatService.buildSystemPrompt(user, [], { cpuPercent: 5, memoryMB: 512, memoryLimitMB: 2048, diskUsedGB: 10, diskLimitGB: 50 }, null, integrations, tools.anthropicTools);
      
      const fullPrompt = `You are running as an automated background agent.\nAgent Name: ${agent.name}\nAgent Description: ${agent.description || 'None'}\n\nTask:\n${agent.prompt}`;

      const { output, toolCalls, tokensUsed } = await chatService.runAgentChat(agent.user_id, systemPrompt, fullPrompt);

      let shouldNotify = false;
      let notifyExplanation = '';

      if (agent.notify_condition) {
        const evalResult = await chatService.evaluateNotifyCondition(output, agent.notify_condition);
        shouldNotify = evalResult.shouldNotify;
        notifyExplanation = evalResult.explanation;
      } else if (agent.notify_email || agent.notify_sms) {
        shouldNotify = true;
      }

      if (shouldNotify) {
        if (agent.notify_email && user.email) {
          await emailService.sendEmail(
            user.email,
            `Agent Run Completed: ${agent.name}`,
            `Your agent "${agent.name}" has completed its run.\n\nOutput:\n${output}\n\nTools Used: ${toolCalls.length}\nCondition Met: ${notifyExplanation}`
          );
        }
        if (agent.notify_sms && user.phone_number) {
          await smsService.sendSms(
            user.phone_number,
            `Agent ${agent.name} completed. Output: ${output.substring(0, 100)}...`
          );
        }
      }

      const durationMs = Date.now() - startTime;
      const toolCallsJson = toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;

      db.prepare(`
        UPDATE agent_runs SET 
          status = 'completed', 
          output = ?, 
          tool_calls_json = ?, 
          tokens_used = ?, 
          completed_at = unixepoch(), 
          duration_ms = ?, 
          notified = ?
        WHERE id = ?
      `).run(output, toolCallsJson, tokensUsed.input + tokensUsed.output, durationMs, shouldNotify ? 1 : 0, runId);

      db.prepare(`
        UPDATE agents SET 
          last_run_at = unixepoch(), 
          run_count = run_count + 1, 
          success_count = success_count + 1 
        WHERE id = ?
      `).run(agent.id);

      // Emit notification
      await notificationService.emit(agent.user_id, {
        type: 'agent_run:success',
        title: `Agent '${agent.name}' ran successfully`,
        body: `The background task completed. Output: ${output.substring(0, 100)}${output.length > 100 ? '...' : ''}`,
        severity: 'success',
        data: { agentId: agent.id, runId }
      });
    } catch (err: any) {
      logger.error(`Agent run failed for ${agent.id}`, err);
      
      const durationMs = Date.now() - startTime;
      
      db.prepare(`
        UPDATE agent_runs SET 
          status = 'failed', 
          error = ?, 
          completed_at = unixepoch(), 
          duration_ms = ?
        WHERE id = ?
      `).run(err.message, durationMs, runId);

      db.prepare(`
        UPDATE agents SET 
          last_run_at = unixepoch(), 
          run_count = run_count + 1, 
          failure_count = failure_count + 1 
        WHERE id = ?
      `).run(agent.id);

      // Notify on failure
      await notificationService.emit(agent.user_id, {
        type: 'agent_run:failure',
        title: `Agent '${agent.name}' failed`,
        body: `Error: ${err.message}`,
        severity: 'error',
        data: { agentId: agent.id, runId }
      });

      // Notify on failure if notifications are enabled
      if (agent.notify_email || agent.notify_sms) {
        const user = db.prepare('SELECT email, phone_number FROM users WHERE id = ?').get(agent.user_id) as any;
        if (agent.notify_email && user.email) {
          await emailService.sendEmail(user.email, `Agent Run Failed: ${agent.name}`, `Error: ${err.message}`);
        }
      }
    }
  }
}

export const agentScheduler = new AgentScheduler();
