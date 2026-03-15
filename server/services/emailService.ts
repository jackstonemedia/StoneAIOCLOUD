import { logger } from '../lib/logger.js';
import sgMail from '@sendgrid/mail';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM_EMAIL = 'Stone AIO <noreply@stoneaio.com>';

export class EmailService {
  async sendEmail(to: string, subject: string, html: string) {
    if (!process.env.SENDGRID_API_KEY) {
      logger.warn(`[EmailService] SendGrid not configured. Would send to ${to}: ${subject}`);
      return { success: true, simulated: true };
    }

    try {
      await sgMail.send({
        to,
        from: FROM_EMAIL,
        subject,
        html,
      });
      logger.info(`[EmailService] Sent email to ${to}`);
      return { success: true };
    } catch (err: any) {
      logger.error(`[EmailService] Failed to send email to ${to}`, err);
      throw err;
    }
  }

  async sendToUser(userId: string, { subject, body, html }: { subject: string, body: string, html?: string }) {
    // We would fetch user email from DB here if we only had userId, but usually we pass email directly.
    // For consistency with the prompt, assuming we might need to fetch it.
    const { getDb } = await import('../db/index.js');
    const db = getDb();
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as any;
    
    if (!user || !user.email) {
      throw new Error('User does not have an email address');
    }

    const finalHtml = html || this.getBaseTemplate(subject, body);
    return this.sendEmail(user.email, subject, finalHtml);
  }

  private getBaseTemplate(title: string, content: string) {
    return `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0E0E0C; color: #FFFFFF;">
        <div style="border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 20px;">
          <h2 style="color: #C8973C; margin: 0;">Stone AIO</h2>
        </div>
        <h1 style="color: #FFFFFF; font-size: 24px;">${title}</h1>
        <div style="color: #CCCCCC; line-height: 1.6;">
          ${content}
        </div>
        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; font-size: 12px; color: #666; text-align: center;">
          Stone AIO &middot; <a href="https://stoneaio.com" style="color: #C8973C; text-decoration: none;">stoneaio.com</a> &middot; <a href="#" style="color: #666; text-decoration: underline;">Unsubscribe</a>
        </div>
      </div>
    `;
  }

  async sendAgentResult(userId: string, agentName: string, output: string) {
    const formattedOutput = output.replace(/\n/g, '<br>');
    const content = `
      <p>Your Stone Agent <strong>${agentName}</strong> has completed its run.</p>
      <div style="background-color: #1A1A1A; padding: 15px; border-radius: 8px; margin: 20px 0; font-family: monospace; font-size: 14px; overflow-x: auto;">
        ${formattedOutput}
      </div>
      <p style="font-size: 12px; color: #888;">Timestamp: ${new Date().toISOString()}</p>
      <div style="margin: 30px 0;">
        <a href="${process.env.FRONTEND_URL || 'https://stoneaio.com'}/dashboard" style="background: #C8973C; color: #0E0E0C; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Dashboard</a>
      </div>
    `;
    return this.sendToUser(userId, {
      subject: `Stone Agent: ${agentName} Result`,
      body: '',
      html: this.getBaseTemplate(`Agent Result: ${agentName}`, content)
    });
  }

  async sendWelcomeEmail(to: string, name: string) {
    const content = `
      <p>Hi ${name},</p>
      <p>Your personal AI cloud computer is currently being set up. This usually takes just a few minutes.</p>
      <p>Once it's ready, you'll be able to access your terminal, chat, and hosted sites.</p>
      <div style="margin: 30px 0;">
        <a href="${process.env.FRONTEND_URL || 'https://stoneaio.com'}/dashboard" style="background: #C8973C; color: #0E0E0C; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to Dashboard</a>
      </div>
      <p>Welcome aboard,<br>The Stone AIO Team</p>
    `;
    return this.sendEmail(to, 'Welcome to Stone AIO - Your AI Computer is provisioning', this.getBaseTemplate('Welcome to Stone AIO', content));
  }

  async sendPasswordReset(to: string, token: string) {
    const resetUrl = `${process.env.FRONTEND_URL || 'https://stoneaio.com'}/reset-password?token=${token}`;
    const content = `
      <p>We received a request to reset the password for your Stone AIO account.</p>
      <p>Click the button below to choose a new password. This link will expire in 1 hour.</p>
      <div style="margin: 30px 0;">
        <a href="${resetUrl}" style="background: #C8973C; color: #0E0E0C; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
      </div>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `;
    return this.sendEmail(to, 'Reset your Stone AIO password', this.getBaseTemplate('Reset Password', content));
  }

  async sendEmailVerification(to: string, token: string) {
    const verifyUrl = `${process.env.FRONTEND_URL || 'https://stoneaio.com'}/verify-email?token=${token}`;
    const content = `
      <p>Thanks for signing up for Stone AIO! Please verify your email address by clicking the button below.</p>
      <div style="margin: 30px 0;">
        <a href="${verifyUrl}" style="background: #C8973C; color: #0E0E0C; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Verify Email</a>
      </div>
    `;
    return this.sendEmail(to, 'Verify your Stone AIO email', this.getBaseTemplate('Verify Email', content));
  }
}

export const emailService = new EmailService();
