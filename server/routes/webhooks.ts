import express, { Router } from 'express';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { smsService } from '../services/smsService.js';
import { chatService } from '../services/chatService.js';
import { usageService } from '../services/usageService.js';
import { notificationService } from '../services/notificationService.js';
import twilio from 'twilio';
import Stripe from 'stripe';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const router = Router();

// Twilio SMS Webhook
router.post('/twilio/sms', async (req, res) => {
  try {
    const { From, Body, MessageSid } = req.body;
    const db = getDb();

    // 1. Validate Twilio signature (in production with real token)
    if (process.env.TWILIO_AUTH_TOKEN && process.env.APP_URL) {
      const twilioSignature = req.headers['x-twilio-signature'] as string;
      const url = `${process.env.APP_URL}/api/v1/webhooks/twilio/sms`;
      const isValid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, twilioSignature, url, req.body);
      if (!isValid) {
        logger.warn(`Invalid Twilio signature for message ${MessageSid}`);
        return res.status(403).send('Forbidden');
      }
    }

    // 3. Idempotency check
    const existingWebhook = db.prepare('SELECT id FROM processed_webhooks WHERE id = ?').get(MessageSid);
    if (existingWebhook) {
      logger.info(`Skipping duplicate Twilio webhook ${MessageSid}`);
      return res.status(200).send('<Response></Response>');
    }

    // 4. Find user by phone_number
    const user = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(From) as any;

    if (!user) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("This number isn't linked to a Stone AIO account. Visit stoneaio.com to get started.");
      return res.type('text/xml').send(twiml.toString());
    }

    // 5. Check Usage Limit
    const limitCheck = await usageService.checkLimit(user.id, 'sms');
    if (!limitCheck.allowed) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(`Stone AIO: SMS limit reached for your ${user.plan} plan. Upgrade at stoneaio.com/billing`);
      return res.type('text/xml').send(twiml.toString());
    }

    const twiml = new twilio.twiml.MessagingResponse();
    const bodyUpper = Body.trim().toUpperCase();

    // 6. Handle special commands
    if (bodyUpper === 'STOP') {
      db.prepare('UPDATE users SET sms_enabled = 0 WHERE id = ?').run(user.id);
      twiml.message("You've been unsubscribed from Stone AIO SMS.");
    } else if (bodyUpper === 'START') {
      db.prepare('UPDATE users SET sms_enabled = 1 WHERE id = ?').run(user.id);
      twiml.message("Stone AIO SMS re-enabled.");
    } else if (bodyUpper === 'STATUS') {
      // Basic status check
      const status = user.container_status || 'unknown';
      twiml.message(`Stone AIO Container Status: ${status}`);
    } else if (bodyUpper === 'HELP') {
      twiml.message("Stone AIO Commands:\nSTOP - Unsubscribe\nSTART - Resubscribe\nSTATUS - Check container status\nOr just chat naturally with your AI computer.");
    } else {
      // 7. Otherwise: find or create conversation
      let conversation = db.prepare('SELECT * FROM conversations WHERE user_id = ? AND title LIKE ? ORDER BY created_at DESC LIMIT 1').get(user.id, 'SMS from%') as any;
      
      if (!conversation) {
        const convId = crypto.randomBytes(8).toString('hex');
        db.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)')
          .run(convId, user.id, `SMS from ${From}`);
        conversation = { id: convId };
      }

      // 8. Call chatService
      // We need a non-streaming version or we can just collect the stream
      const integrations = db.prepare('SELECT provider FROM integrations WHERE user_id = ?').all(user.id) as any[];
      const tools = await chatService.getToolsForUser(user.id);
      const systemPrompt = chatService.buildSystemPrompt(user, [], { cpuPercent: 5, memoryMB: 512, memoryLimitMB: 2048, diskUsedGB: 10, diskLimitGB: 50 }, null, integrations, tools.anthropicTools);
      
      const { output } = await chatService.runAgentChat(user.id, systemPrompt, Body);

      // Record usage
      usageService.recordSMS(user.id).catch(() => {});

      // Emit notification
      await notificationService.emit(user.id, {
        type: 'sms_received',
        title: `SMS from ${From}`,
        body: Body.substring(0, 100) + (Body.length > 100 ? '...' : ''),
        severity: 'info',
        data: { from: From, body: Body }
      });

      // 9. Trim response if needed
      let reply = output;
      if (reply.length > 1590) {
        // Try to trim to last complete sentence
        const truncated = reply.substring(0, 1550);
        const lastPeriod = truncated.lastIndexOf('.');
        if (lastPeriod > 1000) {
          reply = truncated.substring(0, lastPeriod + 1) + "\n[Full reply at stoneaio.com]";
        } else {
          reply = truncated + "...\n[Full reply at stoneaio.com]";
        }
      }

      // 10. Reply via TwiML
      twiml.message(reply);
    }

    // 11. Mark webhook as processed
    db.prepare('INSERT INTO processed_webhooks (id, source) VALUES (?, ?)').run(MessageSid, 'twilio');

    res.type('text/xml').send(twiml.toString());
  } catch (err) {
    logger.error('Error processing Twilio webhook', err);
    res.status(500).send('<Response></Response>');
  }
});

// SendGrid Inbound Email Webhook
const upload = multer({ dest: '/tmp/uploads/' });

