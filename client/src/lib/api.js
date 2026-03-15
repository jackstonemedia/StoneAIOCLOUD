/**
 * Stone AIO API Client
 * Handles authentication, token refresh, and streaming
 */

import { store } from '../store.js';
import { router } from '../router.js';

class StoneAPI {
  constructor() {
    this.baseUrl = import.meta.env?.VITE_API_URL || '';
    this.isRefreshing = false;
    this.refreshSubscribers = [];
  }

  async request(method, path, options = {}) {
    const {
      body,
      params,
      headers = {},
      timeout = 30000,
      skipAuth = false
    } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`, window.location.origin);
    if (params) {
      Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
    }

    const requestHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    if (!skipAuth) {
      const token = store.get('token');
      if (token) {
        requestHeaders['Authorization'] = `Bearer ${token}`;
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized (Token expired)
      if (response.status === 401 && !skipAuth) {
        return this._handle401(method, path, options);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw {
          message: errorData.message || 'An unexpected error occurred',
          code: errorData.code || 'UNKNOWN_ERROR',
          statusCode: response.status
        };
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw { message: 'Request timed out', code: 'TIMEOUT', statusCode: 408 };
      }
      throw error;
    }
  }

  async _handle401(method, path, options) {
    if (this.isRefreshing) {
      return new Promise(resolve => {
        this.refreshSubscribers.push((token) => {
          resolve(this.request(method, path, options));
        });
      });
    }

    this.isRefreshing = true;
    const refreshToken = store.get('refreshToken');

    if (!refreshToken) {
      this._logout();
      throw { message: 'Session expired', code: 'UNAUTHORIZED', statusCode: 401 };
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      if (!res.ok) throw new Error('Refresh failed');

      const { token, refreshToken: newRefreshToken } = await res.json();
      store.set('token', token);
      store.set('refreshToken', newRefreshToken);

      this.isRefreshing = false;
      this._onTokenRefreshed(token);
      
      return this.request(method, path, options);
    } catch (err) {
      this.isRefreshing = false;
      this._logout();
      throw { message: 'Session expired', code: 'UNAUTHORIZED', statusCode: 401 };
    }
  }

  _onTokenRefreshed(token) {
    this.refreshSubscribers.forEach(callback => callback(token));
    this.refreshSubscribers = [];
  }

  _logout() {
    store.set('token', null);
    store.set('refreshToken', null);
    store.set('user', null);
    router.navigate('/login');
  }

  get(path, params, options) { return this.request('GET', path, { ...options, params }); }
  post(path, body, options) { return this.request('POST', path, { ...options, body }); }
  patch(path, body, options) { return this.request('PATCH', path, { ...options, body }); }
  del(path, params, options) { return this.request('DELETE', path, { ...options, params }); }

  async upload(path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `${this.baseUrl}${path}`;
      
      xhr.open('POST', url);
      
      const token = store.get('token');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress((e.loaded / e.total) * 100);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            resolve(xhr.responseText);
          }
        } else {
          reject({
            message: 'Upload failed',
            statusCode: xhr.status
          });
        }
      };

      xhr.onerror = () => reject({ message: 'Network error' });
      xhr.send(formData);
    });
  }

  async stream(path, body, onEvent) {
    const token = store.get('token');
    const controller = new AbortController();

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Stream failed: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processStream = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              try {
                const data = JSON.parse(line.slice(5).trim());
                onEvent(data);
              } catch (e) {
                console.warn('Failed to parse SSE data:', line);
              }
            }
          }
        }
      }
    };

    processStream().catch(err => {
      if (err.name !== 'AbortError') {
        console.error('Stream processing error:', err);
      }
    });

    return {
      stop: () => controller.abort()
    };
  }
}

export const api = new StoneAPI();

// Domain-specific API modules
export const authAPI = {
  login: (credentials) => api.post('/api/v1/auth/login', credentials, { skipAuth: true }),
  register: (data) => api.post('/api/v1/auth/register', data, { skipAuth: true }),
  logout: () => api.post('/api/v1/auth/logout'),
  me: () => api.get('/api/v1/auth/me'),
  updateMe: (data) => api.patch('/api/v1/auth/me', data),
  forgotPassword: (email) => api.post('/api/v1/auth/forgot-password', { email }, { skipAuth: true }),
  resetPassword: (data) => api.post('/api/v1/auth/reset-password', data, { skipAuth: true }),
  verifyPhone: (phone) => api.post('/api/v1/auth/verify-phone', { phone }),
  confirmPhone: (code) => api.post('/api/v1/auth/confirm-phone', { code })
};

export const chatAPI = {
  sendMessage: (data) => api.post('/api/v1/chat/messages', data),
  getConversations: () => api.get('/api/v1/chat/conversations'),
  getConversation: (id) => api.get(`/api/v1/chat/conversations/${id}`),
  deleteConversation: (id) => api.del(`/api/v1/chat/conversations/${id}`),
  renameConversation: (id, title) => api.patch(`/api/v1/chat/conversations/${id}`, { title }),
  clearConversation: (id) => api.post(`/api/v1/chat/conversations/${id}/clear`),
  getModels: () => api.get('/api/v1/models'),
  searchMessages: (q) => api.get('/api/v1/chat/search', { q })
};

export const filesAPI = {
  list: (path = '/') => api.get('/api/v1/files/list', { path }),
  read: (path) => api.get('/api/v1/files/read', { path }),
  write: (path, content) => api.post('/api/v1/files/write', { path, content }),
  upload: (path, file, onProgress) => {
    const formData = new FormData();
    formData.append('path', path);
    formData.append('file', file);
    return api.upload('/api/v1/files/upload', formData, onProgress);
  },
  download: (path) => `${api.baseUrl}/api/v1/files/download?path=${encodeURIComponent(path)}&token=${store.get('token')}`,
  search: (q) => api.get('/api/v1/files/search', { q }),
  mkdir: (path) => api.post('/api/v1/files/mkdir', { path }),
  delete: (path) => api.del('/api/v1/files/delete', { path }),
  move: (from, to) => api.post('/api/v1/files/move', { from, to }),
  info: (path) => api.get('/api/v1/files/info', { path }),
  zip: (path, dest) => api.post('/api/v1/files/zip', { path, dest }),
  unzip: (path, dest) => api.post('/api/v1/files/unzip', { path, dest })
};

export const sitesAPI = {
  list: () => api.get('/api/v1/sites'),
  get: (id) => api.get(`/api/v1/sites/${id}`),
  create: (data) => api.post('/api/v1/sites', data),
  start: (id) => api.post(`/api/v1/sites/${id}/start`),
  stop: (id) => api.post(`/api/v1/sites/${id}/stop`),
  delete: (id) => api.del(`/api/v1/sites/${id}`),
  getLogs: (id) => api.get(`/api/v1/sites/${id}/logs`),
  redeploy: (id) => api.post(`/api/v1/sites/${id}/redeploy`),
  update: (id, data) => api.patch(`/api/v1/sites/${id}`, data)
};

export const agentsAPI = {
  list: () => api.get('/api/v1/agents'),
  get: (id) => api.get(`/api/v1/agents/${id}`),
  create: (data) => api.post('/api/v1/agents', data),
  update: (id, data) => api.patch(`/api/v1/agents/${id}`, data),
  delete: (id) => api.del(`/api/v1/agents/${id}`),
  run: (id, input) => api.post(`/api/v1/agents/${id}/run`, { input }),
  enable: (id) => api.post(`/api/v1/agents/${id}/enable`),
  disable: (id) => api.post(`/api/v1/agents/${id}/disable`),
  getRuns: (id) => api.get(`/api/v1/agents/${id}/runs`),
  getRun: (id, runId) => api.get(`/api/v1/agents/${id}/runs/${runId}`)
};

export const containerAPI = {
  getStatus: () => api.get('/api/v1/container/status'),
  getStats: () => api.get('/api/v1/container/stats'),
  start: () => api.post('/api/v1/container/start'),
  stop: () => api.post('/api/v1/container/stop'),
  restart: () => api.post('/api/v1/container/restart'),
  getLogs: () => api.get('/api/v1/container/logs')
};

export const integrationsAPI = {
  list: () => api.get('/api/v1/integrations'),
  getConnectUrl: (id) => api.get(`/api/v1/integrations/${id}/connect`),
  disconnect: (id) => api.post(`/api/v1/integrations/${id}/disconnect`),
  test: (id) => api.post(`/api/v1/integrations/${id}/test`)
};

export const notificationsAPI = {
  list: () => api.get('/api/v1/notifications'),
  markRead: (id) => api.post(`/api/v1/notifications/${id}/read`),
  markAllRead: () => api.post('/api/v1/notifications/read-all'),
  clear: (id) => api.del(`/api/v1/notifications/${id}`),
  stream: (onEvent) => api.stream('/api/v1/notifications/stream', {}, onEvent)
};

export const usageAPI = {
  getCurrent: () => api.get('/api/v1/usage/current'),
  getHistory: (days) => api.get('/api/v1/usage/history', { days })
};
