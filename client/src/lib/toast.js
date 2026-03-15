/**
 * Stone AIO Toast System
 */

class ToastManager {
  constructor() {
    this.container = null;
    this.toasts = [];
    this.maxToasts = 5;
    this._ensureContainer();
  }

  _ensureContainer() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.id = 'stone-toasts';
    this.container.className = 'stone-toasts-container';
    document.body.appendChild(this.container);
  }

  show(message, type = 'info', options = {}) {
    const {
      duration = 4000,
      action = null,
      persistent = false
    } = options;

    const id = Math.random().toString(36).substr(2, 9);
    const toastEl = document.createElement('div');
    toastEl.className = `stone-toast stone-toast--${type}`;
    toastEl.id = `toast-${id}`;

    const icon = this._getIcon(type);
    
    toastEl.innerHTML = `
      <div class="stone-toast__icon">${icon}</div>
      <div class="stone-toast__msg">${message}</div>
      ${action ? `<button class="stone-toast__action">${action.label}</button>` : ''}
      <button class="stone-toast__close">×</button>
    `;

    // Action button
    if (action) {
      toastEl.querySelector('.stone-toast__action').addEventListener('click', () => {
        action.onClick();
        this.dismiss(id);
      });
    }

    // Close button
    toastEl.querySelector('.stone-toast__close').addEventListener('click', () => {
      this.dismiss(id);
    });

    // Auto-dismiss
    let timeoutId = null;
    if (!persistent) {
      const startTimer = () => {
        timeoutId = setTimeout(() => this.dismiss(id), duration);
      };
      const clearTimer = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };

      startTimer();
      toastEl.addEventListener('mouseenter', clearTimer);
      toastEl.addEventListener('mouseleave', startTimer);
    }

    // Add to DOM
    this.container.appendChild(toastEl);
    this.toasts.push({ id, el: toastEl, timeoutId });

    // Limit max toasts
    if (this.toasts.length > this.maxToasts) {
      const oldest = this.toasts[0];
      this.dismiss(oldest.id);
    }

    return id;
  }

  dismiss(id) {
    const index = this.toasts.findIndex(t => t.id === id);
    if (index === -1) return;

    const toast = this.toasts[index];
    toast.el.classList.add('stone-toast--exit');
    
    if (toast.timeoutId) clearTimeout(toast.timeoutId);

    toast.el.addEventListener('animationend', () => {
      if (toast.el.parentNode) {
        toast.el.parentNode.removeChild(toast.el);
      }
    });

    this.toasts.splice(index, 1);
  }

  success(msg, opts) { return this.show(msg, 'success', opts); }
  error(msg, opts) { return this.show(msg, 'error', opts); }
  info(msg, opts) { return this.show(msg, 'info', opts); }
  warn(msg, opts) { return this.show(msg, 'warn', opts); }

  _getIcon(type) {
    switch (type) {
      case 'success': return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      case 'error': return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
      case 'warn': return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
      default: return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }
  }
}

export const toast = new ToastManager();
