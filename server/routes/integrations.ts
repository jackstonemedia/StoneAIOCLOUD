import { Router } from 'express';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { integrationService } from '../services/integrationService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Get all integrations for the current user
router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const integrations = db.prepare('SELECT id, provider, created_at, updated_at FROM integrations WHERE user_id = ?').all((req as any).user!.id);
    res.json(integrations);
  } catch (err) {
    logger.error('Failed to get integrations', err);
    res.status(500).json({ error: 'Failed to get integrations' });
  }
});

// Redirect to OAuth provider
router.get('/connect/:type', requireAuth, async (req, res) => {
  try {
    const { type } = req.params;
    const redirectUri = `${process.env.APP_URL || 'https://stoneaio.com'}/api/v1/integrations/callback/${type}`;
    const url = await integrationService.getOAuthUrl((req as any).user!.id, type, redirectUri);
    res.redirect(url);
  } catch (err: any) {
    logger.error(`Failed to get OAuth URL for ${req.params.type}`, err);
    res.status(400).json({ error: err.message });
  }
});

// OAuth Callback
router.get('/callback/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { code, state, error } = req.query;

    if (error) {
      throw new Error(`OAuth Error: ${error}`);
    }

    if (!code || !state) {
      throw new Error('Missing code or state');
    }

    const redirectUri = `${process.env.APP_URL || 'https://stoneaio.com'}/api/v1/integrations/callback/${type}`;
    await integrationService.handleCallback(code as string, state as string, redirectUri);

    // Redirect back to frontend integrations page
    res.redirect(`${process.env.FRONTEND_URL || 'https://stoneaio.com'}/dashboard/integrations?success=true&provider=${type}`);
  } catch (err: any) {
    logger.error(`OAuth callback failed for ${req.params.type}`, err);
    res.redirect(`${process.env.FRONTEND_URL || 'https://stoneaio.com'}/dashboard/integrations?error=${encodeURIComponent(err.message)}`);
  }
});

// Disconnect integration
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await integrationService.disconnectIntegration((req as any).user!.id, id);
    res.json({ success: true });
  } catch (err: any) {
    logger.error(`Failed to disconnect integration ${req.params.id}`, err);
    res.status(400).json({ error: err.message });
  }
});

// Test integration
router.post('/:id/test', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const integration = db.prepare('SELECT provider FROM integrations WHERE id = ? AND user_id = ?').get(id, (req as any).user!.id) as any;
    
    if (!integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    const creds = await integrationService.getCredentials((req as any).user!.id, integration.provider);
    if (!creds) {
      throw new Error('Credentials not found or invalid');
    }

    // Actually test the connection
    if (integration.provider === 'google') {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials(creds);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      await gmail.users.getProfile({ userId: 'me' });
    } else if (integration.provider === 'github') {
      const { Octokit } = await import('@octokit/rest');
      const octokit = new Octokit({ auth: creds.access_token });
      await octokit.users.getAuthenticated();
    } else if (integration.provider === 'notion') {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: creds.access_token });
      await notion.users.me({});
    } else if (integration.provider === 'slack') {
      const { WebClient } = await import('@slack/web-api');
      const slack = new WebClient(creds.access_token);
      await slack.auth.test();
    } else if (integration.provider === 'linear') {
      const axios = (await import('axios')).default;
      await axios.post('https://api.linear.app/graphql', { query: '{ viewer { id } }' }, {
        headers: { Authorization: `Bearer ${creds.access_token}` }
      });
    }

    res.json({ success: true, message: 'Integration is working correctly' });
  } catch (err: any) {
    logger.error(`Failed to test integration ${req.params.id}`, err);
    res.status(400).json({ error: err.message });
  }
});

export default router;
