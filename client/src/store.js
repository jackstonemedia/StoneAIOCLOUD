/**
 * Stone AIO State Management
 * Simple reactive store with persistence
 */

class Store {
  constructor() {
    this.state = {
      // Auth
      user: null,
      token: null,
      refreshToken: null,
      
      // UI
      activePanel: 'chat',
      sidebarOpen: false,
      notifPanelOpen: false,
      cmdPaletteOpen: false,
      
      // Chat
      conversations: [],
      activeConversationId: null,
      messages: new Map(),       // convId → message[]
      isStreaming: false,
      activeModel: 'claude-sonnet-4-5',
      activeSkill: null,
      
      // Container
      containerStatus: 'unknown',
      containerStats: { cpu: 0, memoryMB: 0, diskGB: 0 },
      
      // Data
      sites: [],
      agents: [],
      notifications: [],
      unreadNotifCount: 0,
      integrations: [],
      memories: [],
      skills: [],
      models: [],
      
      // Onboarding
      onboardingStep: 0,
      onboardingComplete: false,
      
      // Usage
      usage: null,
    };

    this.subscribers = new Map();
    this.persistedKeys = new Set();
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    const oldValue = this.state[key];
    this.state[key] = value;
    
    if (oldValue !== value) {
      this._notify(key, value);
      if (this.persistedKeys.has(key)) {
        this._saveToLocal(key, value);
      }
    }
  }

  update(key, updaterFn) {
    const currentValue = this.get(key);
    const newValue = updaterFn(currentValue);
    this.set(key, newValue);
  }

  subscribe(key, fn) {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key).add(fn);
    
    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(key);
      if (subs) {
        subs.delete(fn);
      }
    };
  }

  subscribeMany(keys, fn) {
    const unsubscribes = keys.map(key => this.subscribe(key, () => fn(this.state)));
    return () => unsubscribes.forEach(unsub => unsub());
  }

  persist(...keys) {
    keys.forEach(key => this.persistedKeys.add(key));
  }

  hydrate() {
    this.persistedKeys.forEach(key => {
      const stored = localStorage.getItem(`stone_${key}`);
      if (stored !== null) {
        try {
          this.state[key] = JSON.parse(stored);
        } catch (e) {
          this.state[key] = stored;
        }
      }
    });
  }

  _notify(key, value) {
    const subs = this.subscribers.get(key);
    if (subs) {
      subs.forEach(fn => fn(value));
    }
  }

  _saveToLocal(key, value) {
    localStorage.setItem(`stone_${key}`, JSON.stringify(value));
  }
}

export const store = new Store();

// Configure persistence
store.persist('token', 'refreshToken', 'activeModel', 'sidebarOpen', 'onboardingComplete');

// Derived getters
export const getActiveConversation = () => {
  const conversations = store.get('conversations');
  const activeId = store.get('activeConversationId');
  return conversations.find(c => c.id === activeId);
};

export const getActiveMessages = () => {
  const messagesMap = store.get('messages');
  const activeId = store.get('activeConversationId');
  return messagesMap.get(activeId) || [];
};

export const isAuthenticated = () => !!store.get('token');
