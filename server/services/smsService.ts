import { logger } from '../lib/logger.js';
import { getDb } from '../db/index.js';
import twilio from 'twilio';
import crypto from 'crypto';

const client = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN 
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+1234567890';

export class SmsService {
  async sendSms(to: string, message: string) {
    if (!client) {
      logger.warn(`[SmsService] Twilio not configured. Would send to ${to}: ${message}`);
      return { success: true, simulated: true };
    }

    try {
      // Split message if > 1590 chars
      const MAX_LEN = 1590;
      if (message.length > MAX_LEN) {
        const parts = Math.ceil(message.length / MAX_LEN);
        for (let i = 0; i < parts; i++) {
          const chunk = message.substring(i * MAX_LEN, (i + 1) * MAX_LEN);
          await client.messages.create({
            body: `(${i + 1}/${parts}) ${chunk}`,
            from: TWILIO_PHONE,
            to
          });
        }
      } else {
        await client.messages.create({
          body: message,
          from: TWILIO_PHONE,
          to
        });
      }
      logger.info(`[SmsService] Sent SMS to ${to}`);
      return { success: true };
    } catch (err: any) {
      logger.error(`[SmsService] Failed to send SMS to ${to}`, err);
      throw err;
    }
  }

  async sendToUser(userId: string, message: string) {
    const db = getDb();
    const user = db.prepare('SELECT phone_number, sms_enabled FROM users WHERE id = ?').get(userId) as any;
    
    if (!user || !user.phone_number) {
      throw new Error('User does not have a linked phone number');
    }
    if (!user.sms_enabled) {
      throw new Error('User has disabled SMS notifications');
    }

    await this.sendSms(user.phone_number, message);

    // Log to notifications table
    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomBytes(8).toString('hex'), userId, 'sms', 'SMS Sent', message);
  }

  async sendAgentResult(userId: string, agentName: string, summary: string) {
    let formatted = `[Stone Agent: ${agentName}]\n${summary}`;
    if (formatted.length > 1500) {
      formatted = formatted.substring(0, 1500) + '...\n\n[Full result at stoneaio.com]';
    }
    return this.sendToUser(userId, formatted);
  }

  async sendVerificationCode(to: string, code: string) {
    const message = `Your Stone AIO verification code is: ${code}. It expires in 10 minutes.`;
    return this.sendSms(to, message);
  }

  async confirmPhone(userId: string, code: string, phoneNumber: string) {
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    const db = getDb();
    
    const user = db.prepare('SELECT verify_phone_code, verify_phone_expires FROM users WHERE id = ?').get(userId) as any;
    
    if (!user || user.verify_phone_code !== hash) {
      throw new Error('Invalid verification code');
    }
    
    if (user.verify_phone_expires < Math.floor(Date.now() / 1000)) {
      throw new Error('Verification code expired');
    }

    db.prepare(`
      UPDATE users SET 
        phone_number = ?, 
        sms_enabled = 1, 
        verify_phone_code = NULL, 
        verify_phone_expires = NULL 
      WHERE id = ?
    `).run(phoneNumber, userId);

    return { success: true };
  }
}

export const smsService = new SmsService();
