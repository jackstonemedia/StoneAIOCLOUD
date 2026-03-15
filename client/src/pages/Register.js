/**
 * Stone AIO Register Page
 */

import { authAPI } from '../lib/api.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { toast } from '../lib/toast.js';

export class RegisterPage {
  constructor() {
    this.container = null;
    this.loadingMessages = [
      "Creating your account...",
      "Provisioning your Stone computer...",
      "Setting up your environment...",
      "Almost ready..."
    ];
    this.messageIdx = 0;
    this.messageInterval = null;
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
            <h2 class="auth-headline">Build on solid ground.</h2>
            <p class="auth-sub">Your personal AI computer in minutes.</p>

            <form class="auth-form" id="register-form">
              <div class="auth-field">
                <label class="auth-label">Full Name</label>
                <div class="auth-input-wrapper">
                  <input type="text" name="name" class="auth-input" placeholder="John Stone" required autocomplete="name">
                  <div class="auth-error-msg">Name is required.</div>
                </div>
              </div>

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
                  <div class="strength-meter" id="strength-meter">
                    <div class="strength-bars">
                      <div class="strength-bar"></div>
                      <div class="strength-bar"></div>
                      <div class="strength-bar"></div>
                      <div class="strength-bar"></div>
                    </div>
                    <div class="strength-label" id="strength-label">Weak</div>
                  </div>
                </div>
              </div>

              <div class="auth-field">
                <label class="auth-label">Confirm Password</label>
                <div class="auth-input-wrapper">
                  <input type="password" name="confirmPassword" id="confirm-password-input" class="auth-input" placeholder="••••••••" required>
                  <div class="auth-error-msg" id="mismatch-error">Passwords do not match.</div>
                </div>
              </div>

              <label class="auth-terms">
                <input type="checkbox" required>
                <span>I agree to the <a href="#/terms" class="auth-link">Terms of Service</a> and <a href="#/privacy" class="auth-link">Privacy Policy</a></span>
              </label>

              <button type="submit" class="btn btn-primary btn-lg auth-submit" id="submit-btn">
                Create my Stone computer →
              </button>
            </form>

            <div class="auth-footer">
              Already have an account? <a href="#/login" class="auth-link">Sign in</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const form = document.getElementById('register-form');
    const passInput = document.getElementById('password-input');
    const confirmInput = document.getElementById('confirm-password-input');
    const strengthMeter = document.getElementById('strength-meter');
    const strengthLabel = document.getElementById('strength-label');
    const submitBtn = document.getElementById('submit-btn');

    // Password strength meter
    passInput.addEventListener('input', (e) => {
      const val = e.target.value;
      let strength = 0;
      if (val.length > 0) strength = 1;
      if (val.length >= 8) strength = 2;
      if (val.length >= 8 && /[A-Z]/.test(val) && /[0-9]/.test(val)) strength = 3;
      if (val.length >= 8 && /[A-Z]/.test(val) && /[0-9]/.test(val) && /[^A-Za-z0-9]/.test(val)) strength = 4;

      strengthMeter.className = `strength-meter strength-${strength}`;
      const labels = ["Empty", "Weak", "Fair", "Good", "Strong"];
      strengthLabel.textContent = labels[strength];
    });

    // Confirm password mismatch
    confirmInput.addEventListener('blur', () => {
      if (confirmInput.value && confirmInput.value !== passInput.value) {
        confirmInput.classList.add('error');
      } else {
        confirmInput.classList.remove('error');
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (confirmInput.value !== passInput.value) {
        confirmInput.classList.add('error');
        toast.error('Passwords do not match.');
        return;
      }

      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      this.startLoading(submitBtn);

      try {
        const res = await authAPI.register(data);
        
        store.set('token', res.token);
        store.set('refreshToken', res.refreshToken);
        store.set('user', res.user);

        toast.success('Account created successfully.');
        router.navigate('/onboarding');
      } catch (error) {
        console.error('Registration failed:', error);
        toast.error(error.message || 'Failed to create account.');
        this.stopLoading(submitBtn);
      }
    });
  }

  startLoading(btn) {
    btn.disabled = true;
    btn.classList.add('loading');
    this.messageIdx = 0;
    
    const updateMsg = () => {
      btn.innerHTML = `<div class="auth-loading-msg">${this.loadingMessages[this.messageIdx]}</div>`;
      this.messageIdx = (this.messageIdx + 1) % this.loadingMessages.length;
    };

    updateMsg();
    this.messageInterval = setInterval(updateMsg, 1200);
  }

  stopLoading(btn) {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = 'Create my Stone computer →';
    if (this.messageInterval) clearInterval(this.messageInterval);
  }
}
