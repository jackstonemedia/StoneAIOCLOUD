/**
 * Stone AIO AppShell
 * Persistent chrome and panel management
 */

import { store } from '../store.js';
import { router } from '../router.js';
import { CommandPalette } from './CommandPalette.js';

export class AppShell {
  constructor() {
    this.panels = new Map();
    this.activePanelName = null;
    this.isSidebarExpanded = store.get('sidebarOpen') || false;
    this.isNotifOpen = false;
    this.commandPalette = new CommandPalette();
    
    this.init();
  }

  init() {
    this.render();
    this.setupEventListeners();
    this.setupKeyboardShortcuts();
    this.syncWithStore();
    
    // Mount Command Palette
    this.commandPalette.mount(document.getElementById('command-palette-overlay'));
    
    // Initial route sync
    this.handleRouteChange(router.currentRoute);
  }

  render() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar ${this.isSidebarExpanded ? 'expanded' : ''}" id="sidebar">
          <div class="sidebar-top">
            <div class="logo-container">
              <svg viewBox="0 0 24 24" width="24" height="24">
                <rect x="7" y="7" width="10" height="10" rx="1.5" transform="rotate(45 12 12)" fill="none" stroke="currentColor" stroke-width="2"/>
              </svg>
            </div>
            <span class="wordmark">STONE AIO</span>
          </div>

          <nav class="nav-items">
            <a href="#/chat" class="nav-item" data-panel="chat" data-tooltip="Chat">
              <div class="nav-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </div>
              <span class="nav-item-label">Chat</span>
            </a>
            <a href="#/files" class="nav-item" data-panel="files" data-tooltip="Files">
              <div class="nav-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </div>
              <span class="nav-item-label">Files</span>
            </a>
            <a href="#/sites" class="nav-item" data-panel="sites" data-tooltip="Sites">
              <div class="nav-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              </div>
              <span class="nav-item-label">Sites</span>
            </a>
            <a href="#/agents" class="nav-item" data-panel="agents" data-tooltip="Agents">
              <div class="nav-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16v2M16 16v2"/></svg>
              </div>
              <span class="nav-item-label">Agents</span>
            </a>
            <a href="#/terminal" class="nav-item" data-panel="terminal" data-tooltip="Terminal">
              <div class="nav-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              </div>
              <span class="nav-item-label">Terminal</span>
            </a>
            <a href="#/integrations" class="nav-item" data-panel="integrations" data-tooltip="Integrations">
              <div class="nav-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              </div>
              <span class="nav-item-label">Integrations</span>
            </a>
            <div class="nav-spacer"></div>
            <a href="#/settings" class="nav-item" data-panel="settings" data-tooltip="Settings">
              <div class="nav-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </div>
              <span class="nav-item-label">Settings</span>
            </a>
          </nav>

          <div class="sidebar-bottom">
            <div class="status-bars" id="sidebar-stats">
              <div class="status-bar-item">
                <div class="status-bar-label">CPU</div>
                <div class="status-bar-track"><div class="status-bar-fill" id="cpu-fill" style="width: 23%"></div></div>
              </div>
              <div class="status-bar-item">
                <div class="status-bar-label">RAM</div>
                <div class="status-bar-track"><div class="status-bar-fill" id="ram-fill" style="width: 45%"></div></div>
              </div>
              <div class="status-bar-item">
                <div class="status-bar-label">Disk</div>
                <div class="status-bar-track"><div class="status-bar-fill" id="disk-fill" style="width: 12%"></div></div>
              </div>
            </div>

            <div class="sidebar-toggle" id="sidebar-toggle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="toggle-icon"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
            </div>

            <div class="user-row">
              <div class="user-avatar" id="user-avatar"></div>
              <div class="user-info">
                <span class="user-name" id="user-name">User</span>
                <span class="plan-badge" id="user-plan">PRO</span>
              </div>
            </div>
          </div>
        </aside>

        <main class="main-container">
          <header class="topbar">
            <div class="breadcrumb" id="breadcrumb">
              <span class="breadcrumb-item">Stone AIO</span>
              <span class="breadcrumb-sep">›</span>
              <span class="breadcrumb-item active" id="breadcrumb-active">Dashboard</span>
            </div>

            <div class="topbar-right">
              <div class="container-chip">
                <div class="status-ring running" id="status-ring"></div>
                <span>Running</span>
                <span class="sep">·</span>
                <span id="cpu-text">23% CPU</span>
              </div>

              <button class="kbd-btn" id="search-btn">
                <span>Search</span>
                <span class="kbd">⌘K</span>
              </button>

              <div class="icon-btn" id="notif-btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                <div class="badge-dot" id="notif-badge" style="display: none;"></div>
              </div>
            </div>
          </header>

          <div class="panels-container" id="panels-container">
            <!-- Panels will be mounted here -->
          </div>
        </main>