// Stripe Webhook
let stripe: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-01-27-preview.acacia' as any
  });
}

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(500).send('Stripe is not configured');
  }
  const sig = req.headers['stripe-signature'] as string;
  let event;

  try {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = req.body;
    }
  } catch (err: any) {
    logger.error(`Stripe Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = getDb();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const plan = session.metadata?.plan as any;

        if (userId && plan) {
          await usageService.updateUserPlan(userId, plan);
          await notificationService.emit(userId, {
            type: 'billing:updated',
            title: 'Plan Upgraded!',
            body: `You are now on the ${plan} plan. Enjoy your new limits!`,
            severity: 'success'
          });
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer as string;
        const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(customerId) as any;
        
        if (user) {
          await usageService.resetMonthlyUsage(user.id);
          logger.info(`Monthly usage reset for user ${user.id} via invoice success`);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;
        const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(customerId) as any;
        
        if (user) {
          await usageService.updateUserPlan(user.id, 'free');
          await notificationService.emit(user.id, {
            type: 'billing:canceled',
            title: 'Subscription Canceled',
            body: 'Your subscription has been canceled. You have been moved to the free plan.',
            severity: 'warn'
          });
        }
        break;
      }
    }
    res.json({ received: true });
  } catch (err: any) {
    logger.error(`Error processing Stripe event ${event.type}: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sendgrid/inbound', upload.any(), async (req, res) => {
  try {
    const db = getDb();
    const { from, to, subject, text, html } = req.body;
    
    // SendGrid sends an envelope JSON string
    let envelope;
    try {
      envelope = JSON.parse(req.body.envelope);
    } catch (e) {
      envelope = { to: [to], from };
    }

    // Extract Message-ID for idempotency
    // SendGrid might pass it in headers or we can hash the body
    const messageId = req.body['headers'] ? req.body['headers'].match(/Message-ID:\s*(<[^>]+>)/i)?.[1] : crypto.createHash('md5').update(text || '').digest('hex');
    const safeMessageId = messageId || crypto.randomBytes(16).toString('hex');

    // 3. Idempotency check
    const existingWebhook = db.prepare('SELECT id FROM processed_webhooks WHERE id = ?').get(safeMessageId);
    if (existingWebhook) {
      logger.info(`Skipping duplicate SendGrid webhook ${safeMessageId}`);
      return res.status(200).send('OK');
    }

    // 4. Find user by their @mail.stoneaio.com address
    // The 'to' address might be formatted like "Name <subdomain@mail.stoneaio.com>"
    const toAddress = envelope.to[0].toLowerCase();
    const inboundEmailMatch = toAddress.match(/([a-z0-9-]+)@mail\.stoneaio\.com/);
    
    if (!inboundEmailMatch) {
      logger.warn(`Received email to non-stoneaio address: ${toAddress}`);
      return res.status(200).send('OK');
    }

    const inboundEmail = inboundEmailMatch[0];
    const user = db.prepare('SELECT * FROM users WHERE inbound_email = ?').get(inboundEmail) as any;

    if (!user) {
      logger.warn(`No user found for inbound email: ${inboundEmail}`);
      return res.status(200).send('OK');
    }

    // 5. Clean body: strip signatures, quoted replies
    // A simple heuristic: take everything before "On ... wrote:" or "--"
    let cleanedText = text || '';
    cleanedText = cleanedText.split(/\nOn .* wrote:/i)[0];
    cleanedText = cleanedText.split(/\n--/)[0];
    cleanedText = cleanedText.trim();

    // 6. Save attachments
    const attachmentsDir = `/home/stone/documents/email-attachments`;
    // We would normally save this inside the user's container, but for this demo we'll just log it
    // or save it to a local temp dir if we don't have direct container access here.
    // In a real implementation, we'd use containerService.writeFile
    
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        logger.info(`Received attachment: ${file.originalname}`);
        // await containerService.writeFile(user.id, `${attachmentsDir}/${file.originalname}`, fs.readFileSync(file.path));
        fs.unlinkSync(file.path); // Cleanup temp file
      }
    }

    // 7. Create conversation
    const convId = crypto.randomBytes(8).toString('hex');
    db.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)')
      .run(convId, user.id, subject || 'Inbound Email');

    // 8. Run chatService
    const integrations = db.prepare('SELECT provider FROM integrations WHERE user_id = ?').all(user.id) as any[];
    const tools = await chatService.getToolsForUser(user.id);
    const systemPrompt = chatService.buildSystemPrompt(user, [], { cpuPercent: 5, memoryMB: 512, memoryLimitMB: 2048, diskUsedGB: 10, diskLimitGB: 50 }, null, integrations, tools.anthropicTools);
    const { output } = await chatService.runAgentChat(user.id, systemPrompt, cleanedText);

    // Emit notification
    await notificationService.emit(user.id, {
      type: 'email_received',
      title: `Email: ${subject || 'No Subject'}`,
      body: `From: ${from}\n\n${cleanedText.substring(0, 100)}${cleanedText.length > 100 ? '...' : ''}`,
      severity: 'info',
      data: { from, subject, body: cleanedText }
    });

    // 9. Reply via SendGrid
    // We need to import emailService dynamically or at top
    const { emailService } = await import('../services/emailService.js');
    
    // Extract sender email
    const senderMatch = from.match(/<([^>]+)>/);
    const senderEmail = senderMatch ? senderMatch[1] : from;

    await emailService.sendEmail(
      senderEmail,
      `Re: ${subject || 'Your message to Stone AIO'}`,
      `<div style="font-family: sans-serif; white-space: pre-wrap;">${output}</div><br><br><hr><small>Sent from your Stone AIO computer (${inboundEmail})</small>`
    );

    // 11. Mark webhook as processed
    db.prepare('INSERT INTO processed_webhooks (id, source) VALUES (?, ?)').run(safeMessageId, 'sendgrid');

    // 10. Always return 200
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Error processing SendGrid webhook', err);
    res.status(200).send('OK'); // Always return 200 to SendGrid to prevent retries on our errors
  }
});

export default router;
