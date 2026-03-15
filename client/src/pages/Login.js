/**
 * Stone AIO Login Page
 */

import { authAPI } from '../lib/api.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { toast } from '../lib/toast.js';

export class LoginPage {
  constructor() {
    this.container = null;
    this.showPassword = false;
  }

  mount(container) {
    this.container = container;
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.container.innerHTML = `
      <div class="auth-page">
        <div class="auth-left">
          <div class="auth-logo-mark">
            <svg viewBox="0 0 24 24" width="80" height="80">
              <rect x="7" y="7" width="10" height="10" rx="1.5" transform="rotate(45 12 12)" fill="none" stroke="currentColor" stroke-width="2"/>
            </svg>
          </div>
          <h1 class="auth-wordmark">STONE AIO</h1>
          <p class="auth-tagline">Your AI infrastructure. All in one.</p>
          
          <ul class="auth-features">
            <li class="auth-feature-item"><span class="auth-feature-icon">✓</span> Your own Linux computer</li>
            <li class="auth-feature-item"><span class="auth-feature-icon">✓</span> AI that actually executes</li>
            <li class="auth-feature-item"><span class="auth-feature-icon">✓</span> Host apps on your subdomain</li>
            <li class="auth-feature-item"><span class="auth-feature-icon">✓</span> Agents that run while you sleep</li>
            <li class="auth-feature-item"><span class="auth-feature-icon">✓</span> Control via SMS and email</li>
          </ul>

          <div class="auth-trusted">
            <p class="auth-trusted-text">Trusted by builders, founders, and engineers</p>
            <div class="auth-avatars">
              <div class="auth-avatar">JS</div>
              <div class="auth-avatar">MK</div>
              <div class="auth-avatar">AL</div>
              <div class="auth-avatar">RB</div>
              <div class="auth-avatar">TC</div>
            </div>
          </div>
        </div>

        <div class="auth-right">
          <div class="auth-form-container">
            <h2 class="auth-headline">Welcome back.</h2>
            <p class="auth-sub">Your Stone computer is ready.</p>

            <form class="auth-form" id="login-form">
              <div class="auth-field">
                <label class="auth-label">Email</label>
                <div class="auth-input-wrapper">
                  <input type="email" name="email" class="auth-input" placeholder="name@company.com" required autocomplete="email">
                  <div class="auth-error-msg">Please enter a valid email address.</div>
                </div>
              </div>

              <div class="auth-field">
                <label class="auth-label">Password</label>
                <div class="auth-input-wrapper">
                  <input type="password" name="password" id="password-input" class="auth-input" placeholder="••••••••" required>
                  <button type="button" class="auth-toggle-pass" id="toggle-password">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  </button>
                  <div class="auth-error-msg">Password is required.</div>
                </div>
                <a href="#/forgot-password" class="auth-forgot">Forgot password?</a>
              </div>

              <button type="submit" class="btn btn-primary btn-lg auth-submit" id="submit-btn">
                Sign in →
              </button>
            </form>

            <div class="auth-footer">
              New to Stone AIO? <a href="#/register" class="auth-link">Create your computer</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const form = document.getElementById('login-form');
    const togglePass = document.getElementById('toggle-password');
    const passInput = document.getElementById('password-input');
    const submitBtn = document.getElementById('submit-btn');

    togglePass.addEventListener('click', () => {
      this.showPassword = !this.showPassword;
      passInput.type = this.showPassword ? 'text' : 'password';
      togglePass.innerHTML = this.showPassword ? `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
      ` : `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      `;
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const email = formData.get('email');
      const password = formData.get('password');

      // Reset errors
      form.querySelectorAll('.auth-input').forEach(i => i.classList.remove('error'));

      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      try {
        const data = await authAPI.login({ email, password });
        
        store.set('token', data.token);
        store.set('refreshToken', data.refreshToken);
        store.set('user', data.user);

        toast.success('Welcome back to Stone AIO.');
        router.navigate('/chat');
      } catch (error) {
        console.error('Login failed:', error);
        toast.error(error.message || 'Invalid email or password.');
        
        // Highlight fields
        form.querySelectorAll('.auth-input').forEach(i => i.classList.add('error'));
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in →';
      }
    });

    // Validation on blur
    form.querySelector('input[name="email"]').addEventListener('blur', (e) => {
      const val = e.target.value;
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      if (val && !isValid) {
        e.target.classList.add('error');
      } else {
        e.target.classList.remove('error');
      }
    });
  }
}
