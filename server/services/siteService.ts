import { getDb } from '../db/index.js';
import { containerService } from './containerService.js';
import { jobQueue } from './jobQueue.js';
import axios from 'axios';
import { logger } from '../lib/logger.js';
import crypto from 'crypto';

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://caddy:2019';

export class SiteService {
  
  private async getNextPort(userId: string): Promise<number> {
    const db = getDb();
    const result = db.prepare('SELECT MAX(port) as maxPort FROM sites WHERE user_id = ?').get(userId) as any;
    return (result?.maxPort || 8000) + 1;
  }

  async createSite(userId: string, { name, type, template }: { name: string, type: string, template?: boolean }) {
    const db = getDb();
    const user = db.prepare('SELECT subdomain FROM users WHERE id = ?').get(userId) as any;
    if (!user) throw new Error('User not found');

    const domain = `${name}.${user.subdomain}.stoneaio.com`;
    
    // Check if site exists
    const existing = db.prepare('SELECT id FROM sites WHERE domain = ?').get(domain);
    if (existing) throw new Error('Site name already taken');

    const port = await this.getNextPort(userId);
    const path = `/home/stone/sites/${name}`;

    // Create directory
    await containerService.execInContainer(userId, `mkdir -p "${path}"`);

    if (template) {
      switch (type) {
        case 'static':
          await this.scaffoldStatic(userId, path);
          break;
        case 'node':
          await this.scaffoldNode(userId, path, name);
          break;
        case 'python':
          await this.scaffoldPython(userId, path);
          break;
        case 'react':
          await this.scaffoldReact(userId, path, name);
          break;
        case 'next':
          await this.scaffoldNext(userId, path, name);
          break;
        default:
          throw new Error(`Unknown site type: ${type}`);
      }
    }

    const siteId = crypto.randomBytes(8).toString('hex');

    db.prepare('INSERT INTO sites (id, user_id, name, domain, path, type, port, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(siteId, userId, name, domain, path, type, port, 'stopped');

    return { id: siteId, name, domain, path, type, port, status: 'stopped' };
  }

  private async scaffoldStatic(userId: string, path: string) {
    const html = `<!DOCTYPE html>\n<html>\n<head>\n  <title>My Stone Site</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Hello from Stone AIO!</h1>\n  <script src="script.js"></script>\n</body>\n</html>`;
    const css = `body { font-family: sans-serif; text-align: center; padding: 50px; }`;
    const js = `console.log('Site loaded');`;

    await containerService.writeFile(userId, `${path}/index.html`, html);
    await containerService.writeFile(userId, `${path}/style.css`, css);
    await containerService.writeFile(userId, `${path}/script.js`, js);
  }

  private async scaffoldNode(userId: string, path: string, name: string) {
    const pkg = {
      name,
      version: '1.0.0',
      main: 'server.js',
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4.18.2' }
    };
    const server = `const express = require('express');\nconst app = express();\nconst port = process.env.PORT || 3000;\n\napp.get('/', (req, res) => {\n  res.send('Hello from Node.js on Stone AIO!');\n});\n\napp.listen(port, () => {\n  console.log(\`Server running on port \${port}\`);\n});`;

    await containerService.writeFile(userId, `${path}/package.json`, JSON.stringify(pkg, null, 2));
    await containerService.writeFile(userId, `${path}/server.js`, server);
    await containerService.execInContainer(userId, `cd "${path}" && npm install`);
  }

  private async scaffoldPython(userId: string, path: string) {
    const reqs = `flask\ngunicorn`;
    const app = `from flask import Flask\n\napp = Flask(__name__)\n\n@app.route('/')\ndef hello():\n    return 'Hello from Python on Stone AIO!'\n\nif __name__ == '__main__':\n    app.run(host='0.0.0.0', port=3000)`;

    await containerService.writeFile(userId, `${path}/requirements.txt`, reqs);
    await containerService.writeFile(userId, `${path}/app.py`, app);
    await containerService.execInContainer(userId, `cd "${path}" && pip3 install -r requirements.txt`);
  }

  private async scaffoldReact(userId: string, path: string, name: string) {
    await containerService.execInContainer(userId, `cd /home/stone/sites && npm create vite@latest ${name} -- --template react`);
    await containerService.execInContainer(userId, `cd "${path}" && npm install`);
  }

  private async scaffoldNext(userId: string, path: string, name: string) {
    await containerService.execInContainer(userId, `cd /home/stone/sites && npx create-next-app@latest ${name} --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`);
  }

  async startSite(userId: string, siteId: string) {
    const db = getDb();
    const site = db.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?').get(siteId, userId) as any;
    if (!site) throw new Error('Site not found');

    const pm2Name = `stone-site-${siteId}`;

    // Start process if not static
    if (site.type !== 'static') {
      let cmd = '';
      switch (site.type) {
        case 'node':
          cmd = `PORT=${site.port} pm2 start server.js --name ${pm2Name}`;
          break;
        case 'python':
          cmd = `pm2 start "gunicorn -w 2 -b :${site.port} app:app" --name ${pm2Name}`;
          break;
        case 'react':
          cmd = `pm2 start "npm run dev -- --host 0.0.0.0 --port ${site.port}" --name ${pm2Name}`;
          break;
        case 'next':
          cmd = `pm2 start "npm run dev -- -p ${site.port}" --name ${pm2Name}`;
          break;
      }
      
      const { exitCode, stderr } = await containerService.execInContainer(userId, `cd "${site.path}" && ${cmd}`);
      if (exitCode !== 0) throw new Error(`Failed to start site: ${stderr}`);
      
      // Save pm2 state
      await containerService.execInContainer(userId, `pm2 save`);
    }

    // Add Caddy route
    await this.addCaddyRoute(userId, site);

    db.prepare('UPDATE sites SET status = ?, updated_at = unixepoch() WHERE id = ?').run('active', siteId);

    return { url: `https://${site.domain}`, port: site.port };
  }

  async stopSite(userId: string, siteId: string) {
    const db = getDb();
    const site = db.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?').get(siteId, userId) as any;
    if (!site) throw new Error('Site not found');

    if (site.type !== 'static') {
      await containerService.execInContainer(userId, `pm2 stop stone-site-${siteId}`);
      await containerService.execInContainer(userId, `pm2 save`);
    }

    await this.removeCaddyRoute(siteId);

    db.prepare('UPDATE sites SET status = ?, updated_at = unixepoch() WHERE id = ?').run('stopped', siteId);
  }

  async redeploySite(userId: string, siteId: string) {
    const db = getDb();
    const site = db.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?').get(siteId, userId) as any;
    if (!site) throw new Error('Site not found');

    if (site.type === 'react' || site.type === 'next') {
      await jobQueue.enqueue('site_build', { userId, siteId: site.name });
      return { success: true, message: 'Build enqueued' };
    }

    if (site.type !== 'static') {
      const { exitCode, stderr } = await containerService.execInContainer(userId, `pm2 restart stone-site-${siteId}`);
      if (exitCode !== 0) throw new Error(`Failed to restart site: ${stderr}`);
    }
    
    return { success: true };
  }

  async getSiteLogs(userId: string, siteId: string, tail: number = 100) {
    const db = getDb();
    const site = db.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?').get(siteId, userId) as any;
    if (!site) throw new Error('Site not found');

    if (site.type === 'static') {
      return "Static sites do not have process logs. They are served directly by Caddy.";
    }

    const { stdout } = await containerService.execInContainer(userId, `pm2 logs stone-site-${siteId} --lines ${tail} --nostream`);
    return stdout;
  }

  async streamSiteLogs(userId: string, siteId: string, onData: (data: string) => void, onEnd: () => void) {
    const db = getDb();
    const site = db.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?').get(siteId, userId) as any;
    if (!site) throw new Error('Site not found');

    if (site.type === 'static') {
      onData("Static sites do not have process logs.\n");
      onEnd();
      return () => {};
    }

    const stop = await containerService.streamExec(
      userId,
      `pm2 logs stone-site-${siteId} --raw`,
      (data) => onData(data.toString()),
      () => onEnd(),
      (err) => {
        logger.error(`Stream error for site ${siteId}`, err);
        onEnd();
      }
    );

    return stop;
  }

  async deleteSite(userId: string, siteId: string) {
    const db = getDb();
    const site = db.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?').get(siteId, userId) as any;
    if (!site) throw new Error('Site not found');

    if (site.status === 'active') {
      try { await this.stopSite(userId, siteId); } catch (e) { /* ignore */ }
    }

    if (site.type !== 'static') {
      await containerService.execInContainer(userId, `pm2 delete stone-site-${siteId}`);
      await containerService.execInContainer(userId, `pm2 save`);
    }

    await containerService.execInContainer(userId, `rm -rf "${site.path}"`);
    db.prepare('DELETE FROM sites WHERE id = ?').run(siteId);
  }

  async setCustomDomain(userId: string, siteId: string, domain: string) {
    const db = getDb();
    const site = db.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?').get(siteId, userId) as any;
    if (!site) throw new Error('Site not found');

    // Check if domain is taken
    const existing = db.prepare('SELECT id FROM sites WHERE domain = ? AND id != ?').get(domain, siteId);
    if (existing) throw new Error('Domain already in use');

    if (site.status === 'active') {
      await this.removeCaddyRoute(siteId);
      site.domain = domain;
      await this.addCaddyRoute(userId, site);
    }

    db.prepare('UPDATE sites SET domain = ?, updated_at = unixepoch() WHERE id = ?').run(domain, siteId);
  }

  async listSites(userId: string) {
    const db = getDb();
    return db.prepare('SELECT * FROM sites WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  }

  async getSiteStatus(userId: string, siteId: string) {
    const db = getDb();
    const site = db.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?').get(siteId, userId) as any;
    if (!site) throw new Error('Site not found');

    if (site.type === 'static') {
      return { status: site.status };
    }

    const { stdout } = await containerService.execInContainer(userId, `pm2 jlist`);
    try {
      const pm2List = JSON.parse(stdout);
      const process = pm2List.find((p: any) => p.name === `stone-site-${siteId}`);
      
      const actualStatus = process ? (process.pm2_env.status === 'online' ? 'active' : 'stopped') : 'stopped';
      
      if (actualStatus !== site.status) {
        db.prepare('UPDATE sites SET status = ? WHERE id = ?').run(actualStatus, siteId);
        site.status = actualStatus;
      }
      
      return { status: site.status, pm2: process };
    } catch (e) {
      return { status: site.status };
    }
  }

  private async addCaddyRoute(userId: string, site: any) {
    let handle: any[];
    
    if (site.type === 'static') {
      handle = [
        {
          handler: "vars",
          root: `/var/lib/docker/volumes/stone_vol_${userId}/_data/sites/${site.name}`
        },
        {
          handler: "file_server"
        }
      ];
    } else {
      handle = [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: `stone_${userId}:${site.port}` }]
        }
      ];
    }

    const route = {
      "@id": `stone-site-${site.id}`,
      match: [{ host: [site.domain] }],
      handle
    };

    try {
      await axios.post(`${CADDY_ADMIN_URL}/config/apps/http/servers/srv0/routes`, route);
    } catch (err: any) {
      if (err.response?.status === 404) {
        try {
          await axios.post(`${CADDY_ADMIN_URL}/config/apps/http/servers/https/routes`, route);
        } catch (err2: any) {
          logger.error(`Failed to add Caddy route for site ${site.id}`, err2.response?.data || err2.message);
          throw new Error('Failed to configure routing');
        }
      } else {
        logger.error(`Failed to add Caddy route for site ${site.id}`, err.response?.data || err.message);
        throw new Error('Failed to configure routing');
      }
    }
  }

  private async removeCaddyRoute(siteId: string) {
    try {
      await axios.delete(`${CADDY_ADMIN_URL}/id/stone-site-${siteId}`);
    } catch (err: any) {
      // Ignore 404s (route doesn't exist)
      if (err.response?.status !== 404 && err.response?.status !== 400) {
        logger.error(`Failed to remove Caddy route for site ${siteId}`, err.response?.data || err.message);
      }
    }
  }
}

export const siteService = new SiteService();
