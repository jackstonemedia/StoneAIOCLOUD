/**
 * Stone AIO Event Bus
 * Simple pub/sub for cross-component communication
 */

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} event 
   * @param {Function} handler 
   * @returns {Function} Unsubscribe function
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event 
   * @param {Function} handler 
   */
  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit an event
   * @param {string} event 
   * @param {any} data 
   */
  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in event handler for "${event}":`, err);
        }
      });
    }
  }

  /**
   * Subscribe to an event once
   * @param {string} event 
   * @param {Function} handler 
   */
  once(event, handler) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      handler(data);
    };
    this.on(event, wrapper);
  }
}

export const bus = new EventBus();

/**
 * STONE AIO EVENTS REFERENCE:
 * 'auth:login'
 * 'auth:logout'
 * 'chat:message:sent'
 * 'chat:message:received'
 * 'chat:streaming:start'
 * 'chat:streaming:end'
 * 'chat:tool:start'
 * 'chat:tool:result'
 * 'files:uploaded'
 * 'files:changed'
 * 'site:started'
 * 'site:stopped'
 * 'site:error'
 * 'agent:run:start'
 * 'agent:run:complete'
 * 'agent:run:failed'
 * 'container:status:changed'
 * 'container:stats:updated'
 * 'notification:received'
 * 'terminal:inject' — data: { command: string }
 * 'panel:switched'
 * 'browser:screenshot' — data: { base64, url }
 */
