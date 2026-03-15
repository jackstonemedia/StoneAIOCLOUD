/**
 * Stone AIO Command Palette (⌘K)
 */

import { store } from '../store.js';
import { router } from '../router.js';

export class CommandPalette {
  constructor() {
    this.container = null;
    this.input = null;
    this.resultsList = null;
    this.query = '';
    this.highlightedIdx = 0;
    this.items = [];
    this.recentSearches = this._loadRecent();
    this.fileResults = [];
    this.debounceTimer = null;

    this.init();
  }

  init() {
    store.subscribe('cmdPaletteOpen', (open) => {
      if (open) {
        this.render();
        this.input.focus();
        this._updateResults();
      } else {
        this.query = '';
        this.highlightedIdx = 0;
      }
    });
  }

  mount(container) {
    this.container = container;
  }

  render() {
    this.container.innerHTML = `
      <div class="cp-modal" id="cp-modal">
        <div class="cp-input-row">
          <div class="cp-search-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <input type="text" class="cp-input" id="cp-input" placeholder="Search for files, agents, or ask anything..." autocomplete="off">
        </div>
        <div class="cp-results" id="cp-results"></div>
        <div class="cp-footer">
          <div class="cp-footer-item"><span class="cp-footer-key">↑↓</span> navigate</div>
          <div class="cp-footer-item"><span class="cp-footer-key">↵</span> open</div>
          <div class="cp-footer-item"><span class="cp-footer-key">esc</span> close</div>
          <div class="cp-footer-item"><span class="cp-footer-key">tab</span> section</div>
        </div>
      </div>
    `;

    this.input = document.getElementById('cp-input');
    this.resultsList = document.getElementById('cp-results');

    this.input.addEventListener('input', (e) => {
      this.query = e.target.value;
      this.highlightedIdx = 0;
      this._updateResults();
      this._debounceFileSearch();
    });

    this.input.addEventListener('keydown', (e) => this._handleKeyDown(e));
    
    // Prevent overlay click from closing if clicking modal
    document.getElementById('cp-modal').addEventListener('click', (e) => e.stopPropagation());
  }

  _updateResults() {
    this.items = this._getFilteredItems();
    this._renderItems();
  }

