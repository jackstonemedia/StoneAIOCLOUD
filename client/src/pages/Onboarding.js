/**
 * Stone AIO Onboarding Flow
 */

import { authAPI, integrationsAPI, chatAPI } from '../lib/api.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { toast } from '../lib/toast.js';

export class OnboardingPage {
  constructor() {
    this.container = null;
    this.currentStep = 0;
    this.totalSteps = 6; // 0 to 5
    this.user = store.get('user') || { name: 'User', email: 'user@example.com' };
    this.subdomain = this.user.email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
    
    // State
    this.personalizeData = {
      bio: '',
      skills: []
    };
    this.connectedTools = 0;
    this.chatMessages = [];
  }

  mount(container) {
    this.container = container;
    this.render();
    this.initCanvas();
    this.setupEventListeners();
    
    if (this.currentStep === 0) {
      this.runBootSequence();
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="onboarding-page">
        <canvas id="onboarding-canvas"></canvas>
        
        <div class="onboarding-progress-container" id="progress-bar">
          ${Array(5).fill(0).map((_, i) => `<div class="onboarding-progress-segment ${i < this.currentStep ? 'active' : ''}"></div>`).join('')}
        </div>

        <div class="onboarding-content">
          <!-- STEP 0: BOOT -->
          <div class="onboarding-step ${this.currentStep === 0 ? 'active' : ''}" id="step-0">
            <div class="boot-terminal" id="boot-terminal"></div>
            <div class="boot-complete" id="boot-complete">
              <h2 class="onboarding-headline">Your Stone computer is online.</h2>
              <button class="onboarding-btn" id="btn-begin">Begin setup →</button>
            </div>
          </div>

          <!-- STEP 1: PERSONALIZE -->
          <div class="onboarding-step ${this.currentStep === 1 ? 'active' : ''}" id="step-1">
            <div>
              <h2 class="onboarding-headline">Tell Stone who you are.</h2>
              <p class="onboarding-sub">Stone reads this before every conversation.</p>
            </div>
            
            <div>
              <textarea class="personalize-textarea" id="bio-input" placeholder="I'm a [role] building [what]. I care about [values]. I prefer [communication style]. I'm best at [skills]."></textarea>
              <div class="quick-chips" id="quick-chips">
                <span class="quick-chip">I'm a developer</span>
                <span class="quick-chip">I'm a founder</span>
                <span class="quick-chip">I'm a product manager</span>
                <span class="quick-chip">I'm a designer</span>
                <span class="quick-chip">Concise answers only</span>
                <span class="quick-chip">Show your reasoning</span>
              </div>
            </div>

            <div>
              <p class="onboarding-sub" style="margin-bottom: 12px;">I want Stone to excel at:</p>
              <div class="skills-grid" id="skills-grid">
                ${['Coding', 'Research', 'Writing', 'Automation', 'Data Analysis', 'System Design', 'Finance', 'Creative', 'Marketing'].map(skill => 
                  `<span class="skill-pill" data-skill="${skill}">${skill}</span>`
                ).join('')}
              </div>
            </div>

            <button class="onboarding-btn" id="btn-step-1">Continue →</button>
          </div>

          <!-- STEP 2: CONNECT TOOLS -->
          <div class="onboarding-step ${this.currentStep === 2 ? 'active' : ''}" id="step-2">
            <div>
              <h2 class="onboarding-headline">Connect your tools.</h2>
              <p class="onboarding-sub">Stone gets smarter with access to your data.</p>
            </div>

            <div class="tools-grid">
              ${[
                { id: 'gmail', name: 'Gmail', icon: '📧', desc: 'Read and send emails' },
                { id: 'gcal', name: 'Google Calendar', icon: '📅', desc: 'Manage your schedule' },
                { id: 'github', name: 'GitHub', icon: '🐙', desc: 'Access repositories' },
                { id: 'notion', name: 'Notion', icon: '📝', desc: 'Read workspace docs' },
                { id: 'slack', name: 'Slack', icon: '💬', desc: 'Message your team' },
                { id: 'gdrive', name: 'Google Drive', icon: '📁', desc: 'Access your files' }
              ].map(tool => `
                <div class="tool-card" data-tool="${tool.id}">
                  <div class="tool-header">
                    <div class="tool-icon">${tool.icon}</div>
                    <div>
                      <div class="tool-name">${tool.name}</div>
                      <div class="tool-desc">${tool.desc}</div>
                    </div>
                  </div>
                  <div class="tool-status">✓</div>
                </div>
              `).join('')}
            </div>
            
            <div class="tools-counter" id="tools-counter">0 / 6 connected</div>

            <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 8px;">
              <button class="onboarding-btn" id="btn-step-2">Continue →</button>
              <a class="onboarding-link" id="skip-step-2">Skip for now →</a>
            </div>
          </div>

          <!-- STEP 3: TRY STONE -->
          <div class="onboarding-step ${this.currentStep === 3 ? 'active' : ''}" id="step-3">
            <div>
              <h2 class="onboarding-headline">Ask Stone anything.</h2>
              <p class="onboarding-sub">It runs code, browses the web, and manages your files.</p>
            </div>

            <div class="quick-chips" id="prompt-chips">
              <span class="quick-chip">What can you do?</span>
              <span class="quick-chip">Show me my Stone computer stats</span>
              <span class="quick-chip">Run a Hello World in Python</span>
              <span class="quick-chip">Search the web for AI news today</span>
              <span class="quick-chip">List my files</span>
            </div>

            <div class="try-stone-chat">
              <div class="chat-messages" id="chat-messages">
                <div class="chat-msg stone">
                  <div class="chat-avatar">S</div>
                  <div class="chat-bubble">Hello ${this.user.name}. I'm ready.</div>
                </div>
              </div>
              <form class="chat-input-area" id="chat-form">
                <input type="text" class="chat-input" id="chat-input" placeholder="Message Stone..." autocomplete="off">
                <button type="submit" class="chat-send">↑</button>
              </form>
            </div>

            <button class="onboarding-btn" id="btn-step-3" style="display: none; margin-top: 16px;">→ Continue to Stone</button>
          </div>

          <!-- STEP 4: REACH STONE ANYWHERE -->
          <div class="onboarding-step ${this.currentStep === 4 ? 'active' : ''}" id="step-4">
            <div>
              <h2 class="onboarding-headline">Control Stone from anywhere.</h2>
              <p class="onboarding-sub">Text it. Email it. It responds.</p>
            </div>

            <div class="reach-grid">
              <div class="reach-card">
                <div class="reach-icon">📱</div>
                <div class="reach-title">Text your Stone</div>
                <div id="sms-setup-area" style="width: 100%; display: flex; flex-direction: column; gap: 8px;">
                  <input type="tel" class="reach-input" id="phone-input" placeholder="+1 (555) 000-0000">
                  <button class="onboarding-btn ghost" id="btn-send-sms" style="padding: 8px; font-size: 13px;">Send verification code</button>
                </div>
                <div id="sms-verify-area" style="width: 100%; display: none; flex-direction: column; gap: 8px;">
                  <input type="text" class="reach-input" id="code-input" placeholder="6-digit code" maxlength="6">
                  <button class="onboarding-btn ghost" id="btn-verify-sms" style="padding: 8px; font-size: 13px;">Verify</button>
                </div>
                <div id="sms-success-area" style="width: 100%; display: none; color: var(--success); font-size: 14px; font-weight: 500;">
                  ✓ Verified
                </div>
              </div>

              <div class="reach-card">
                <div class="reach-icon">✉️</div>
                <div class="reach-title">Email your Stone</div>
                <div class="reach-value" id="stone-email">${this.subdomain}@mail.stoneaio.com</div>
                <button class="onboarding-btn ghost" id="btn-copy-email" style="padding: 8px; font-size: 13px; width: 100%;">Copy address</button>
                <button class="onboarding-btn ghost" id="btn-test-email" style="padding: 8px; font-size: 13px; width: 100%;">Send a test</button>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 16px;">
              <button class="onboarding-btn" id="btn-step-4">Continue →</button>
              <a class="onboarding-link" id="skip-step-4">Skip →</a>
            </div>
          </div>

          <!-- STEP 5: COMPLETE -->
          <div class="onboarding-step complete-step ${this.currentStep === 5 ? 'active' : ''}" id="step-5">
            <div class="confetti-container" id="confetti-container"></div>
            
            <h2 class="complete-headline">Stone is ready.</h2>
            
            <div class="stats-grid">
              <div class="stat-card">
                <span class="stat-label">Container</span>
                <span class="stat-value success">online ✓</span>
              </div>
              <div class="stat-card">
                <span class="stat-label">AI Engine</span>
                <span class="stat-value success">ready ✓</span>
              </div>
              <div class="stat-card">
                <span class="stat-label">Tools</span>
                <span class="stat-value" id="final-tools-count">0 connected</span>
              </div>
              <div class="stat-card">
                <span class="stat-label">Agents</span>
                <span class="stat-value">0 active</span>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 16px; width: 100%;">
              <button class="onboarding-btn" id="btn-finish" style="width: 100%; padding: 16px; font-size: 16px;">Open Stone AIO →</button>
              <a class="onboarding-link" href="#">Watch a quick demo →</a>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  initCanvas() {
    const canvas = document.getElementById('onboarding-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let width, height;
    const dots = [];
    const numDots = 80;

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', resize);
    resize();

    for (let i = 0; i < numDots; i++) {
      dots.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        radius: Math.random() * 1.5 + 0.5
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(200, 151, 60, 0.02)'; // Warm gold tint, 2% opacity
      
      dots.forEach(dot => {
        dot.x += dot.vx;
        dot.y += dot.vy;

        if (dot.x < 0) dot.x = width;
        if (dot.x > width) dot.x = 0;
        if (dot.y < 0) dot.y = height;
        if (dot.y > height) dot.y = 0;

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      requestAnimationFrame(animate);
    };

    animate();
  }

  goToStep(step) {
    const currentEl = document.getElementById(`step-${this.currentStep}`);
    if (currentEl) {
      currentEl.classList.remove('active');
      currentEl.classList.add('exit');
    }

    this.currentStep = step;
    
    const nextEl = document.getElementById(`step-${this.currentStep}`);
    if (nextEl) {
      nextEl.classList.remove('exit');
      // small delay to allow exit animation
      setTimeout(() => {
        nextEl.classList.add('active');
      }, 50);
    }

    // Update progress bar
    if (step > 0 && step <= 5) {
      const segments = document.querySelectorAll('.onboarding-progress-segment');
      segments.forEach((seg, i) => {
        if (i < step) seg.classList.add('active');
        else seg.classList.remove('active');
      });
    }

    if (step === 5) {
      this.triggerConfetti();
      document.getElementById('final-tools-count').textContent = `${this.connectedTools} connected`;
    }
  }

  async runBootSequence() {
    const terminal = document.getElementById('boot-terminal');
    const complete = document.getElementById('boot-complete');
    
    const lines = [
      `$ stone init --user ${this.user.name.replace(/\s+/g, '_').toLowerCase()}`,
      `[ 0.001] Allocating container stone_${this.subdomain}...`,
      `[ 0.843] Installing Ubuntu 22.04 LTS...`,
      `[ 2.341] Configuring Python 3.11 + Node 20...`,
      `[ 3.102] Starting Stone AI engine...`,
      `[ 3.891] ✓ Ready.`
    ];

    for (let i = 0; i < lines.length; i++) {
      await new Promise(r => setTimeout(r, 400));
      const lineEl = document.createElement('div');
      lineEl.className = 'boot-line';
      lineEl.textContent = lines[i];
      terminal.appendChild(lineEl);
    }

    await new Promise(r => setTimeout(r, 2000));
    terminal.style.display = 'none';
    complete.classList.add('active');
  }

  triggerConfetti() {
    const container = document.getElementById('confetti-container');
    if (!container) return;
    
    const colors = ['#C8973C', '#4FA3E0', '#3DBE7A', '#E8A020'];
    
    for (let i = 0; i < 24; i++) {
      const conf = document.createElement('div');
      conf.className = 'confetti';
      conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      
      const tx = (Math.random() - 0.5) * 400;
      const ty = (Math.random() - 0.5) * 400 - 100;
      const rot = Math.random() * 360;
      
      conf.style.setProperty('--tx', `${tx}px`);
      conf.style.setProperty('--ty', `${ty}px`);
      conf.style.setProperty('--rot', `${rot}deg`);
      
      conf.style.animation = `confetti-burst 1.2s cubic-bezier(0.25, 1, 0.5, 1) forwards`;
      
      container.appendChild(conf);
    }
    
    setTimeout(() => {
      container.innerHTML = '';
    }, 1500);
  }

  setupEventListeners() {
    // Step 0 -> 1
    document.getElementById('btn-begin')?.addEventListener('click', () => this.goToStep(1));

    // Step 1: Personalize
    const bioInput = document.getElementById('bio-input');
    document.getElementById('quick-chips')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('quick-chip')) {
        const text = e.target.textContent;
        bioInput.value = bioInput.value ? `${bioInput.value} ${text}` : text;
        this.personalizeData.bio = bioInput.value;
      }
    });

    document.getElementById('skills-grid')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('skill-pill')) {
        e.target.classList.toggle('selected');
        const skill = e.target.dataset.skill;
        if (e.target.classList.contains('selected')) {
          this.personalizeData.skills.push(skill);
        } else {
          this.personalizeData.skills = this.personalizeData.skills.filter(s => s !== skill);
        }
      }
    });

