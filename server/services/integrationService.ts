import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { encrypt, decrypt } from '../lib/encrypt.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import axios from 'axios';
import { google } from 'googleapis';
import { WebClient } from '@slack/web-api';
import { Octokit } from '@octokit/rest';
import { Client as NotionClient } from '@notionhq/client';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

export class IntegrationService {
  async getOAuthUrl(userId: string, type: string, redirectUri: string) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = jwt.sign({ userId, type, nonce }, JWT_SECRET, { expiresIn: '10m' });

    switch (type) {
      case 'google': {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          redirectUri
        );
        return oauth2Client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/drive.file'
          ],
          state
        });
      }
      case 'github': {
        const params = new URLSearchParams({
          client_id: process.env.GITHUB_CLIENT_ID || '',
          redirect_uri: redirectUri,
          scope: 'repo read:user',
          state
        });
        return `https://github.com/login/oauth/authorize?${params.toString()}`;
      }
      case 'notion': {
        const params = new URLSearchParams({
          client_id: process.env.NOTION_CLIENT_ID || '',
          redirect_uri: redirectUri,
          response_type: 'code',
          owner: 'user',
          state
        });
        return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
      }
      case 'slack': {
        const params = new URLSearchParams({
          client_id: process.env.SLACK_CLIENT_ID || '',
          user_scope: 'channels:read,channels:history,chat:write,users:read,search:read',
          redirect_uri: redirectUri,
          state
        });
        return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
      }
      case 'linear': {
        const params = new URLSearchParams({
          client_id: process.env.LINEAR_CLIENT_ID || '',
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'read,write',
          state
        });
        return `https://linear.app/oauth/authorize?${params.toString()}`;
      }
      default:
        throw new Error(`Unsupported integration type: ${type}`);
    }
  }

  async handleCallback(code: string, state: string, redirectUri: string) {
    let decoded: any;
    try {
      decoded = jwt.verify(state, JWT_SECRET);
    } catch (err) {
      throw new Error('Invalid or expired state token');
    }

    const { userId, type } = decoded;
    let credentials: any = {};

    try {
      switch (type) {
        case 'google': {
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            redirectUri
          );
          const { tokens } = await oauth2Client.getToken(code);
          credentials = tokens;
          break;
        }
        case 'github': {
          const res = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: redirectUri
          }, { headers: { Accept: 'application/json' } });
          credentials = res.data;
          if (credentials.error) throw new Error(credentials.error_description);
          break;
        }
        case 'notion': {
          const encoded = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString('base64');
          const res = await axios.post('https://api.notion.com/v1/oauth/token', {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
          }, {
            headers: {
              Authorization: `Basic ${encoded}`,
              'Content-Type': 'application/json'
            }
          });
          credentials = res.data;
          break;
        }
        case 'slack': {
          const res = await axios.post('https://slack.com/api/oauth.v2.access', new URLSearchParams({
            client_id: process.env.SLACK_CLIENT_ID || '',
            client_secret: process.env.SLACK_CLIENT_SECRET || '',
            code,
            redirect_uri: redirectUri
          }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
          credentials = res.data;
          if (!credentials.ok) throw new Error(credentials.error);
          break;
        }
        case 'linear': {
          const res = await axios.post('https://api.linear.app/oauth/token', new URLSearchParams({
            client_id: process.env.LINEAR_CLIENT_ID || '',
            client_secret: process.env.LINEAR_CLIENT_SECRET || '',
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
          }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
          credentials = res.data;
          break;
        }
        default:
          throw new Error(`Unsupported integration type: ${type}`);
      }
    } catch (err: any) {
      logger.error(`[IntegrationService] Failed to exchange code for ${type}`, err.response?.data || err.message);
      throw new Error(`Failed to connect to ${type}`);
    }

    const encrypted = encrypt(JSON.stringify(credentials));
    const db = getDb();
    
    db.prepare(`
      INSERT INTO integrations (id, user_id, provider, encrypted_credentials)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, provider) DO UPDATE SET
      encrypted_credentials = excluded.encrypted_credentials,
      updated_at = unixepoch()
    `).run(crypto.randomBytes(8).toString('hex'), userId, type, encrypted);

    return { success: true, type };
  }

  async getCredentials(userId: string, type: string) {
    const db = getDb();
    const integration = db.prepare('SELECT encrypted_credentials FROM integrations WHERE user_id = ? AND provider = ?').get(userId, type) as any;
    if (!integration) return null;

    let credentials = JSON.parse(decrypt(integration.encrypted_credentials));

    // Handle auto-refresh for Google
    if (type === 'google' && credentials.expiry_date && Date.now() > credentials.expiry_date - 60000) {
      if (credentials.refresh_token) {
        try {
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
          );
          oauth2Client.setCredentials(credentials);
          const { credentials: newCreds } = await oauth2Client.refreshAccessToken();
          credentials = { ...credentials, ...newCreds };
          
          db.prepare('UPDATE integrations SET encrypted_credentials = ?, updated_at = unixepoch() WHERE user_id = ? AND provider = ?')
            .run(encrypt(JSON.stringify(credentials)), userId, type);
        } catch (err) {
          logger.error(`[IntegrationService] Failed to refresh Google token for user ${userId}`, err);
        }
      }
    }

    return credentials;
  }

  async disconnectIntegration(userId: string, integId: string) {
    const db = getDb();
    const integration = db.prepare('SELECT provider, encrypted_credentials FROM integrations WHERE id = ? AND user_id = ?').get(integId, userId) as any;
    if (!integration) throw new Error('Integration not found');

    const credentials = JSON.parse(decrypt(integration.encrypted_credentials));

    try {
      if (integration.provider === 'google' && credentials.access_token) {
        await axios.post(`https://oauth2.googleapis.com/revoke?token=${credentials.access_token}`);
      } else if (integration.provider === 'github' && credentials.access_token) {
        const encoded = Buffer.from(`${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString('base64');
        await axios.delete(`https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/grant`, {
          headers: { Authorization: `Basic ${encoded}` },
          data: { access_token: credentials.access_token }
        });
      } else if (integration.provider === 'slack' && credentials.authed_user?.access_token) {
        await axios.post('https://slack.com/api/auth.revoke', new URLSearchParams({
          token: credentials.authed_user.access_token
        }));
      }
      // Notion and Linear don't have standard revoke endpoints or they are complex, just delete from DB
    } catch (err) {
      logger.warn(`[IntegrationService] Failed to revoke token for ${integration.provider}`, err);
    }

    db.prepare('DELETE FROM integrations WHERE id = ? AND user_id = ?').run(integId, userId);
    return { success: true };
  }

  async getActiveTools(userId: string) {
    const db = getDb();
    const integrations = db.prepare('SELECT provider FROM integrations WHERE user_id = ?').all() as any[];
    const tools: any[] = [];

    for (const integ of integrations) {
      if (integ.provider === 'google') {
        tools.push(...this.getGoogleTools(userId));
      } else if (integ.provider === 'github') {
        tools.push(...this.getGithubTools(userId));
      } else if (integ.provider === 'notion') {
        tools.push(...this.getNotionTools(userId));
      } else if (integ.provider === 'slack') {
        tools.push(...this.getSlackTools(userId));
      } else if (integ.provider === 'linear') {
        tools.push(...this.getLinearTools(userId));
      }
    }

    return tools;
  }

  private getGoogleTools(userId: string) {
    const getAuth = async () => {
      const creds = await this.getCredentials(userId, 'google');
      if (!creds) throw new Error('Google credentials not found');
      const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      oauth2Client.setCredentials(creds);
      return oauth2Client;
    };

    return [
      {
        name: 'gmail_list',
        description: 'List Gmail messages',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            query: { type: 'string' },
            labelIds: { type: 'array', items: { type: 'string' } }
          }
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const gmail = google.gmail({ version: 'v1', auth });
          const res = await gmail.users.messages.list({
            userId: 'me',
            maxResults: args.limit || 10,
            q: args.query,
            labelIds: args.labelIds
          });
          return JSON.stringify(res.data);
        }
      },
      {
        name: 'gmail_read',
        description: 'Read a Gmail message by ID',
        parameters: {
          type: 'object',
          properties: {
            messageId: { type: 'string' }
          },
          required: ['messageId']
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const gmail = google.gmail({ version: 'v1', auth });
          const res = await gmail.users.messages.get({
            userId: 'me',
            id: args.messageId,
            format: 'full'
          });
          return JSON.stringify(res.data);
        }
      },
      {
        name: 'gmail_send',
        description: 'Send an email via Gmail',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string' },
            subject: { type: 'string' },
            body: { type: 'string' },
            html: { type: 'string' }
          },
          required: ['to', 'subject', 'body']
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const gmail = google.gmail({ version: 'v1', auth });
          const messageParts = [
            `To: ${args.to}`,
            `Subject: ${args.subject}`,
            'MIME-Version: 1.0',
            `Content-Type: ${args.html ? 'text/html' : 'text/plain'}; charset="UTF-8"`,
            '',
            args.html || args.body
          ];
          const message = messageParts.join('\n');
          const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encodedMessage }
          });
          return JSON.stringify(res.data);
        }
      },
      {
        name: 'gmail_search',
        description: 'Search Gmail messages',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          required: ['query']
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const gmail = google.gmail({ version: 'v1', auth });
          const res = await gmail.users.messages.list({
            userId: 'me',
            q: args.query,
            maxResults: 20
          });
          return JSON.stringify(res.data);
        }
      },
      {
        name: 'gmail_archive',
        description: 'Archive a Gmail message',
        parameters: {
          type: 'object',
          properties: {
            messageId: { type: 'string' }
          },
          required: ['messageId']
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const gmail = google.gmail({ version: 'v1', auth });
          const res = await gmail.users.messages.modify({
            userId: 'me',
            id: args.messageId,
            requestBody: {
              removeLabelIds: ['INBOX']
            }
          });
          return JSON.stringify(res.data);
        }
      },
      {
        name: 'calendar_list_events',
        description: 'List Google Calendar events',
        parameters: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'ISO string' },
            end: { type: 'string', description: 'ISO string' },
            maxResults: { type: 'number' }
          }
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const calendar = google.calendar({ version: 'v3', auth });
          const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: args.start || new Date().toISOString(),
            timeMax: args.end,
            maxResults: args.maxResults || 10,
            singleEvents: true,
            orderBy: 'startTime'
          });
          return JSON.stringify(res.data.items);
        }
      },
      {
        name: 'calendar_create_event',
        description: 'Create a Google Calendar event',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            start: { type: 'string', description: 'ISO string' },
            end: { type: 'string', description: 'ISO string' },
            description: { type: 'string' },
            attendees: { type: 'array', items: { type: 'string' } }
          },
          required: ['title', 'start', 'end']
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const calendar = google.calendar({ version: 'v3', auth });
          const event = {
            summary: args.title,
            description: args.description,
            start: { dateTime: args.start },
            end: { dateTime: args.end },
            attendees: args.attendees?.map((email: string) => ({ email }))
          };
          const res = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: event
          });
          return JSON.stringify(res.data);
        }
      },
      {
        name: 'calendar_find_free_time',
        description: 'Find free time in Google Calendar',
        parameters: {
          type: 'object',
          properties: {
            durationMinutes: { type: 'number' },
            withinDays: { type: 'number' }
          },
          required: ['durationMinutes']
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const calendar = google.calendar({ version: 'v3', auth });
          const timeMin = new Date();
          const timeMax = new Date();
          timeMax.setDate(timeMax.getDate() + (args.withinDays || 7));
          
          const res = await calendar.freebusy.query({
            requestBody: {
              timeMin: timeMin.toISOString(),
              timeMax: timeMax.toISOString(),
              items: [{ id: 'primary' }]
            }
          });
          return JSON.stringify(res.data.calendars?.primary?.busy);
        }
      },
      {
        name: 'drive_list_files',
        description: 'List Google Drive files',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            mimeType: { type: 'string' }
          }
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const drive = google.drive({ version: 'v3', auth });
          let q = args.query || '';
          if (args.mimeType) {
            q += (q ? ' and ' : '') + `mimeType='${args.mimeType}'`;
          }
          const res = await drive.files.list({
            q,
            pageSize: 10,
            fields: 'nextPageToken, files(id, name, mimeType, webViewLink)'
          });
          return JSON.stringify(res.data.files);
        }
      },
      {
        name: 'drive_download_to_stone',
        description: 'Download a Google Drive file to Stone container',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            path: { type: 'string' }
          },
          required: ['fileId', 'path']
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const drive = google.drive({ version: 'v3', auth });
          const res = await drive.files.get({ fileId: args.fileId, alt: 'media' }, { responseType: 'stream' });
          
          // Using containerService to write file
          const { containerService } = await import('./containerService.js');
          
          const chunks: any[] = [];
          for await (const chunk of res.data as any) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          await containerService.execInContainer(userId, `echo "${buffer.toString('base64')}" | base64 -d > ${args.path}`);
          
          return `File downloaded to ${args.path}`;
        }
      },
      {
        name: 'drive_upload',
        description: 'Upload a file to Google Drive',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            content: { type: 'string' },
            mimeType: { type: 'string' }
          },
          required: ['name', 'content']
        },
        execute: async (args: any) => {
          const auth = await getAuth();
          const drive = google.drive({ version: 'v3', auth });
          const res = await drive.files.create({
            requestBody: {
              name: args.name,
              mimeType: args.mimeType || 'text/plain'
            },
            media: {
              mimeType: args.mimeType || 'text/plain',
              body: args.content
            }
          });
          return JSON.stringify(res.data);
        }
      }
    ];
  }

  private getGithubTools(userId: string) {
    const getOctokit = async () => {
      const creds = await this.getCredentials(userId, 'github');
      if (!creds) throw new Error('GitHub credentials not found');
      return new Octokit({ auth: creds.access_token });
    };

    return [
      {
        name: 'github_list_repos',
        description: 'List GitHub repositories',
        parameters: {
          type: 'object',
          properties: {
            visibility: { type: 'string', enum: ['all', 'public', 'private'] },
            sort: { type: 'string', enum: ['created', 'updated', 'pushed', 'full_name'] }
          }
        },
        execute: async (args: any) => {
          const octokit = await getOctokit();
          const res = await octokit.repos.listForAuthenticatedUser({
            visibility: args.visibility || 'all',
            sort: args.sort || 'updated',
            per_page: 20
          });
          return JSON.stringify(res.data.map((r: any) => ({ name: r.full_name, url: r.html_url, private: r.private })));
        }
      },
      {
        name: 'github_list_issues',
        description: 'List GitHub issues',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            state: { type: 'string', enum: ['open', 'closed', 'all'] }
          },
          required: ['owner', 'repo']
        },
        execute: async (args: any) => {
          const octokit = await getOctokit();
          const res = await octokit.issues.listForRepo({
            owner: args.owner,
            repo: args.repo,
            state: args.state || 'open'
          });
          return JSON.stringify(res.data.map((i: any) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url })));
        }
      },
      {
        name: 'github_create_issue',
        description: 'Create a GitHub issue',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } }
          },
          required: ['owner', 'repo', 'title', 'body']
        },
        execute: async (args: any) => {
          const octokit = await getOctokit();
          const res = await octokit.issues.create({
            owner: args.owner,
            repo: args.repo,
            title: args.title,
            body: args.body,
            labels: args.labels
          });
          return JSON.stringify({ number: res.data.number, url: res.data.html_url });
        }
      },
      {
        name: 'github_get_file',
        description: 'Get a file from a GitHub repository',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            path: { type: 'string' },
            ref: { type: 'string' }
          },
          required: ['owner', 'repo', 'path']
        },
        execute: async (args: any) => {
          const octokit = await getOctokit();
          const res = await octokit.repos.getContent({
            owner: args.owner,
            repo: args.repo,
            path: args.path,
            ref: args.ref
          });
          if (Array.isArray(res.data)) throw new Error('Path is a directory, not a file');
          if (res.data.type !== 'file') throw new Error('Path is not a file');
          const content = Buffer.from(res.data.content, 'base64').toString('utf8');
          return content;
        }
      },
      {
        name: 'github_push_file',
        description: 'Push a file to a GitHub repository',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            path: { type: 'string' },
            content: { type: 'string' },
            message: { type: 'string' },
            branch: { type: 'string' }
          },
          required: ['owner', 'repo', 'path', 'content', 'message']
        },
        execute: async (args: any) => {
          const octokit = await getOctokit();
          let sha;
          try {
            const current = await octokit.repos.getContent({
              owner: args.owner,
              repo: args.repo,
              path: args.path,
              ref: args.branch
            });
            if (!Array.isArray(current.data)) {
              sha = current.data.sha;
            }
          } catch (e) {
            // File doesn't exist yet
          }
          
          const res = await octokit.repos.createOrUpdateFileContents({
            owner: args.owner,
            repo: args.repo,
            path: args.path,
            message: args.message,
            content: Buffer.from(args.content).toString('base64'),
            sha,
            branch: args.branch
          });
          return JSON.stringify({ commit: res.data.commit.sha });
        }
      },
      {
        name: 'github_list_prs',
        description: 'List GitHub Pull Requests',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            state: { type: 'string', enum: ['open', 'closed', 'all'] }
          },
          required: ['owner', 'repo']
        },
        execute: async (args: any) => {
          const octokit = await getOctokit();
          const res = await octokit.pulls.list({
            owner: args.owner,
            repo: args.repo,
            state: args.state || 'open'
          });
          return JSON.stringify(res.data.map((pr: any) => ({ number: pr.number, title: pr.title, state: pr.state, url: pr.html_url })));
        }
      },
      {
        name: 'github_create_pr',
        description: 'Create a GitHub Pull Request',
        parameters: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            head: { type: 'string' },
            base: { type: 'string' }
          },
          required: ['owner', 'repo', 'title', 'head', 'base']
        },
        execute: async (args: any) => {
          const octokit = await getOctokit();
          const res = await octokit.pulls.create({
            owner: args.owner,
            repo: args.repo,
            title: args.title,
            body: args.body,
            head: args.head,
            base: args.base
          });
          return JSON.stringify({ number: res.data.number, url: res.data.html_url });
        }
      }
    ];
  }

  private getNotionTools(userId: string) {
    const getNotion = async () => {
      const creds = await this.getCredentials(userId, 'notion');
      if (!creds) throw new Error('Notion credentials not found');
      return new NotionClient({ auth: creds.access_token });
    };

    return [
      {
        name: 'notion_search',
        description: 'Search Notion pages and databases',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            filter: { type: 'object' }
          },
          required: ['query']
        },
        execute: async (args: any) => {
          const notion = await getNotion();
          const res = await notion.search({
            query: args.query,
            filter: args.filter
          });
          return JSON.stringify(res.results);
        }
      },
      {
        name: 'notion_list_databases',
        description: 'List Notion databases',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          const notion = await getNotion();
          const res = await notion.search({
            filter: { property: 'object', value: 'database' as any }
          });
          return JSON.stringify(res.results);
        }
      },
      {
        name: 'notion_query_database',
        description: 'Query a Notion database',
        parameters: {
          type: 'object',
          properties: {
            databaseId: { type: 'string' },
            filter: { type: 'object' },
            sorts: { type: 'array', items: { type: 'object' } }
          },
          required: ['databaseId']
        },
        execute: async (args: any) => {
          const notion = await getNotion();
          const res = await (notion.databases as any).query({
            database_id: args.databaseId,
            filter: args.filter,
            sorts: args.sorts
          });
          return JSON.stringify(res.results);
        }
      },
      {
        name: 'notion_create_page',
        description: 'Create a Notion page',
        parameters: {
          type: 'object',
          properties: {
            parentId: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['parentId', 'title']
        },
        execute: async (args: any) => {
          const notion = await getNotion();
          const res = await notion.pages.create({
            parent: { page_id: args.parentId },
            properties: {
              title: {
                title: [{ text: { content: args.title } }]
              }
            },
            children: args.content ? [
              {
                object: 'block',
                type: 'paragraph',
                paragraph: {
                  rich_text: [{ type: 'text', text: { content: args.content } }]
                }
              }
            ] : []
          } as any);
          return JSON.stringify(res);
        }
      },
      {
        name: 'notion_update_page',
        description: 'Update a Notion page properties',
        parameters: {
          type: 'object',
          properties: {
            pageId: { type: 'string' },
            properties: { type: 'object' }
          },
          required: ['pageId', 'properties']
        },
        execute: async (args: any) => {
          const notion = await getNotion();
          const res = await notion.pages.update({
            page_id: args.pageId,
            properties: args.properties
          });
          return JSON.stringify(res);
        }
      }
    ];
  }

  private getSlackTools(userId: string) {
    const getSlack = async () => {
      const creds = await this.getCredentials(userId, 'slack');
      if (!creds) throw new Error('Slack credentials not found');
      return new WebClient(creds.authed_user.access_token);
    };

    return [
      {
        name: 'slack_list_channels',
        description: 'List Slack channels',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number' }
          }
        },
        execute: async (args: any) => {
          const slack = await getSlack();
          const res = await slack.conversations.list({ limit: args.limit || 100 });
          return JSON.stringify(res.channels?.map(c => ({ id: c.id, name: c.name })));
        }
      },
      {
        name: 'slack_send_message',
        description: 'Send a message to a Slack channel',
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            text: { type: 'string' }
          },
          required: ['channel', 'text']
        },
        execute: async (args: any) => {
          const slack = await getSlack();
          const res = await slack.chat.postMessage({
            channel: args.channel,
            text: args.text
          });
          return JSON.stringify({ ts: res.ts });
        }
      },
      {
        name: 'slack_get_messages',
        description: 'Get messages from a Slack channel',
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            limit: { type: 'number' }
          },
          required: ['channel']
        },
        execute: async (args: any) => {
          const slack = await getSlack();
          const res = await slack.conversations.history({
            channel: args.channel,
            limit: args.limit || 20
          });
          return JSON.stringify(res.messages);
        }
      },
      {
        name: 'slack_search',
        description: 'Search Slack messages',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          required: ['query']
        },
        execute: async (args: any) => {
          const slack = await getSlack();
          const res = await slack.search.messages({
            query: args.query
          });
          return JSON.stringify(res.messages?.matches);
        }
      },
      {
        name: 'slack_list_users',
        description: 'List Slack users',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          const slack = await getSlack();
          const res = await slack.users.list({});
          return JSON.stringify(res.members?.map(m => ({ id: m.id, name: m.name, real_name: m.real_name })));
        }
      }
    ];
  }

  private getLinearTools(userId: string) {
    const getLinear = async () => {
      const creds = await this.getCredentials(userId, 'linear');
      if (!creds) throw new Error('Linear credentials not found');
      return axios.create({
        baseURL: 'https://api.linear.app/graphql',
        headers: { Authorization: `Bearer ${creds.access_token}` }
      });
    };

    return [
      {
        name: 'linear_list_issues',
        description: 'List Linear issues',
        parameters: {
          type: 'object',
          properties: {
            teamId: { type: 'string' },
            state: { type: 'string' },
            assignee: { type: 'string' }
          }
        },
        execute: async (args: any) => {
          const client = await getLinear();
          const query = `
            query {
              issues(first: 20) {
                nodes {
                  id
                  title
                  state { name }
                  assignee { name }
                }
              }
            }
          `;
          const res = await client.post('', { query });
          return JSON.stringify(res.data.data.issues.nodes);
        }
      },
      {
        name: 'linear_create_issue',
        description: 'Create a Linear issue',
        parameters: {
          type: 'object',
          properties: {
            teamId: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'number' }
          },
          required: ['teamId', 'title']
        },
        execute: async (args: any) => {
          const client = await getLinear();
          const query = `
            mutation IssueCreate($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                issue { id title }
              }
            }
          `;
          const variables = {
            input: {
              teamId: args.teamId,
              title: args.title,
              description: args.description,
              priority: args.priority
            }
          };
          const res = await client.post('', { query, variables });
          return JSON.stringify(res.data.data.issueCreate.issue);
        }
      },
      {
        name: 'linear_update_issue',
        description: 'Update a Linear issue',
        parameters: {
          type: 'object',
          properties: {
            issueId: { type: 'string' },
            stateId: { type: 'string' },
            priority: { type: 'number' },
            description: { type: 'string' }
          },
          required: ['issueId']
        },
        execute: async (args: any) => {
          const client = await getLinear();
          const query = `
            mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
              issueUpdate(id: $id, input: $input) {
                issue { id title state { name } }
              }
            }
          `;
          const variables = {
            id: args.issueId,
            input: {
              stateId: args.stateId,
              priority: args.priority,
              description: args.description
            }
          };
          const res = await client.post('', { query, variables });
          return JSON.stringify(res.data.data.issueUpdate.issue);
        }
      },
      {
        name: 'linear_list_teams',
        description: 'List Linear teams',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          const client = await getLinear();
          const query = `
            query {
              teams {
                nodes { id name key }
              }
            }
          `;
          const res = await client.post('', { query });
          return JSON.stringify(res.data.data.teams.nodes);
        }
      }
    ];
  }
}

export const integrationService = new IntegrationService();
