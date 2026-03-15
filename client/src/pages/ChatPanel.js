/**
 * Stone AIO Chat Panel
 */

import { chatAPI } from '../lib/api.js';
import { store } from '../store.js';
import { bus } from '../lib/eventBus.js';
import { toast } from '../lib/toast.js';

export class ChatPanel {
    constructor() {
        this.container = null;
        this.user = store.get('user') || { name: 'User' };
        this.conversations = [];
        this.currentConversation = null;
        this.messages = [];
        this.isStreaming = false;
        this.streamController = null;

        this.state = {
            model: 'claude-sonnet-4-5',
            input: '',
            attachments: [],
            activeSkill: null
        };

        this.models = [
            { id: 'claude-sonnet-4-5', name: 'Claude 3.5 Sonnet', provider: 'claude' },
            { id: 'claude-opus-4-5', name: 'Claude 3 Opus', provider: 'claude' },
            { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini' }
        ];
    }

    mount(container) {
        this.container = container;

        // Inject CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/src/pages/ChatPanel.css';
        document.head.appendChild(link);

        // Inject hljs
        if (!window.hljs) {
            const hljsScript = document.createElement('script');
            hljsScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
            hljsScript.onload = () => {
                // Load custom theme
                const hljsStyle = document.createElement('style');
                hljsStyle.textContent = `
          .hljs { background: var(--bg1); color: var(--text); padding: 12px; }
          .hljs-keyword { color: #D4A0FF; }
          .hljs-string { color: #9DE39B; }
          .hljs-title { color: #80C8FF; }
          .hljs-number { color: #FFAD80; }
          .hljs-comment { color: #706D64; font-style: italic; }
        `;
                document.head.appendChild(hljsStyle);
            };
            document.head.appendChild(hljsScript);
        }

        this.render();
        this.setupEventListeners();
        this.loadConversations();
    }

    unmount() {
        if (this.streamController) {
            this.streamController.stop();
        }
    }

    async loadConversations() {
        try {
            // API call placeholder - Using mock data for UI demo
            // const data = await chatAPI.getConversations();
            // this.conversations = data;
            this.conversations = [
                { id: 1, title: 'Server Configuration Strategy', group: 'Today', unread: true },
                { id: 2, title: 'React Performance Audit', group: 'Today', unread: false },
                { id: 3, title: 'Database Migration Plan', group: 'Yesterday', unread: false, source: '📱' },
                { id: 4, title: 'Project Scoping Notes', group: 'This Week', unread: false, source: '✉️' }
            ];
            this.renderSidebar();
        } catch (e) {
            toast.error('Failed to load conversations.');
        }
    }

    render() {
        this.container.innerHTML = `
      <div class="chat-panel-container">
        <!-- SIDEBAR -->
        <aside class="chat-sidebar">
          <div class="sidebar-header">
            <button class="btn btn-primary btn-new-chat" id="btn-new-chat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              New chat
            </button>
          </div>
          <div class="sidebar-search-container">
            <svg class="sidebar-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="sidebar-search-input" id="chat-search" placeholder="Search...">
          </div>
          <div class="sidebar-list" id="sidebar-list">
            <!-- Rendered via JS -->
          </div>
        </aside>

        <!-- MAIN AREA -->
        <main class="chat-main">
          <!-- HEADER -->
          <header class="chat-header">
            <div class="chat-title-area">
              <div class="chat-header-title" id="current-chat-title">New Conversation</div>
            </div>
            
            <div class="chat-header-actions">
              <div class="chat-model-selector" id="model-selector">
                <div class="model-dot claude"></div>
                <span>Claude 3.5 Sonnet</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
              </div>
              
              <button class="btn btn-ghost btn-icon" title="Clear Chat" id="btn-clear-chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </header>

          <!-- MESSAGES -->
          <div class="chat-messages-scroll" id="messages-scroll">
            <div class="chat-messages-container" id="messages-container">
              <!-- Rendered via JS -->
              <div class="message-stone" style="margin-top: auto; padding-top: 40px; justify-content: center; opacity: 0.5;">
                 <div style="text-align: center; font-family: 'Syne', sans-serif; font-size: 24px; font-weight: 700;">How can I help you build today?</div>
              </div>
            </div>
          </div>

          <!-- INPUT AREA -->
          <div class="chat-input-wrapper">
            
            <!-- Slash Palette -->
            <div class="slash-commands-palette" id="slash-palette">
              <div class="slash-item" data-cmd="/search"><span style="color:var(--accent);">/search</span> <span class="slash-desc">Search web</span></div>
              <div class="slash-item" data-cmd="/run"><span style="color:var(--accent);">/run</span> <span class="slash-desc">Execute code</span></div>
              <div class="slash-item" data-cmd="/skill"><span style="color:var(--accent);">/skill</span> <span class="slash-desc">Load agent skill</span></div>
            </div>

            <div class="chat-input-box">
              <div class="attachments-strip" id="attachments-area" style="display: none;"></div>
              
              <textarea class="chat-textarea" id="chat-input" placeholder="Message Stone... (Press Enter to send, Shift+Enter for newline)"></textarea>
              
              <div class="chat-toolbar">
                <div class="toolbar-left">
                  <button class="toolbar-btn" id="btn-attach" title="Attach File">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                  </button>
                </div>
                
                <div class="toolbar-center">
                  <div id="active-skill-area" style="display: none;"></div>
                  <div class="char-count" id="char-count">0</div>
                </div>
                
                <div class="toolbar-right">
                  <button class="btn-send" id="btn-send" title="Send (Enter)" disabled>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    `;
    }

    renderSidebar() {
        const list = document.getElementById('sidebar-list');
        if (!list) return;

        // Grouping logic
        const groups = {};
        this.conversations.forEach(c => {
            if (!groups[c.group]) groups[c.group] = [];
            groups[c.group].push(c);
        });

        let html = '';
        for (const [groupName, convos] of Object.entries(groups)) {
            html += `<div class="sidebar-group-title">${groupName}</div>`;
            convos.forEach(c => {
                const isActive = this.currentConversation?.id === c.id ? 'active' : '';
                const sourceBadge = c.source ? `<span class="conv-source-badge">${c.source}</span>` : '';
                const statusDot = `<div class="conv-status-dot ${c.unread ? 'unread' : 'read'}"></div>`;

                html += `
          <div class="conversation-item ${isActive}" data-id="${c.id}">
            ${statusDot}
            <div class="conv-title">${c.title}</div>
            ${sourceBadge}
            <div class="conv-actions">
              <button class="conv-action-btn" title="Rename"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
              <button class="conv-action-btn" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </div>
          </div>
        `;
            });
        }

        list.innerHTML = html;
    }

    appendUserMessage(text) {
        const container = document.getElementById('messages-container');
        const msg = document.createElement('div');
        msg.className = 'message-user';
        msg.innerHTML = `
      <div class="message-bubble">${this.escapeHTML(text)}</div>
      <div class="message-meta">Just now</div>
    `;

        // Clear initial greeting if it's the first message
        if (this.messages.length === 0) {
            container.innerHTML = '';
        }

        container.appendChild(msg);
        this.messages.push({ role: 'user', content: text });
        this.scrollToBottom();
    }

    appendStoneMessagePlaceholder() {
        const container = document.getElementById('messages-container');
        const msg = document.createElement('div');
        msg.className = 'message-stone loading-message';
        msg.innerHTML = `
      <div class="stone-avatar-wrap">S</div>
      <div class="stone-content" style="padding-top: 8px;">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
        container.appendChild(msg);
        this.scrollToBottom();
        return msg;
    }

    updateStoneMessage(msgEl, markdown) {
        const contentEl = msgEl.querySelector('.stone-content');
        // In a real app we would use marked.js here. 
        // Implementing a basic mock parser based on specifications for demo.
        let html = markdown
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
            .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
            .replace(/\*(.*)\*/gim, '<em>$1</em>')
            .replace(/`([^`]*)`/gim, '<code>$1</code>')
            .replace(/\n$/gim, '<br />');

        // Parse simple links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        // Replace markdown list dashes with semantic ul/li structure
        if (html.match(/^- .+/m)) {
            html = html.replace(/(?:^- .+(?:\n|$))+/gm, match => {
                const items = match.trim().split('\n').map(line => `<li>${line.substring(2)}</li>`).join('');
                return `<ul>${items}</ul>`;
            });
        }

        contentEl.innerHTML = html + '<span class="streaming-cursor"></span>';

        // Apply highlight.js if any pre code blocks exist
        if (window.hljs) {
            contentEl.querySelectorAll('pre code').forEach((el) => {
                window.hljs.highlightElement(el);
            });
        }

        this.scrollToBottom();
    }

    finishStoneMessage(msgEl, fullMarkdown) {
        this.updateStoneMessage(msgEl, fullMarkdown);
        const cursor = msgEl.querySelector('.streaming-cursor');
        if (cursor) cursor.remove();
        this.isStreaming = false;
        this.updateInputState();
    }

    scrollToBottom() {
        const scrollEl = document.getElementById('messages-scroll');
        scrollEl.scrollTop = scrollEl.scrollHeight;
    }

    setupEventListeners() {
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('btn-send');
        const charCount = document.getElementById('char-count');
        const slashPalette = document.getElementById('slash-palette');

        // Input height auto-grow
        input.addEventListener('input', () => {
            input.style.height = '44px';
            input.style.height = Math.min(input.scrollHeight, 180) + 'px';

            const len = input.value.length;
            charCount.textContent = len;
            if (len > 4000) {
                charCount.className = 'char-count error';
                sendBtn.disabled = true;
            } else if (len > 1000) {
                charCount.className = 'char-count warn';
                sendBtn.disabled = len === 0;
            } else {
                charCount.className = 'char-count';
                sendBtn.disabled = len === 0 && !this.isStreaming;
            }

            // Slash commands trigger
            if (input.value.endsWith('/')) {
                slashPalette.classList.add('active');
            } else if (!input.value.includes('/')) {
                slashPalette.classList.remove('active');
            }
        });

        // Keyboard handlers
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!sendBtn.disabled) {
                    this.handleSend();
                }
            }
        });

        sendBtn.addEventListener('click', () => {
            if (this.isStreaming) {
                this.stopStream();
            } else {
                this.handleSend();
            }
        });

        // Slash palette clicks
        document.querySelectorAll('.slash-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const cmd = e.currentTarget.dataset.cmd;
                input.value = input.value.replace(/\/$/, '') + cmd + ' ';
                slashPalette.classList.remove('active');
                input.focus();
            });
        });

        // Sidebar interactions
        document.getElementById('sidebar-list').addEventListener('click', (e) => {
            const item = e.target.closest('.conversation-item');
            if (item && !e.target.closest('.conv-actions')) {
                document.querySelectorAll('.conversation-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');

                const cId = parseInt(item.dataset.id);
                const convo = this.conversations.find(c => c.id === cId);
                if (convo) {
                    document.getElementById('current-chat-title').textContent = convo.title;
                    item.querySelector('.conv-status-dot').classList.replace('unread', 'read');
                }
            }
        });
    }

    async handleSend() {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        input.style.height = '44px';
        document.getElementById('char-count').textContent = '0';
        document.getElementById('slash-palette').classList.remove('active');

        this.appendUserMessage(text);

        this.isStreaming = true;
        this.updateInputState();

        const msgEl = this.appendStoneMessagePlaceholder();

        // Simulated streaming response
        try {
            // In a real app we would use the api.stream method here:
            // this.streamController = await chatAPI.stream(...)

            const responseText = "I see your message. Let me process that for you.\n\nHere is a simple python snippet as an example:\n\n```python\ndef hello_stone():\n    print('Hello World')\n```\n\n- Powered by **Stone AIO**.";

            let currentText = "";

            for (let i = 0; i < responseText.length; i++) {
                if (!this.isStreaming) break;
                currentText += responseText[i];

                // Update DOM every few chars to be efficient
                if (i % 3 === 0 || i === responseText.length - 1) {
                    this.updateStoneMessage(msgEl, currentText);
                }
                await new Promise(r => setTimeout(r, 20));
            }

            this.finishStoneMessage(msgEl, currentText);

        } catch (e) {
            this.finishStoneMessage(msgEl, "Sorry, I encountered an error connecting to the backend.");
        }
    }

    stopStream() {
        if (this.streamController) {
            this.streamController.stop();
        }
        this.isStreaming = false;
        this.updateInputState();
    }

    updateInputState() {
        const sendBtn = document.getElementById('btn-send');
        if (this.isStreaming) {
            sendBtn.innerHTML = '<div style="width: 10px; height: 10px; background: var(--err); border-radius: 2px;"></div>';
            sendBtn.classList.add('btn-stop');
            sendBtn.title = "Stop Generating";
            sendBtn.disabled = false;
        } else {
            sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
            sendBtn.classList.remove('btn-stop');
            sendBtn.title = "Send (Enter)";
            const len = document.getElementById('chat-input').value.length;
            sendBtn.disabled = len === 0;
        }
    }

    escapeHTML(str) {
        return str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag] || tag));
    }
}