  _getFilteredItems() {
    const query = this.query.toLowerCase().trim();
    let results = [];

    // 1. PREFIX COMMANDS
    if (query.startsWith('>')) {
      results.push({
        type: 'terminal',
        label: `Run: ${query.slice(1)}`,
        sub: 'Execute in terminal',
        icon: '⌨️',
        action: () => this._runInTerminal(query.slice(1))
      });
    }

    if (query.startsWith('ws ')) {
      results.push({
        type: 'web',
        label: `Search web for: ${query.slice(3)}`,
        sub: 'Ask Stone AI to browse',
        icon: '🌐',
        action: () => this._askStone(`Search the web for ${query.slice(3)}`)
      });
    }

    // 2. NAVIGATION & ACTIONS (if query matches or empty)
    const navActions = [
      { type: 'nav', label: 'Chat', sub: 'Messages & AI', icon: '💬', path: '/chat', meta: '⌘1' },
      { type: 'nav', label: 'Files', sub: 'Cloud Storage', icon: '📁', path: '/files', meta: '⌘2' },
      { type: 'nav', label: 'Sites', sub: 'Web Hosting', icon: '🌐', path: '/sites', meta: '⌘3' },
      { type: 'nav', label: 'Agents', sub: 'AI Workflows', icon: '🤖', path: '/agents', meta: '⌘4' },
      { type: 'nav', label: 'Terminal', sub: 'Cloud Shell', icon: '🐚', path: '/terminal', meta: '⌘5' },
      { type: 'nav', label: 'Integrations', sub: 'Connect Apps', icon: '🔌', path: '/integrations', meta: '⌘6' },
      { type: 'action', label: 'New Conversation', sub: 'Start fresh chat', icon: '➕', action: () => this._newConversation(), meta: 'N' },
      { type: 'action', label: 'New Agent', sub: 'Create AI worker', icon: '🤖', action: () => router.navigate('/agents/new') },
      { type: 'action', label: 'Restart Stone Computer', sub: 'Reboot container', icon: '🔄', action: () => this._restartContainer() },
      { type: 'action', label: 'Settings', sub: 'Preferences', icon: '⚙️', path: '/settings', meta: 'S' }
    ];

    const filteredNav = navActions.filter(item => 
      !query || item.label.toLowerCase().includes(query) || item.sub.toLowerCase().includes(query)
    );

    if (filteredNav.length > 0) {
      results.push({ type: 'header', label: query ? 'Matching' : 'Navigation' });
      results.push(...filteredNav);
    }

    // 3. RECENT CONVERSATIONS
    const conversations = store.get('conversations') || [];
    const filteredConvs = conversations
      .filter(c => !query || c.title.toLowerCase().includes(query))
      .slice(0, 5)
      .map(c => ({
        type: 'conv',
        label: c.title,
        sub: `Last active ${this._formatDate(c.updated_at)}`,
        icon: '💬',
        path: `/chat/${c.id}`
      }));

    if (filteredConvs.length > 0) {
      results.push({ type: 'header', label: 'Recent Conversations' });
      results.push(...filteredConvs);
    }

    // 4. FILE RESULTS (from debounce)
    if (this.fileResults.length > 0) {
      results.push({ type: 'header', label: 'Files' });
      results.push(...this.fileResults.map(f => ({
        type: 'file',
        label: f.name,
        sub: f.path,
        icon: this._getFileIcon(f.type),
        path: `/files/${encodeURIComponent(f.path)}`
      })));
    }

    // 5. RECENT SEARCHES (if empty query)
    if (!query && this.recentSearches.length > 0) {
      results.push({ type: 'header', label: 'Recent Searches' });
      results.push(...this.recentSearches.map(s => ({
        type: 'recent',
        label: s,
        icon: '🕒',
        action: () => { this.query = s; this.input.value = s; this._updateResults(); },
        isRecent: true
      })));
    }

    // 6. ALWAYS AVAILABLE: ASK STONE
    if (query && !query.startsWith('>') && !query.startsWith('ws ')) {
      results.push({ type: 'header', label: 'AI' });
      results.push({
        type: 'ai',
        label: `Ask Stone: ${query}`,
        sub: 'Send to AI assistant',
        icon: '✨',
        action: () => this._askStone(query)
      });
    }

    return results;
  }