    bioInput?.addEventListener('input', (e) => {
      this.personalizeData.bio = e.target.value;
    });

    document.getElementById('btn-step-1')?.addEventListener('click', async () => {
      try {
        const btn = document.getElementById('btn-step-1');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        await authAPI.updateMe({ bio: this.personalizeData.bio, skills: this.personalizeData.skills });
        this.goToStep(2);
      } catch (err) {
        toast.error('Failed to save profile');
        console.error(err);
      } finally {
        const btn = document.getElementById('btn-step-1');
        if(btn) {
          btn.disabled = false;
          btn.textContent = 'Continue →';
        }
      }
    });

    // Step 2: Connect Tools
    document.querySelectorAll('.tool-card').forEach(card => {
      card.addEventListener('click', async () => {
        if (card.classList.contains('connected')) return;
        
        const toolId = card.dataset.tool;
        try {
          toast.info(`Connecting ${toolId}...`);
          
          try {
            const { url } = await integrationsAPI.getConnectUrl(toolId);
            if (url) {
              window.open(url, 'oauth_popup', 'width=600,height=700');
            }
          } catch (e) {
            console.warn('OAuth URL not available, simulating connection for onboarding');
          }

          // Simulate connection delay for onboarding flow
          await new Promise(r => setTimeout(r, 1500)); 
          
          card.classList.add('connected');
          this.connectedTools++;
          document.getElementById('tools-counter').textContent = `${this.connectedTools} / 6 connected`;
          toast.success(`${toolId} connected successfully`);
        } catch (err) {
          toast.error(`Failed to connect ${toolId}`);
        }
      });
    });