        <aside class="notif-panel" id="notif-panel">
          <div class="notif-header">
            <span class="notif-title">Updates</span>
            <button class="btn btn-ghost btn-sm" id="mark-read-btn">Mark all read</button>
          </div>
          <div class="notif-content" id="notif-list">
            <div class="notif-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span>All caught up.</span>
            </div>
          </div>
        </aside>

        <div class="overlay" id="command-palette-overlay">
          <!-- Command Palette will be mounted here -->
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const toggleIcon = document.getElementById('toggle-icon');
    const notifBtn = document.getElementById('notif-btn');
    const notifPanel = document.getElementById('notif-panel');
    const searchBtn = document.getElementById('search-btn');
    const overlay = document.getElementById('command-palette-overlay');

    toggle.addEventListener('click', () => {
      this.isSidebarExpanded = !this.isSidebarExpanded;
      sidebar.classList.toggle('expanded', this.isSidebarExpanded);
      store.set('sidebarOpen', this.isSidebarExpanded);
      
      // Rotate icon
      toggleIcon.style.transform = this.isSidebarExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
    });

    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isNotifOpen = !this.isNotifOpen;
      notifPanel.classList.toggle('open', this.isNotifOpen);
    });

    document.addEventListener('click', (e) => {
      if (this.isNotifOpen && !notifPanel.contains(e.target) && !notifBtn.contains(e.target)) {
        this.isNotifOpen = false;
        notifPanel.classList.remove('open');
      }
    });

    searchBtn.addEventListener('click', () => {
      store.set('cmdPaletteOpen', true);
    });

    router.on('route:change', (data) => this.handleRouteChange(data));
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmd = isMac ? e.metaKey : e.ctrlKey;

      // ⌘K -> Command Palette
      if (cmd && e.key === 'k') {
        e.preventDefault();
        store.set('cmdPaletteOpen', !store.get('cmdPaletteOpen'));
      }

      // ⌘1-6 -> Switch Panels
      if (cmd && e.key >= '1' && e.key <= '6') {
        e.preventDefault();
        const routes = ['/chat', '/files', '/sites', '/agents', '/terminal', '/integrations'];
        router.navigate(routes[parseInt(e.key) - 1]);
      }

      // Escape -> Close overlays
      if (e.key === 'Escape') {
        store.set('cmdPaletteOpen', false);
        if (this.isNotifOpen) {
          this.isNotifOpen = false;
          document.getElementById('notif-panel').classList.remove('open');
        }
      }

      // ⌘, -> Settings
      if (cmd && e.key === ',') {
        e.preventDefault();
        router.navigate('/settings');
      }
    });
  }

  syncWithStore() {
    store.subscribe('cmdPaletteOpen', (open) => {
      const overlay = document.getElementById('command-palette-overlay');
      overlay.classList.toggle('open', open);
    });

    store.subscribe('user', (user) => {
      if (user) {
        document.getElementById('user-name').textContent = user.name || user.email;
        document.getElementById('user-plan').textContent = user.plan?.toUpperCase() || 'FREE';
      }
    });

    store.subscribe('containerStats', (stats) => {
      if (stats) {
        document.getElementById('cpu-fill').style.width = `${stats.cpu}%`;
        document.getElementById('ram-fill').style.width = `${(stats.memoryMB / 1024) * 100}%`;
        document.getElementById('cpu-text').textContent = `${stats.cpu}% CPU`;
      }
    });

    store.subscribe('unreadNotifCount', (count) => {
      const badge = document.getElementById('notif-badge');
      badge.style.display = count > 0 ? 'block' : 'none';
    });
  }

  handleRouteChange(data) {
    if (!data) return;
    const { route, params } = data;
    
    // Update active nav item
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      const panelName = item.getAttribute('data-panel');
      if (route.name.startsWith(panelName)) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update breadcrumb
    const activeBreadcrumb = document.getElementById('breadcrumb-active');
    activeBreadcrumb.textContent = this.capitalize(route.name.split('-')[0]);

    // Switch panels
    this.switchPanel(route.name.split('-')[0]);
  }

  registerPanel(name, instance) {
    this.panels.set(name, instance);
    const container = document.getElementById('panels-container');
    const panelEl = document.createElement('div');
    panelEl.className = `panel panel-${name}`;
    panelEl.id = `panel-${name}`;
    container.appendChild(panelEl);
    
    instance.mount(panelEl);
  }

  switchPanel(name) {
    if (this.activePanelName === name) return;

    const panels = document.querySelectorAll('.panel');
    panels.forEach(p => p.classList.remove('active'));

    const target = document.getElementById(`panel-${name}`);
    if (target) {
      target.classList.add('active');
      this.activePanelName = name;
      store.set('activePanel', name);
    }
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
