/**
 * Stone AIO Hash Router
 * Lightweight SPA routing
 */

import { store, isAuthenticated } from './store.js';

class Router {
  constructor() {
    this.routes = [];
    this.guards = [];
    this.listeners = new Map();
    this.params = {};
    this.query = {};
    this.currentRoute = null;

    // Define routes
    this._addRoute('/login', 'login');
    this._addRoute('/register', 'register');
    this._addRoute('/onboarding', 'onboarding');
    this._addRoute('/chat', 'chat');
    this._addRoute('/chat/:conversationId', 'chat-detail');
    this._addRoute('/files', 'files');
    this._addRoute('/files/:path', 'files-detail');
    this._addRoute('/sites', 'sites');
    this._addRoute('/sites/:siteId', 'sites-detail');
    this._addRoute('/agents', 'agents');
    this._addRoute('/agents/:agentId', 'agents-detail');
    this._addRoute('/terminal', 'terminal');
    this._addRoute('/integrations', 'integrations');
    this._addRoute('/settings', 'settings');
    this._addRoute('/settings/:section', 'settings-detail');

    // Default auth guard
    this.addGuard((to) => {
      const protectedRoutes = [
        '/onboarding', '/chat', '/files', '/sites', 
        '/agents', '/terminal', '/integrations', '/settings'
      ];
      
      const isProtected = protectedRoutes.some(path => to.startsWith(path));
      
      if (isProtected && !isAuthenticated()) {
        this.navigate('/login');
        return false;
      }
      return true;
    });
  }

  _addRoute(path, name) {
    const keys = [];
    const pattern = path.replace(/:([^/]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    
    this.routes.push({
      path,
      name,
      regex: new RegExp(`^${pattern}$`),
      keys
    });
  }

  init() {
    window.addEventListener('hashchange', () => this._handleRoute());
    this._handleRoute();
  }

  navigate(path, options = {}) {
    const hash = path.startsWith('#') ? path : `#${path}`;
    if (options.replace) {
      const url = new URL(window.location);
      url.hash = hash;
      window.location.replace(url);
    } else {
      window.location.hash = hash;
    }
  }

  back() {
    window.history.back();
  }

  forward() {
    window.history.forward();
  }

  addGuard(guardFn) {
    this.guards.push(guardFn);
  }

  on(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(fn);
  }

  resolve(path) {
    const [urlPath, queryString] = path.split('?');
    const cleanPath = urlPath.startsWith('#') ? urlPath.slice(1) : urlPath;
    
    const query = {};
    if (queryString) {
      new URLSearchParams(queryString).forEach((val, key) => {
        query[key] = val;
      });
    }

    for (const route of this.routes) {
      const match = cleanPath.match(route.regex);
      if (match) {
        const params = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(match[i + 1]);
        });
        return { route, params, query };
      }
    }

    return null;
  }

  async _handleRoute() {
    const hash = window.location.hash || '#/chat';
    const resolved = this.resolve(hash);

    if (!resolved) {
      console.error('Route not found:', hash);
      this.navigate('/chat');
      return;
    }

    // Run guards
    for (const guard of this.guards) {
      const result = await guard(hash.slice(1), resolved);
      if (result === false) return;
    }

    this.currentRoute = resolved.route;
    this.params = resolved.params;
    this.query = resolved.query;

    this._emit('route:change', {
      route: this.currentRoute,
      params: this.params,
      query: this.query
    });
  }

  _emit(event, data) {
    const subs = this.listeners.get(event);
    if (subs) {
      subs.forEach(fn => fn(data));
    }
  }
}

export const router = new Router();