  _renderItems() {
    if (this.items.length === 0) {
      this.resultsList.innerHTML = `<div class="cp-section-header">No results found for "${this.query}"</div>`;
      return;
    }

    let html = '';
    let selectableIdx = 0;

    this.items.forEach((item, idx) => {
      if (item.type === 'header') {
        html += `<div class="cp-section-header">${item.label}</div>`;
      } else {
        const isHighlighted = selectableIdx === this.highlightedIdx;
        item.selectableIdx = selectableIdx;
        
        html += `
          <div class="cp-item ${isHighlighted ? 'highlighted' : ''}" data-idx="${selectableIdx}">
            <div class="cp-item-icon">${item.icon}</div>
            <div class="cp-item-content">
              <div class="cp-item-label">${this._highlightText(item.label, this.query)}</div>
              ${item.sub ? `<div class="cp-item-sub">${item.sub}</div>` : ''}
            </div>
            ${item.meta ? `<div class="cp-item-meta">${item.meta}</div>` : ''}
            ${item.isRecent ? `<div class="cp-remove-recent" data-recent="${item.label}">✕</div>` : ''}
          </div>
        `;
        selectableIdx++;
      }
    });

    this.resultsList.innerHTML = html;

    // Add click listeners
    this.resultsList.querySelectorAll('.cp-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const idx = parseInt(el.getAttribute('data-idx'));
        this._executeItem(idx);
      });
    });

    this.resultsList.querySelectorAll('.cp-remove-recent').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeRecent(el.getAttribute('data-recent'));
      });
    });

    // Scroll into view
    const highlighted = this.resultsList.querySelector('.cp-item.highlighted');
    if (highlighted) {
      highlighted.scrollIntoView({ block: 'nearest' });
    }
  }

  _handleKeyDown(e) {
    const selectableItems = this.items.filter(i => i.type !== 'header');
    const maxIdx = selectableItems.length - 1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.highlightedIdx = Math.min(this.highlightedIdx + 1, maxIdx);
      this._renderItems();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.highlightedIdx = Math.max(this.highlightedIdx - 0, 0); // Logic fix: Math.max(this.highlightedIdx - 1, 0)
      this.highlightedIdx = Math.max(this.highlightedIdx - 1, 0);
      this._renderItems();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this._executeItem(this.highlightedIdx);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this._jumpToNextSection();
    }
  }

  _executeItem(idx) {
    const selectableItems = this.items.filter(i => i.type !== 'header');
    const item = selectableItems[idx];
    if (!item) return;

    // Save to recent if it was a search
    if (this.query && !item.isRecent) {
      this._saveRecent(this.query);
    }

    store.set('cmdPaletteOpen', false);

    if (item.path) {
      router.navigate(item.path);
    } else if (item.action) {
      item.action();
    }
  }

  _jumpToNextSection() {
    // Find current section
    const selectableItems = this.items.filter(i => i.type !== 'header');
    const currentItem = selectableItems[this.highlightedIdx];
    if (!currentItem) return;

    // Find index of current item in full list
    const fullIdx = this.items.indexOf(currentItem);
    
    // Find next header
    for (let i = fullIdx + 1; i < this.items.length; i++) {
      if (this.items[i].type === 'header') {
        // Find first selectable item after this header
        for (let j = i + 1; j < this.items.length; j++) {
          if (this.items[j].type !== 'header') {
            this.highlightedIdx = this.items[j].selectableIdx;
            this._renderItems();
            return;
          }
        }
      }
    }
    // Loop back to start
    this.highlightedIdx = 0;
    this._renderItems();
  }

  _debounceFileSearch() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (!this.query || this.query.length < 2) {
      this.fileResults = [];
      this._updateResults();
      return;
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        const token = store.get('token');
        const res = await fetch(`/api/v1/files/search?q=${encodeURIComponent(this.query)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        this.fileResults = data.files || [];
        this._updateResults();
      } catch (e) {
        console.error('File search failed');
      }
    }, 300);
  }

  _highlightText(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark class="cp-highlight">$1</mark>');
  }

  _saveRecent(query) {
    this.recentSearches = [query, ...this.recentSearches.filter(s => s !== query)].slice(0, 10);
    localStorage.setItem('stone_recent_searches', JSON.stringify(this.recentSearches));
  }

  _loadRecent() {
    const stored = localStorage.getItem('stone_recent_searches');
    return stored ? JSON.parse(stored) : [];
  }

  _removeRecent(query) {
    this.recentSearches = this.recentSearches.filter(s => s !== query);
    localStorage.setItem('stone_recent_searches', JSON.stringify(this.recentSearches));
    this._updateResults();
  }

  _formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  }

  _getFileIcon(type) {
    const icons = {
      'folder': '📁',
      'image': '🖼️',
      'video': '🎥',
      'audio': '🎵',
      'pdf': '📄',
      'code': '💻'
    };
    return icons[type] || '📄';
  }

  // Actions
  _newConversation() {
    store.set('activeConversationId', null);
    router.navigate('/chat');
  }

  _restartContainer() {
    const token = store.get('token');
    fetch('/api/v1/container/restart', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(() => {
      store.set('containerStatus', 'restarting');
    });
  }

  _runInTerminal(cmd) {
    router.navigate('/terminal');
    // In a real app, we would emit an event that the terminal component listens to
    window.dispatchEvent(new CustomEvent('terminal:inject', { detail: cmd }));
  }

  _askStone(query) {
    router.navigate('/chat');
    window.dispatchEvent(new CustomEvent('chat:ask', { detail: query }));
  }
}
