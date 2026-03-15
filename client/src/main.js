/**
 * Stone AIO Frontend Entry Point
 */

import './index.css';
import { store } from './store.js';
import { router } from './router.js';
import { AppShell } from './components/AppShell.js';
import { LoginPage } from './pages/Login.js';
import { RegisterPage } from './pages/Register.js';
import { OnboardingPage } from './pages/Onboarding.js';

let appShell = null;
let currentPage = null;

async function initApp() {
  // 1. Hydrate store from localStorage
  store.hydrate();

  const token = store.get('token');

  // 2. Validate token if exists
  if (token) {
    try {
      const response = await fetch('/api/v1/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.status === 401) {
        store.set('token', null);
        store.set('user', null);
        router.navigate('/login');
      } else {
        const userData = await response.json();
        store.set('user', userData);
      }
    } catch (error) {
      console.error('Auth validation failed:', error);
    }
  }

  // 3. Initialize Router
  router.on('route:change', handleRouteChange);
  router.init();

  // 4. Initial Navigation Logic
  const onboardingComplete = store.get('onboardingComplete');
  const authenticated = !!store.get('token');

  if (authenticated) {
    if (!onboardingComplete) {
      router.navigate('/onboarding');
    } else {
      await loadInitialData();
      appShell = new AppShell();
      console.log('App Authenticated & Ready');
    }
  } else {
    // Router guard will handle redirect to login if needed
    if (window.location.hash === '' || window.location.hash === '#/') {
      router.navigate('/login');
    }
  }
}

function handleRouteChange(data) {
  const { route } = data;
  const authenticated = !!store.get('token');

  // If authenticated and AppShell not mounted, mount it
  if (authenticated && !appShell && store.get('onboardingComplete')) {
    document.getElementById('app').innerHTML = ''; // Clear for AppShell
    appShell = new AppShell();
    return;
  }

  // Handle unauthenticated pages or special pages (onboarding)
  if (!authenticated || !store.get('onboardingComplete')) {
    if (appShell) {
      // If we were in app and logged out, clear appShell
      appShell = null;
    }

    const appContainer = document.getElementById('app');
    
    if (route.name === 'login') {
      currentPage = new LoginPage();
      currentPage.mount(appContainer);
    } else if (route.name === 'register') {
      currentPage = new RegisterPage();
      currentPage.mount(appContainer);
    } else if (route.name === 'onboarding') {
      currentPage = new OnboardingPage();
      currentPage.mount(appContainer);
    }
  }
}

async function loadInitialData() {
  const token = store.get('token');
  const headers = { 'Authorization': `Bearer ${token}` };

  try {
    const [
      convs, sites, agents, integrations, models, usage
    ] = await Promise.all([
      fetch('/api/v1/chat/conversations', { headers }).then(r => r.json()),
      fetch('/api/v1/sites', { headers }).then(r => r.json()),
      fetch('/api/v1/agents', { headers }).then(r => r.json()),
      fetch('/api/v1/integrations', { headers }).then(r => r.json()),
      fetch('/api/v1/models', { headers }).then(r => r.json()),
      fetch('/api/v1/usage/current', { headers }).then(r => r.json())
    ]);

    store.set('conversations', convs.conversations || []);
    store.set('sites', sites.sites || []);
    store.set('agents', agents.agents || []);
    store.set('integrations', integrations.integrations || []);
    store.set('models', models.models || []);
    store.set('usage', usage || null);

    startSSE();
    startPolling();
  } catch (error) {
    console.error('Failed to load initial data:', error);
  }
}

function startSSE() {
  const token = store.get('token');
  const eventSource = new EventSource(`/api/v1/notifications/stream?token=${token}`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    store.update('notifications', prev => [data, ...prev]);
    store.update('unreadNotifCount', count => count + 1);
  };

  eventSource.onerror = () => {
    console.warn('SSE connection lost, retrying...');
  };
}

function startPolling() {
  const poll = async () => {
    const token = store.get('token');
    if (!token) return;

    try {
      const res = await fetch('/api/v1/container/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      store.set('containerStatus', data.status);
      store.set('containerStats', data.stats);
    } catch (e) {
      console.error('Container polling failed');
    }
  };

  poll();
  setInterval(poll, 30000);
}

// Start the app
initApp();