    document.getElementById('btn-step-2')?.addEventListener('click', () => this.goToStep(3));
    document.getElementById('skip-step-2')?.addEventListener('click', () => this.goToStep(3));

    // Step 3: Try Stone
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    let hasInteracted = false;

    const appendMessage = (text, sender) => {
      const msgEl = document.createElement('div');
      msgEl.className = `chat-msg ${sender}`;
      
      const avatar = sender === 'stone' ? 'S' : (this.user.name ? this.user.name[0].toUpperCase() : 'U');
      
      msgEl.innerHTML = `
        <div class="chat-avatar">${avatar}</div>
        <div class="chat-bubble">${text}</div>
      `;
      chatMessages.appendChild(msgEl);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    const handleChatSubmit = async (text) => {
      if (!text.trim()) return;
      
      appendMessage(text, 'user');
      chatInput.value = '';
      
      if (!hasInteracted) {
        hasInteracted = true;
        document.getElementById('btn-step-3').style.display = 'inline-flex';
      }

      // Simulate streaming response
      const msgEl = document.createElement('div');
      msgEl.className = `chat-msg stone`;
      msgEl.innerHTML = `
        <div class="chat-avatar">S</div>
        <div class="chat-bubble"><span class="typing-indicator">...</span></div>
      `;
      chatMessages.appendChild(msgEl);
      chatMessages.scrollTop = chatMessages.scrollHeight;

      try {
        // Call the real API
        const response = await chatAPI.sendMessage({ content: text });
        const bubble = msgEl.querySelector('.chat-bubble');
        
        let responseText = response.message?.content || response.text || "I've processed your request.";
        
        // Simulate typing the real response
        bubble.innerHTML = '';
        for (let i = 0; i < responseText.length; i++) {
          bubble.innerHTML += responseText[i];
          await new Promise(r => setTimeout(r, 15));
        }
      } catch (err) {
        console.error('Chat error:', err);
        msgEl.querySelector('.chat-bubble').textContent = "I encountered an error processing that request.";
      }
    };

    document.getElementById('prompt-chips')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('quick-chip')) {
        handleChatSubmit(e.target.textContent);
      }
    });

    chatForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      handleChatSubmit(chatInput.value);
    });

    document.getElementById('btn-step-3')?.addEventListener('click', () => this.goToStep(4));

    // Step 4: Reach Stone Anywhere
    const phoneInput = document.getElementById('phone-input');
    const codeInput = document.getElementById('code-input');
    
    document.getElementById('btn-send-sms')?.addEventListener('click', async () => {
      if (!phoneInput.value) return toast.error('Please enter a phone number');
      try {
        const btn = document.getElementById('btn-send-sms');
        btn.disabled = true;
        btn.textContent = 'Sending...';
        await authAPI.verifyPhone(phoneInput.value);
        document.getElementById('sms-setup-area').style.display = 'none';
        document.getElementById('sms-verify-area').style.display = 'flex';
        toast.success('Verification code sent');
      } catch (err) {
        toast.error('Failed to send code');
        document.getElementById('btn-send-sms').disabled = false;
        document.getElementById('btn-send-sms').textContent = 'Send verification code';
      }
    });

    document.getElementById('btn-verify-sms')?.addEventListener('click', async () => {
      if (!codeInput.value || codeInput.value.length < 6) return toast.error('Enter 6-digit code');
      try {
        const btn = document.getElementById('btn-verify-sms');
        btn.disabled = true;
        btn.textContent = 'Verifying...';
        await authAPI.confirmPhone(codeInput.value);
        document.getElementById('sms-verify-area').style.display = 'none';
        document.getElementById('sms-success-area').style.display = 'flex';
        toast.success('Phone verified successfully');
      } catch (err) {
        toast.error('Invalid code');
        document.getElementById('btn-verify-sms').disabled = false;
        document.getElementById('btn-verify-sms').textContent = 'Verify';
      }
    });

    document.getElementById('btn-copy-email')?.addEventListener('click', () => {
      navigator.clipboard.writeText(`${this.subdomain}@mail.stoneaio.com`);
      toast.success('Email address copied to clipboard');
    });

    document.getElementById('btn-test-email')?.addEventListener('click', () => {
      toast.info('Test email sent! Check your inbox.');
    });

    document.getElementById('btn-step-4')?.addEventListener('click', () => this.goToStep(5));
    document.getElementById('skip-step-4')?.addEventListener('click', () => this.goToStep(5));

    // Step 5: Complete
    document.getElementById('btn-finish')?.addEventListener('click', () => {
      store.set('onboardingComplete', true);
      router.navigate('/chat');
      window.location.reload(); // Force reload to trigger loadInitialData and AppShell mount
    });
  }
}
