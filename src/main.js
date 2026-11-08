  /* ============================================================
   ARIA — APPLICATION LOGIC
   Adaptive Real-life Intelligence Agent
   Streaming chat · conversations · analytics · PWA
   ============================================================ */

import { renderMarkdown, escapeHtml as escHtml, getCodeBlock } from './markdown.js';

/* ------------------------------------------------------------------
   1. STATE
------------------------------------------------------------------ */

const STORAGE_KEY = 'aria_state_v2';
const LEGACY_KEY = 'aria_app_state';
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES_PER_CONV = 80;
const MAX_INPUT_CHARS = 8000;

const appState = {
  currentMode: 'think',
  currentView: 'chat',
  conversations: [],        // [{id, title, mode, messages[], createdAt, updatedAt}]
  activeId: null,
  isTyping: false,
  abortController: null,
  modeCount: { think: 0, research: 0, create: 0, execute: 0 },
  totalMsgs: 0,
  sessions: 1,
  sumMs: 0,
  msCount: 0,
  activity: {},             // {'YYYY-MM-DD': messageCount}
  newsItems: [],
  newsFilter: 'all',
  historyQuery: '',
  recognition: null,
  isRecording: false,
  sidebarCollapsed: false,
  pendingImages: [],
  settings: {
    enterToSend: true,
    soundEnabled: false,
    autoScroll: true,
    showTimestamp: true,
    theme: 'dark',
    fontSize: 14,
    defaultMode: 'think',
    userName: 'User',
    userTitle: '',
    streaming: true,
    temperature: 0.7,
    maxTokens: 2048,
    customInstructions: ''
  }
};

/* ------------------------------------------------------------------
   2. API CONFIG + PROVIDER CATALOG
------------------------------------------------------------------ */

const apiConfig = {
  provider: localStorage.getItem('aria_api_provider') || 'gemini',
  keys: {
    gemini: localStorage.getItem('aria_api_key_gemini') || '',
    openai: localStorage.getItem('aria_api_key_openai') || '',
    anthropic: localStorage.getItem('aria_api_key_anthropic') || '',
    openrouter: localStorage.getItem('aria_api_key_openrouter') || '',
    local: localStorage.getItem('aria_api_key_local') || '' // optional (vLLM/LM Studio)
  },
  models: {
    gemini: localStorage.getItem('aria_api_model_gemini') || 'gemini-3.6-flash',
    openai: localStorage.getItem('aria_api_model_openai') || 'gpt-6-luna',
    anthropic: localStorage.getItem('aria_api_model_anthropic') || 'claude-sonnet-5-5',
    openrouter: localStorage.getItem('aria_api_model_openrouter') || 'openai/gpt-6-luna',
    local: localStorage.getItem('aria_api_model_local') || 'llama3.2'
  }
};

/**
 * Providers retire model ids; a value saved months ago can 404 forever.
 * Rewrite any known-retired id to its current replacement and persist it, so a
 * stale localStorage entry can never silently break a working API key.
 */
function migrateRetiredModels() {
  let changed = false;
  for (const [provider, model] of Object.entries(apiConfig.models)) {
    const replacement = RETIRED_MODELS[model];
    if (replacement) {
      apiConfig.models[provider] = replacement;
      localStorage.setItem(`aria_api_model_${provider}`, replacement);
      changed = true;
      console.info(`[ARIA] Model "${model}" is retired — switched to "${replacement}".`);
    }
  }
  return changed;
}

// Offline fallback (the server's /api/models is the source of truth when reachable)
// Keep these in sync with server/providers.js — they are used when the API is down.
const providerModels = {
  gemini: [
    { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
    { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }
  ],
  openai: [
    { value: 'gpt-6-luna', label: 'GPT-6 Luna' },
    { value: 'gpt-6-sol', label: 'GPT-6 Sol' },
    { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' }
  ],
  anthropic: [
    { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' }
  ],
  openrouter: [
    { value: 'openai/gpt-6-luna', label: 'GPT-6 Luna (OpenRouter)' },
    { value: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra (OpenRouter)' },
    { value: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5 (OpenRouter)' },
    { value: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash (OpenRouter)' },
    { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (OpenRouter)' }
  ],
  // Placeholder until /api/models/live returns what's actually pulled locally.
  local: [
    { value: 'llama3.2', label: 'Llama 3.2' },
    { value: 'qwen2.5:7b', label: 'Qwen 2.5 7B' },
    { value: 'gemma2:9b', label: 'Gemma 2 9B' },
    { value: 'phi4', label: 'Phi-4' },
    { value: 'mistral:7b', label: 'Mistral 7B' },
    { value: 'deepseek-r1:8b', label: 'DeepSeek R1 8B' }
  ]
};

/** Providers that run on the user's own machine and need no API key. */
const KEYLESS_PROVIDERS = new Set(['local']);

/**
 * Model ids that a provider has retired since this build shipped. A stale value
 * persisted in localStorage would otherwise 404 forever — swap it for a current
 * replacement instead of asking the user to guess.
 */
const RETIRED_MODELS = {
  'gemini-2.5-flash': 'gemini-3.6-flash',
  'gemini-2.5-pro': 'gemini-3.6-flash',
  'gemini-2.0-flash': 'gemini-3.5-flash',
  'gpt-4o-mini': 'gpt-6-luna',
  'gpt-4o': 'gpt-6-sol',
  'gpt-4.1-mini': 'gpt-5.6-terra',
  'gpt-4.1': 'gpt-5.6-sol',
  'o4-mini': 'gpt-5.6-luna',
  'claude-sonnet-4-20250514': 'claude-sonnet-5-5',
  'claude-3-7-sonnet-latest': 'claude-sonnet-4-6',
  'claude-3-5-haiku-latest': 'claude-haiku-5-5',
  'claude-3-5-sonnet-latest': 'claude-sonnet-5-5',
  'openai/gpt-4o-mini': 'openai/gpt-6-luna',
  'anthropic/claude-3.5-sonnet': 'anthropic/claude-sonnet-5.5',
  'google/gemini-2.5-flash': 'google/gemini-3.6-flash'
};
let remoteModels = null; // populated from /api/models

/* ------------------------------------------------------------------
   3. MODES
------------------------------------------------------------------ */

const modes = {
  think: {
    label: 'Think', color: 'var(--think)', icon: 'ti-bulb',
    system: `You are ARIA in THINK mode — a world-class strategic thinker and decision coach. Break down the user's problem using first principles, mental models, frameworks (SWOT, 80/20, inversion, etc.), clear pros/cons, and decisive recommendations. Be sharp, structured, practical, and confident. Aim for 150-200 words unless depth is required.`,
    chips: ['Help me decide: quit my job or stay?', 'Break down my biggest goal', 'What mental model fits my problem?', 'How do I build a daily discipline?', 'Analyse my decision from all angles']
  },
  research: {
    label: 'Research', color: 'var(--research)', icon: 'ti-search',
    system: `You are ARIA in RESEARCH mode — a world-class analyst and knowledge expert. Give structured, accurate, insightful answers with key facts, historical context, nuance, and clear takeaways. Use headers or bullet points when helpful. Cite what you know. Be comprehensive yet concise — 200-250 words unless the topic needs more depth.`,
    chips: ['Explain quantum computing simply', 'What is happening in AI right now?', 'How does the global economy actually work?', 'Explain CRISPR and gene editing', 'What caused the 2008 financial crisis?']
  },
  create: {
    label: 'Create', color: 'var(--create)', icon: 'ti-pencil',
    system: `You are ARIA in CREATE mode — a brilliant creative director, copywriter, and storyteller. Help the user create compelling, original, memorable content. Whether writing, brainstorming, crafting pitches, or generating ideas — be vivid, punchy, and surprising. Quality over quantity. 150-220 words unless a full draft is needed.`,
    chips: ['Write a powerful personal bio', '5 unique startup ideas for 2026', 'Cold email template that gets replies', 'Write an opening paragraph for my essay', 'Give my brand a killer tagline']
  },
  execute: {
    label: 'Execute', color: 'var(--execute)', icon: 'ti-rocket',
    system: `You are ARIA in EXECUTE mode — a master of planning, systems, and execution. Turn the user's goals into clear, prioritised, actionable step-by-step plans with timelines and milestones. No fluff — every line is an action the user can take. Use numbered lists or structured plans. 200-250 words.`,
    chips: ['Plan my week for maximum output', 'How do I launch a side project in 30 days?', 'Build a 90-day fitness plan', "What's the fastest way to learn a skill?", 'Create a morning routine that actually works']
  }
};

/* ------------------------------------------------------------------
   4. HELPERS
------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const timeLabel = (ts) =>
  new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function toast(msg, type = '') {
  const c = $('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const icon = type === 'success' ? 'ti-check' : type === 'error' ? 'ti-x' : 'ti-info-circle';
  const color = type === 'success' ? 'research' : type === 'error' ? 'create' : 'accent2';
  t.innerHTML = `<i class="ti ${icon}" style="font-size:15px;color:var(--${color})"></i><span>${escHtml(msg)}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'slideOut 0.25s ease forwards';
    setTimeout(() => t.remove(), 250);
  }, 3200);
}

function playSound(kind = 'send') {
  if (!appState.settings.soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = kind === 'recv' ? 660 : 880;
    g.gain.setValueAtTime(0.07, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.start();
    o.stop(ctx.currentTime + 0.18);
    o.onended = () => ctx.close();
  } catch (e) {
    /* audio unavailable */
  }
}

/* ------------------------------------------------------------------
   5. PERSISTENCE (with legacy migration + quota guard)
------------------------------------------------------------------ */

function serializeConversations(stripImages = false) {
  return appState.conversations.slice(0, MAX_CONVERSATIONS).map((c) => ({
    id: c.id,
    title: c.title,
    mode: c.mode,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messages: c.messages.slice(-MAX_MESSAGES_PER_CONV).map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.images && !stripImages ? { images: m.images } : {}),
      ...(m.ms ? { ms: m.ms } : {}),
      ...(m.ts ? { ts: m.ts } : {}),
      ...(m.mode ? { mode: m.mode } : {}),
      ...(m.stopped ? { stopped: true } : {})
    }))
  }));
}

function persist() {
  const payload = () => ({
    v: 2,
    conversations: serializeConversations(false),
    activeId: appState.activeId,
    modeCount: appState.modeCount,
    totalMsgs: appState.totalMsgs,
    sessions: appState.sessions,
    sumMs: appState.sumMs,
    msCount: appState.msCount,
    activity: appState.activity,
    settings: appState.settings
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload()));
  } catch (e) {
    // Quota exceeded → shed image payloads first, then old conversations.
    try {
      const lean = payload();
      lean.conversations = serializeConversations(true);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lean));
    } catch (e2) {
      try {
        const lean = payload();
        lean.conversations = serializeConversations(true).slice(0, 10);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lean));
      } catch (e3) {
        console.warn('Persist failed:', e3);
      }
    }
  }
}
const persistDebounced = (() => {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(persist, 400);
  };
})();

function migrateLegacy() {
  // v1 shape: {allHistory:[{id,mode,label,msgs,time}], modeCount, totalMsgs, sessions, settings}
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const old = JSON.parse(raw);
    const conversations = (old.allHistory || [])
      .filter((h) => Array.isArray(h.msgs) && h.msgs.length)
      .map((h, i) => ({
        id: h.id || uid(),
        title: h.label || 'Conversation',
        mode: h.mode in modes ? h.mode : 'think',
        createdAt: Date.now() - (i + 1) * 60000,
        updatedAt: Date.now() - i * 60000,
        messages: h.msgs.map((m) => ({ role: m.role, content: m.content, ts: Date.now() }))
      }));

    return {
      v: 2,
      conversations,
      activeId: null,
      modeCount: old.modeCount || { think: 0, research: 0, create: 0, execute: 0 },
      totalMsgs: old.totalMsgs || 0,
      sessions: old.sessions || 1,
      sumMs: 0,
      msCount: 0,
      activity: {},
      settings: { ...appState.settings, ...(old.settings || {}) }
    };
  } catch (e) {
    console.warn('Legacy migration failed:', e);
    return null;
  }
}

function loadState() {
  let parsed = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to read state:', e);
  }
  if (!parsed) parsed = migrateLegacy();

  if (parsed && typeof parsed === 'object') {
    appState.conversations = Array.isArray(parsed.conversations) ? parsed.conversations : [];
    appState.activeId = parsed.activeId || null;
    appState.modeCount = { ...appState.modeCount, ...(parsed.modeCount || {}) };
    appState.totalMsgs = parsed.totalMsgs || 0;
    appState.sessions = parsed.sessions || 1;
    appState.sumMs = parsed.sumMs || 0;
    appState.msCount = parsed.msCount || 0;
    appState.activity = parsed.activity || {};
    appState.settings = { ...appState.settings, ...(parsed.settings || {}) };
    if (parsed.v !== 2) persist();
  }

  // Drop conversations whose active id no longer exists.
  if (appState.activeId && !appState.conversations.some((c) => c.id === appState.activeId)) {
    appState.activeId = null;
  }
}

/* ------------------------------------------------------------------
   6. CONVERSATIONS
------------------------------------------------------------------ */

function activeConv() {
  return appState.conversations.find((c) => c.id === appState.activeId) || null;
}

function ensureConversation() {
  let conv = activeConv();
  if (!conv) {
    conv = {
      id: uid(),
      title: '',
      mode: appState.currentMode,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    appState.conversations.unshift(conv);
    appState.activeId = conv.id;
    appState.sessions++;
  }
  return conv;
}

function conversationTitle(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > 52 ? clean.slice(0, 52) + '…' : clean;
}

function renderConversationList() {
  const el = $('historyList');
  if (!el) return;
  const q = appState.historyQuery.trim().toLowerCase();
  const list = appState.conversations.filter(
    (c) => !q || (c.title || '').toLowerCase().includes(q) || c.messages.some((m) => (m.content || '').toLowerCase().includes(q))
  );

  if (!list.length) {
    el.innerHTML = `<div class="hist-empty">${q ? 'No chats match your search.' : 'No chats yet — start one with the button above.'}</div>`;
    return;
  }

  const now = Date.now();
  const buckets = { Today: [], Yesterday: [], 'Previous 7 days': [], Older: [] };
  for (const c of list) {
    const age = now - c.updatedAt;
    if (age < 864e5 && new Date(c.updatedAt).getDate() === new Date().getDate()) buckets.Today.push(c);
    else if (age < 1728e5) buckets.Yesterday.push(c);
    else if (age < 7 * 864e5) buckets['Previous 7 days'].push(c);
    else buckets.Older.push(c);
  }

  const html = Object.entries(buckets)
    .filter(([, items]) => items.length)
    .map(([label, items]) => {
      const rows = items
        .map((c) => {
          const icon = modes[c.mode]?.icon || 'ti-message';
          const color = modes[c.mode]?.color || 'var(--text3)';
          const active = c.id === appState.activeId ? ' active' : '';
          return `<div class="hist-item${active}" data-conv="${c.id}" role="listitem" title="${escHtml(c.title || 'Untitled chat')}">
            <i class="ti ${icon}" style="color:${color}"></i>
            <span class="hist-item-label">${escHtml(c.title || 'Untitled chat')}</span>
            <button class="hist-del" data-del="${c.id}" title="Delete chat" aria-label="Delete chat"><i class="ti ti-x"></i></button>
          </div>`;
        })
        .join('');
      return `<div class="hist-group-label">${label}</div>${rows}`;
    })
    .join('');

  el.innerHTML = html;
}

function openConversation(id) {
  const conv = appState.conversations.find((c) => c.id === id);
  if (!conv) return;
  if (appState.isTyping) stopGeneration();
  appState.activeId = id;
  if (conv.mode && modes[conv.mode]) switchMode(conv.mode, { keepView: true });
  renderConversation();
  renderConversationList();
  showView('chat');
  closeMobileSidebar();
}

function renameConversation(id) {
  const conv = appState.conversations.find((c) => c.id === id);
  const row = document.querySelector(`.hist-item[data-conv="${id}"] .hist-item-label`);
  if (!conv || !row) return;
  const input = document.createElement('input');
  input.className = 'hist-rename';
  input.value = conv.title || '';
  input.setAttribute('aria-label', 'Rename chat');
  row.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    conv.title = input.value.trim() || conv.title || 'Untitled chat';
    conv.updatedAt = Date.now();
    renderConversationList();
    persistDebounced();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = conv.title || ''; input.blur(); }
    e.stopPropagation();
  });
}

function deleteConversation(id) {
  const conv = appState.conversations.find((c) => c.id === id);
  if (!conv) return;
  if (!confirm(`Delete "${conv.title || 'this chat'}"? This cannot be undone.`)) return;
  appState.conversations = appState.conversations.filter((c) => c.id !== id);
  if (appState.activeId === id) {
    appState.activeId = null;
    renderConversation();
  }
  renderConversationList();
  persist();
  toast('Chat deleted');
}

function filterHistory(value) {
  appState.historyQuery = value || '';
  renderConversationList();
}

function clearAllHistory() {
  if (!appState.conversations.length) {
    toast('No history to clear');
    return;
  }
  if (!confirm('Clear ALL conversations? This cannot be undone.')) return;
  if (appState.isTyping) stopGeneration();
  appState.conversations = [];
  appState.activeId = null;
  renderConversation();
  renderConversationList();
  persist();
  toast('History cleared', 'success');
}

/* ------------------------------------------------------------------
   7. SIDEBAR / VIEW SWITCHING
------------------------------------------------------------------ */

function toggleSidebar() {
  appState.sidebarCollapsed = !appState.sidebarCollapsed;
  $('sidebar').classList.toggle('collapsed', appState.sidebarCollapsed);
  syncDrawerToggle();
}

/**
 * One control for both layouts: on mobile it opens the drawer overlay, on
 * desktop it collapses/expands the sidebar. (The in-sidebar collapse button
 * cannot fit in the 60px rail, so the topbar toggle is the way back.)
 */
function toggleDrawer() {
  if (window.matchMedia('(max-width: 700px)').matches) {
    if ($('sidebar').classList.contains('mobile-open')) closeMobileSidebar();
    else openMobileSidebar();
  } else {
    toggleSidebar();
  }
}

/** Keep the topbar toggle's icon/title honest and tooltip the icon rail. */
function syncDrawerToggle() {
  const collapsed = appState.sidebarCollapsed;
  const btn = $('drawerToggle');
  if (btn) {
    const icon = btn.querySelector('i');
    if (icon) icon.className = collapsed ? 'ti ti-layout-sidebar-left-expand' : 'ti ti-menu-2';
    btn.title = collapsed ? 'Expand sidebar' : 'Open menu';
    btn.setAttribute('aria-label', btn.title);
  }
  // The rail hides the labels — expose them as native tooltips instead.
  document.querySelectorAll('#sidebar .nav-item').forEach((item) => {
    const label = item.querySelector('.ni-label')?.textContent.trim();
    if (!label) return;
    if (collapsed) item.title = label;
    else item.removeAttribute('title');
  });
}
function openMobileSidebar() {
  $('sidebar').classList.add('mobile-open');
  $('sidebarOverlay').classList.remove('hidden');
}
function closeMobileSidebar() {
  $('sidebar').classList.remove('mobile-open');
  $('sidebarOverlay').classList.add('hidden');
}

function switchMode(mode, opts = {}) {
  if (!modes[mode]) return;
  appState.currentMode = mode;
  ['think', 'research', 'create', 'execute'].forEach((m) => $('nav-' + m)?.classList.remove('active'));
  $('nav-' + mode)?.classList.add('active');

  $('topDot').setAttribute('style', `background:${modes[mode].color}`);
  $('topModeLabel').textContent = modes[mode].label;

  const conv = activeConv();
  if (conv && conv.messages.length) conv.mode = mode;

  if (!opts.keepView) showView('chat');
  renderChips();
  closeMobileSidebar();
}

function showView(view) {
  appState.currentView = view;
  ['chatView', 'dashView', 'newsView', 'settingsView'].forEach((v) => $(v)?.classList.add('hidden'));
  $(view + 'View')?.classList.remove('hidden');

  ['think', 'research', 'create', 'execute', 'news', 'dash', 'settings'].forEach((n) =>
    $('nav-' + n)?.classList.remove('active')
  );

  if (view === 'chat') {
    $('nav-' + appState.currentMode)?.classList.add('active');
    $('topDot').setAttribute('style', `background:${modes[appState.currentMode].color}`);
    $('topModeLabel').textContent = modes[appState.currentMode].label;
  } else {
    $('nav-' + view)?.classList.add('active');
    const labels = { news: 'World Feed', dash: 'Dashboard', settings: 'Settings' };
    const colors = { news: 'var(--news)', dash: 'var(--accent2)', settings: 'var(--accent)' };
    $('topDot').setAttribute('style', `background:${colors[view] || 'var(--accent)'}`);
    $('topModeLabel').textContent = labels[view] || 'ARIA';
  }

  if (view === 'dash') renderDashboard();
  if (view === 'news' && !appState.newsItems.length) loadNews();
  if (view === 'settings') syncSettingsUI();
  closeMobileSidebar();
}

/* ------------------------------------------------------------------
   8. CHIPS
------------------------------------------------------------------ */

function renderChips() {
  const chips = modes[appState.currentMode]?.chips || [];
  $('chipsRow').innerHTML = chips
    .map((c) => `<button class="chip" onclick="fillChip(this.textContent)">${escHtml(c)}</button>`)
    .join('');
}
function fillChip(text) {
  $('chatInput').value = text;
  onInputChange($('chatInput'));
  sendMessage();
}

/* ------------------------------------------------------------------
   9. INPUT + IMAGE ATTACHMENTS
------------------------------------------------------------------ */

function onInputChange(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  const len = el.value.length;
  $('charCount').textContent = len > MAX_INPUT_CHARS - 1000 ? `${len}/${MAX_INPUT_CHARS}` : '';
  if (len > MAX_INPUT_CHARS) {
    el.value = el.value.slice(0, MAX_INPUT_CHARS);
    toast('Message length limit reached', 'error');
  }
}

function handleInputKey(e) {
  if (appState.settings.enterToSend && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSendClick();
  }
}

function pickImage() {
  if (appState.pendingImages.length >= 4) {
    toast('Maximum 4 images per message', 'error');
    return;
  }
  $('imageInput').click();
}

async function handleFiles(files) {
  const list = Array.from(files || []).slice(0, 4 - appState.pendingImages.length);
  for (const file of list) {
    if (!file.type.startsWith('image/')) continue;
    if (file.size > 12 * 1024 * 1024) {
      toast(`${file.name} is too large (max 12MB)`, 'error');
      continue;
    }
    try {
      const img = await downscaleImage(file);
      appState.pendingImages.push(img);
    } catch (e) {
      toast('Could not read that image', 'error');
    }
  }
  $('imageInput').value = '';
  renderAttachTray();
}

/** Compress before upload: keeps payloads small and payloads fast. */
function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const max = 1280;
        let { width, height } = image;
        if (width > max || height > max) {
          const ratio = Math.min(max / width, max / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(image, 0, 0, width, height);
        const mimeType = file.type === 'image/png' && file.size < 400000 ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, 0.85);
        resolve({
          mimeType,
          data: dataUrl.split(',')[1],
          preview: dataUrl,
          name: file.name || 'image'
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderAttachTray() {
  const tray = $('attachTray');
  if (!appState.pendingImages.length) {
    tray.classList.add('hidden');
    tray.innerHTML = '';
    return;
  }
  tray.classList.remove('hidden');
  tray.innerHTML = appState.pendingImages
    .map(
      (img, i) => `<div class="attach-chip"><img src="${img.preview}" alt="${escHtml(img.name)}">
        <button onclick="removeImage(${i})" title="Remove" aria-label="Remove image"><i class="ti ti-x"></i></button></div>`
    )
    .join('');
}
function removeImage(i) {
  appState.pendingImages.splice(i, 1);
  renderAttachTray();
}
/* ------------------------------------------------------------------
   11. MESSAGE RENDERING
------------------------------------------------------------------ */

function showChatMessages() {
  $('welcomeScreen').classList.add('hidden');
  $('chatMessages').classList.remove('hidden');
  $('chipsArea').classList.add('hidden');
}
function hideChatMessages() {
  $('welcomeScreen').classList.remove('hidden');
  $('chatMessages').classList.add('hidden');
  $('chipsArea').classList.remove('hidden');
}

function buildUserEl(msg, idx) {
  const div = document.createElement('div');
  div.className = 'msg-group fade-up';
  div.dataset.idx = idx;
  const images =
    msg.images && msg.images.length
      ? `<div class="msg-images">${msg.images.map((im) => `<img src="data:${im.mimeType};base64,${im.data}" alt="Attachment">`).join('')}</div>`
      : '';
  const ts = appState.settings.showTimestamp ? `<span class="meta-time"> · ${timeLabel(msg.ts)}</span>` : '';
  div.innerHTML = `<div class="msg-row user-row">
      <div class="msg-av user"><i class="ti ti-user" style="font-size:13px"></i></div>
      <div class="msg-content">
        <div class="msg-meta" style="justify-content:flex-end">You${ts}</div>
        <div class="msg-bubble user-b">${images}${escHtml(msg.content)}</div>
      </div>
    </div>`;
  return div;
}

function buildAssistantEl(msg, idx, conv) {
  const div = document.createElement('div');
  div.className = 'msg-group fade-up';
  div.dataset.idx = idx;
  const mode = modes[msg.mode] || modes[conv?.mode] || modes.think;
  const streaming = Boolean(msg.streaming);
  const timeBits = [];
  if (appState.settings.showTimestamp) timeBits.push(timeLabel(msg.ts));
  if (msg.ms) timeBits.push(`${(msg.ms / 1000).toFixed(1)}s`);
  const meta = timeBits.length ? `<span class="meta-time"> · ${timeBits.join(' · ')}</span>` : '';

  const isLast = idx === (conv?.messages.length || 0) - 1;
  const actions =
    streaming || !isLast
      ? ''
      : `<div class="msg-actions">
        <button class="msg-act-btn" data-act="copy" data-idx="${idx}" title="Copy"><i class="ti ti-copy"></i> Copy</button>
        <button class="msg-act-btn" data-act="speak" data-idx="${idx}" title="Read aloud"><i class="ti ti-volume"></i> Speak</button>
        <button class="msg-act-btn regenerate" data-act="regen" data-idx="${idx}" title="Regenerate"><i class="ti ti-refresh"></i> Regenerate</button>
      </div>`;

  div.innerHTML = `<div class="msg-row">
      <div class="msg-av aria">A</div>
      <div class="msg-content">
        <div class="msg-meta">ARIA <span class="msg-badge" style="background:${mode.color}18;color:${mode.color}">${mode.label}</span>${meta}</div>
        <div class="msg-bubble aria-b" data-md="${idx}">${renderMarkdown(msg.content)}${
          streaming ? '<span class="cursor-blink"></span>' : ''
        }</div>
        ${msg.stopped ? '<div class="stop-note"><i class="ti ti-player-stop"></i> Stopped by you</div>' : ''}
        ${actions}
      </div>
    </div>`;
  return div;
}

function buildMessageEl(msg, idx) {
  const conv = activeConv();
  return msg.role === 'user' ? buildUserEl(msg, idx) : buildAssistantEl(msg, idx, conv);
}

function renderConversation() {
  const cm = $('chatMessages');
  const conv = activeConv();
  cm.innerHTML = '';
  if (!conv || !conv.messages.length) {
    hideChatMessages();
    return;
  }
  showChatMessages();
  const frag = document.createDocumentFragment();
  conv.messages.forEach((m, i) => frag.appendChild(buildMessageEl(m, i)));
  cm.appendChild(frag);
  scrollDown(true);
}

function appendMessageEl(msg, idx) {
  const cm = $('chatMessages');
  const el = buildMessageEl(msg, idx);
  cm.appendChild(el);
  scrollDown();
  return el;
}

function scrollDown(force = false) {
  if (!force && !appState.settings.autoScroll) return;
  const cm = $('chatMessages');
  cm.scrollTop = cm.scrollHeight;
  $('scrollDownBtn')?.classList.add('hidden');
}

function refreshScrollButton() {
  const cm = $('chatMessages');
  const btn = $('scrollDownBtn');
  if (!btn || cm.classList.contains('hidden')) return;
  const distance = cm.scrollHeight - cm.scrollTop - cm.clientHeight;
  btn.classList.toggle('hidden', distance < 120);
}

function applyFontSize(size) {
  const px = parseInt(size, 10) || 14;
  document.documentElement.style.setProperty('--msg-size', px + 'px');
  appState.settings.fontSize = px;
  const sel = $('fontSizeSetting');
  if (sel) sel.value = String(px);
  persistDebounced();
}

/* ------------------------------------------------------------------
   12. CHAT FLOW (streaming + fallback)
------------------------------------------------------------------ */

function buildSystemPrompt(mode) {
  const base = modes[mode]?.system || modes.think.system;
  const custom = (appState.settings.customInstructions || '').trim();
  return custom ? `${base}\n\nUser-level instructions that always apply:\n${custom}` : base;
}

function buildPayload(conv) {
  const history = conv.messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content || '').trim().length > 0)
    .slice(-14)
    .map((m) => ({ role: m.role, content: m.content, ...(m.images?.length ? { images: m.images } : {}) }));
  return {
    provider: apiConfig.provider,
    model: apiConfig.models[apiConfig.provider],
    messages: history,
    system: buildSystemPrompt(conv.mode),
    temperature: appState.settings.temperature,
    maxTokens: appState.settings.maxTokens
  };
}

function requestHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const key = apiConfig.keys[apiConfig.provider];
  if (key) headers['x-api-key'] = key;
  return headers;
}

function setSendState(state) {
  const btn = $('sendBtn');
  const icon = $('sendIcon');
  if (!btn || !icon) return;
  if (state === 'stop') {
    btn.classList.add('stop');
    icon.className = 'ti ti-player-stop';
    btn.title = 'Stop generating (Esc)';
    btn.setAttribute('aria-label', 'Stop generating');
  } else {
    btn.classList.remove('stop');
    icon.className = 'ti ti-arrow-up';
    btn.title = 'Send (Enter)';
    btn.setAttribute('aria-label', 'Send message');
  }
}

function onSendClick() {
  if (appState.isTyping) stopGeneration();
  else sendMessage();
}

function stopGeneration() {
  if (appState.abortController) {
    appState.abortController.abort();
    toast('Stopped');
  }
}

async function readSse(res, { onDelta }) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = null;
  while (true) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      let event = 'message';
      let data = '';
      for (const line of chunk.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === 'delta' && parsed.text) onDelta(parsed.text);
      else if (event === 'done') done = parsed;
      else if (event === 'error') throw Object.assign(new Error(parsed.error || 'Generation failed.'), { code: parsed.code });
    }
  }
  return done;
}

/** Non-streaming request used as a fallback and when streaming is disabled. */
async function fetchPlainReply(payload, signal) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(payload),
    signal
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.reply || '';
}

async function sendMessage() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (appState.isTyping) return;
  if (!text && !appState.pendingImages.length) return;
  if (!text && appState.pendingImages.length) {
    toast('Add a caption for your image', 'error');
    return;
  }

  input.value = '';
  input.style.height = 'auto';
  $('charCount').textContent = '';

  const conv = ensureConversation();
  const isFirst = conv.messages.length === 0;
  if (isFirst && !conv.title) conv.title = conversationTitle(text);
  conv.mode = appState.currentMode;
  conv.updatedAt = Date.now();

  const userMsg = {
    role: 'user',
    content: text,
    ts: Date.now(),
    ...(appState.pendingImages.length ? { images: appState.pendingImages.map(({ mimeType, data }) => ({ mimeType, data })) } : {})
  };
  conv.messages.push(userMsg);

  const trayHadImages = appState.pendingImages.length > 0;
  appState.pendingImages = [];
  renderAttachTray();

  showChatMessages();
  appendMessageEl(userMsg, conv.messages.length - 1);

  appState.totalMsgs++;
  appState.modeCount[conv.mode] = (appState.modeCount[conv.mode] || 0) + 1;
  bumpActivity();
  renderConversationList();
  playSound('send');

  if (trayHadImages && apiConfig.provider === 'anthropic') {
    // Anthropic only supports PNG/JPEG/GIF/WebP.
    toast('Tip: Anthropic accepts PNG, JPEG, GIF and WebP only', 'info');
  }

  await requestReply(conv);
}

async function requestReply(conv) {
  conv = conv || activeConv();
  if (!conv) return;

  const msg = { role: 'assistant', content: '', mode: conv.mode, ts: Date.now(), streaming: true };
  conv.messages.push(msg);
  const idx = conv.messages.length - 1;
  const el = appendMessageEl(msg, idx);
  const mdEl = el.querySelector(`[data-md="${idx}"]`);

  appState.isTyping = true;
  setSendState('stop');
  const controller = new AbortController();
  appState.abortController = controller;

  const started = performance.now();
  let paintQueued = false;
  const paint = () => {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      if (mdEl) mdEl.innerHTML = renderMarkdown(msg.content) + '<span class="cursor-blink"></span>';
      if (appState.settings.autoScroll) scrollDown(true);
    });
  };

  const finish = (stopped = false) => {
    msg.streaming = false;
    msg.ms = Math.round(performance.now() - started);
    if (stopped) msg.stopped = true;
    if (!msg.content) {
      conv.messages.splice(idx, 1);
      el.remove();
      if (!conv.messages.length) renderConversation();
    } else {
      el.replaceWith(buildMessageEl(msg, idx));
      playSound('recv');
    }
    conv.updatedAt = Date.now();
    if (msg.ms) {
      appState.sumMs += msg.ms;
      appState.msCount++;
    }
    persistDebounced();
    renderConversationList();
  };

  try {
    const payload = buildPayload(conv);

    if (appState.settings.streaming) {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (res.status === 404) {
        // Older proxy without the streaming endpoint — fall back to a plain request.
        msg.content = await fetchPlainReply(payload, controller.signal);
      } else if (!res.ok || !res.body) {
        let data = {};
        try {
          data = await res.json();
        } catch {
          /* non-JSON error */
        }
        throw new Error(data.error || `Server error ${res.status}`);
      } else {
        await readSse(res, { onDelta: (t) => { msg.content += t; paint(); } });
      }
    } else {
      msg.content = await fetchPlainReply(payload, controller.signal);
    }

    if (!msg.content.trim()) throw new Error('The model returned an empty response.');
    finish(false);
  } catch (error) {
    const aborted = controller.signal.aborted;
    if (aborted) {
      finish(Boolean(msg.content));
      if (!msg.content) toast('Generation stopped');
    } else {
      // Roll back the empty placeholder and surface a retryable error bubble.
      conv.messages.splice(idx, 1);
      el.remove();
      showErrorBubble(error.message || 'Something went wrong.', conv);
      console.error('Chat error:', error);
    }
  } finally {
    appState.isTyping = false;
    appState.abortController = null;
    setSendState('send');
    persist();
    $('chatInput').focus();
  }
}

function showErrorBubble(message, conv) {
  const cm = $('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg-group fade-up';
  div.innerHTML = `<div class="msg-row">
      <div class="msg-av" style="background:rgba(240,98,146,0.15);color:var(--create)"><i class="ti ti-alert-triangle" style="font-size:13px"></i></div>
      <div class="msg-content">
        <div class="msg-meta" style="color:var(--create)">Error</div>
        <div class="msg-bubble" style="background:rgba(240,98,146,0.07);border:1px solid rgba(240,98,146,0.3);color:var(--text)">${escHtml(
          message
        )}</div>
        <div class="msg-actions" style="opacity:1">
          <button class="msg-act-btn" onclick="retryLast(${conv && conv.messages.length ? conv.messages.length - 1 : -1})"><i class="ti ti-refresh"></i> Retry</button>
          <button class="msg-act-btn" onclick="showView('settings')"><i class="ti ti-settings"></i> Settings</button>
        </div>
      </div>
    </div>`;
  cm.appendChild(div);
  scrollDown();
  toast(message, 'error');
}

function retryLast() {
  const conv = activeConv();
  if (!conv || appState.isTyping) return;
  // Remove trailing error bubbles, then re-run from the last real message.
  const cm = $('chatMessages');
  Array.from(cm.querySelectorAll('.msg-group')).forEach((el) => {
    if (el.querySelector('[onclick*="retryLast"]')) el.remove();
  });
  if (!conv.messages.some((m) => m.role === 'user')) return;
  requestReply(conv);
}

function regenerate(idx) {
  const conv = activeConv();
  if (!conv || appState.isTyping) return;
  const target = Number(idx);
  if (Number.isNaN(target) || !conv.messages[target] || conv.messages[target].role !== 'assistant') return;
  conv.messages.splice(target, 1);
  renderConversation();
  requestReply(conv);
}

function newChat() {
  if (appState.isTyping) stopGeneration();
  appState.activeId = null;
  renderConversation();
  renderConversationList();
  showView('chat');
  renderChips();
  const input = $('chatInput');
  input.value = '';
  input.style.height = 'auto';
  closeMobileSidebar();
  persist();
  input.focus();
}

/* ------------------------------------------------------------------
   13. MESSAGE ACTIONS (copy / speak / regenerate / code)
------------------------------------------------------------------ */

async function copyToClipboard(text, okMsg = 'Copied!') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg, 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(okMsg, 'success');
    } catch {
      toast('Copy failed', 'error');
    }
    ta.remove();
  }
}

function speakText(text) {
  if (!window.speechSynthesis) {
    toast('Text-to-speech not supported', 'error');
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.98;
  utter.pitch = 1.05;
  window.speechSynthesis.speak(utter);
  toast('Speaking…');
}

function handleBubbleClick(e) {
  const codeBtn = e.target.closest('.code-copy');
  if (codeBtn) {
    const code = getCodeBlock(codeBtn.dataset.cb);
    if (code !== undefined) copyToClipboard(code, 'Code copied');
    return;
  }
  const action = e.target.closest('[data-act]');
  if (!action) return;
  const conv = activeConv();
  if (!conv) return;
  const idx = Number(action.dataset.idx);
  const msg = conv.messages[idx];
  if (!msg) return;

  if (action.dataset.act === 'copy') copyToClipboard(msg.content);
  else if (action.dataset.act === 'speak') speakText(msg.content);
  else if (action.dataset.act === 'regen') regenerate(idx);
}

/* ------------------------------------------------------------------
   14. STATS + DASHBOARD
------------------------------------------------------------------ */

function bumpActivity() {
  const key = dayKey();
  appState.activity[key] = (appState.activity[key] || 0) + 1;
}

function computeStreak() {
  let streak = 0;
  const cursor = new Date();
  if (!appState.activity[dayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (appState.activity[dayKey(cursor)]) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderDashboard() {
  const total = appState.totalMsgs;
  const counts = Object.entries(appState.modeCount).sort((a, b) => b[1] - a[1]);
  const fav = counts[0];
  const favLabel = fav && fav[1] > 0 ? modes[fav[0]]?.label : '—';
  const avgMs = appState.msCount ? Math.round(appState.sumMs / appState.msCount) : 0;

  $('statGrid').innerHTML = [
    { icon: 'ti-message-2', color: 'var(--accent2)', val: total, label: 'Total messages' },
    { icon: 'ti-messages', color: 'var(--news)', val: appState.conversations.length, label: 'Conversations' },
    { icon: 'ti-flame', color: 'var(--execute)', val: computeStreak(), label: 'Day streak' },
    { icon: 'ti-star', color: 'var(--create)', val: favLabel, label: 'Favourite mode' },
    { icon: 'ti-clock', color: 'var(--research)', val: avgMs ? (avgMs / 1000).toFixed(1) + 's' : '—', label: 'Avg response' },
    { icon: 'ti-brain', color: 'var(--think)', val: Object.values(appState.modeCount).reduce((a, b) => a + b, 0), label: 'AI queries' }
  ]
    .map(
      (s) => `<div class="stat-card">
      <div class="stat-icon" style="color:${s.color}"><i class="ti ${s.icon}"></i></div>
      <div class="stat-val">${s.val}</div>
      <div class="stat-label">${s.label}</div>
    </div>`
    )
    .join('');

  // Real 7-day activity (no synthetic data)
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: dayKey(d), label: d.toLocaleDateString([], { weekday: 'short' }) });
  }
  const vals = days.map((d) => appState.activity[d.key] || 0);
  const max = Math.max(...vals, 1);
  const barColors = ['#3ecfb2', '#7b68ee', '#f06292', '#ffa552', '#52b8ff', '#a89cf7', '#7b68ee'];
  $('activityChart').innerHTML = days
    .map(
      (d, i) => `<div class="bar-wrap">
        <div class="bar" style="height:${Math.max(3, Math.round((vals[i] / max) * 100))}%;background:${barColors[i]};opacity:${
        vals[i] ? (i === 6 ? 1 : 0.7) : 0.25
      }" title="${d.label}: ${vals[i]} messages"></div>
        <div class="bar-label">${d.label.slice(0, 1)}</div>
      </div>`
    )
    .join('');

  const modeList = [
    { k: 'think', label: 'Think', color: 'var(--think)', icon: 'ti-bulb' },
    { k: 'research', label: 'Research', color: 'var(--research)', icon: 'ti-search' },
    { k: 'create', label: 'Create', color: 'var(--create)', icon: 'ti-pencil' },
    { k: 'execute', label: 'Execute', color: 'var(--execute)', icon: 'ti-rocket' }
  ];
  const mTotal = Object.values(appState.modeCount).reduce((a, b) => a + b, 0) || 1;
  $('modeGrid').innerHTML = modeList
    .map((m) => {
      const pct = Math.round(((appState.modeCount[m.k] || 0) / mTotal) * 100);
      return `<div class="mode-stat">
      <div class="mode-stat-icon" style="color:${m.color}"><i class="ti ${m.icon}"></i></div>
      <div class="mode-stat-info">
        <div class="mode-stat-name">${m.label}</div>
        <div class="mode-stat-bar-wrap"><div class="mode-stat-bar" style="width:${pct}%;background:${m.color}"></div></div>
      </div>
      <div class="mode-stat-count">${pct}%</div>
    </div>`;
    })
    .join('');

  $('recentList').innerHTML =
    appState.conversations
      .slice(0, 8)
      .map((c) => {
        const color = modes[c.mode]?.color || 'var(--text3)';
        return `<div class="recent-item" style="cursor:pointer" onclick="openConversation('${c.id}')" role="button" tabindex="0">
      <div class="recent-mode-dot" style="background:${color}"></div>
      <div class="recent-text">${escHtml(c.title || 'Untitled chat')}</div>
      <div class="recent-time">${timeLabel(c.updatedAt)}</div>
    </div>`;
      })
      .join('') || '<div style="font-size:13px;color:var(--text3);padding:12px">No recent activity yet — start a conversation.</div>';
}

/* ------------------------------------------------------------------
   15. WORLD FEED (news)
------------------------------------------------------------------ */

async function loadNews() {
  $('newsGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text3)">
    <i class="ti ti-satellite" style="font-size:32px;display:block;margin-bottom:10px"></i>Fetching world feed…</div>`;
  try {
    const res = await fetch('/api/news', {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify({ provider: apiConfig.provider, model: apiConfig.models[apiConfig.provider] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API server returned error ' + res.status);
    appState.newsItems = data.news || [];
    renderNews();
    if (String(data.source || '').startsWith('fallback')) {
      toast('Showing fallback feed — add an API key for a live feed', 'info');
    } else {
      toast('Feed updated', 'success');
    }
  } catch (e) {
    $('newsGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text3)">
      <i class="ti ti-wifi-off" style="font-size:28px;display:block;margin-bottom:10px"></i>
      Could not load the feed. <button class="ghost-btn" style="margin-top:12px" onclick="loadNews()"><i class="ti ti-refresh"></i> Retry</button>
    </div>`;
  }
}

function filterNews(cat, btn) {
  appState.newsFilter = cat;
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderNews();
}

function renderNews() {
  const items =
    appState.newsFilter === 'all'
      ? appState.newsItems
      : appState.newsItems.filter((n) => n.category === appState.newsFilter);
  if (!items.length) {
    $('newsGrid').innerHTML = '<div style="grid-column:1/-1;color:var(--text3);padding:40px;text-align:center">No items in this category</div>';
    return;
  }
  const catColor = { Tech: 'var(--news)', World: 'var(--research)', Science: 'var(--accent)', Business: 'var(--execute)' };
  const urgIcon = { high: '🔴', medium: '🟡', low: '🔵' };
  const urgLabel = { high: 'Breaking', medium: 'Developing', low: 'Update' };
  $('newsGrid').innerHTML = items
    .map(
      (item) => `
    <div class="news-card fade-up" onclick="deepDive(this.dataset.title)" data-title="${escHtml(item.title)}" role="button" tabindex="0">
      <div class="nc-stripe" style="background:${catColor[item.category] || 'var(--accent)'}"></div>
      <div class="nc-cat-label" style="color:${catColor[item.category] || 'var(--accent)'}">${escHtml(item.category)}</div>
      <div class="nc-title">${escHtml(item.title)}</div>
      <div class="nc-summary">${escHtml(item.summary)}</div>
      <div class="nc-footer">
        <span class="nc-urgency">${urgIcon[item.urgency] || '🔵'} ${urgLabel[item.urgency] || 'Update'}</span>
        <span class="nc-read-more">Deep dive <i class="ti ti-arrow-right" style="font-size:11px"></i></span>
      </div>
    </div>`
    )
    .join('');
}

function deepDive(title) {
  switchMode('research');
  $('chatInput').value = `Tell me more about: ${title}`;
  onInputChange($('chatInput'));
  showView('chat');
  sendMessage();
}

/* ------------------------------------------------------------------
   16. API SETTINGS UI
------------------------------------------------------------------ */

function onProviderChange(provider) {
  // The dropdown is the user's intent — write it through immediately so the
  // payload object can never disagree with what Settings shows on screen.
  apiConfig.provider = provider;
  localStorage.setItem('aria_api_provider', provider);
  populateModels(provider);
  syncApiKeyField(provider);
  // Refresh the picker from the provider's live catalog for this key.
  fetchLiveModelsFor(provider);
}

/**
 * Keyless providers (local Ollama) must not look like they're waiting for a
 * key — otherwise "Test connection" gets blocked by a field that is optional.
 */
function syncApiKeyField(provider) {
  const input = $('settingApiKey');
  if (!input) return;
  const keyless = KEYLESS_PROVIDERS.has(provider);
  input.value = apiConfig.keys[provider] || '';
  input.placeholder = keyless ? 'No API key required (local server)' : 'Enter API Key here...';
  const desc = $('apiKeyDesc');
  if (desc) {
    desc.textContent = keyless
      ? 'Runs on your own machine — nothing is sent to any cloud provider'
      : 'Stored only in this browser and sent straight to the proxy';
  }
}

/**
 * The model <select> had no change handler, so picking a model updated the UI
 * but not apiConfig — "Test connection" (reads the DOM) passed while Send
 * (reads apiConfig) still shipped the retired id and 404'd. Write through.
 */
function onModelChange(model) {
  const provider = $('settingProvider').value || apiConfig.provider;
  apiConfig.models[provider] = model;
  localStorage.setItem(`aria_api_model_${provider}`, model);
}

function populateModels(provider) {
  const select = $('settingModel');
  if (!select) return;
  const remote = remoteModels?.find((p) => p.id === provider);
  const list = remote?.models?.length ? remote.models : providerModels[provider] || [];
  select.innerHTML = list.map((m) => `<option value="${escHtml(m.value)}">${escHtml(m.label)}</option>`).join('');
  const desired = apiConfig.models[provider];
  const chosen = list.some((m) => m.value === desired) ? desired : list[0]?.value || '';
  select.value = chosen;
  // The <select> and apiConfig must never disagree — otherwise the UI shows a
  // valid model while the request still carries the retired one.
  if (chosen && chosen !== desired) {
    apiConfig.models[provider] = chosen;
    localStorage.setItem(`aria_api_model_${provider}`, chosen);
  }
}

/**
 * The key field writes straight through to apiConfig as the user types.
 * Pasting a key and hitting Send now works without pressing "Save" first —
 * which was the most common way to end up with a working key that never applied.
 */
function onApiKeyInput(value) {
  const provider = $('settingProvider').value;
  apiConfig.keys[provider] = String(value).trim();
  localStorage.setItem(`aria_api_key_${provider}`, String(value).trim());
}

function toggleApiKeyVisibility() {
  const input = $('settingApiKey');
  const icon = $('toggleKeyBtn').querySelector('i');
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  icon.className = reveal ? 'ti ti-eye-off' : 'ti ti-eye';
}

/**
 * Read the Settings form into apiConfig. Single source of truth: every path
 * that talks to the provider (Save, Test connection, Send) goes through here,
 * so the dropdown, the stored config and the wire payload can never disagree.
 */
function syncApiConfigFromForm() {
  const provider = $('settingProvider').value || apiConfig.provider;
  const key = $('settingApiKey').value.trim();
  const model = $('settingModel').value;

  apiConfig.provider = provider;
  apiConfig.keys[provider] = key;
  if (model) apiConfig.models[provider] = model;

  localStorage.setItem('aria_api_provider', provider);
  localStorage.setItem(`aria_api_key_${provider}`, key);
  if (model) localStorage.setItem(`aria_api_model_${provider}`, model);

  return { provider, key, model };
}

function saveApiConfig() {
  syncApiConfigFromForm();
  toast('API settings saved', 'success');
  // Re-query /api/health so the "Server" badge reflects the new configuration.
  fetchServerInfo();
}

async function testConnection(btn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Testing…';
  const started = performance.now();
  try {
    // Sync the form into apiConfig first, then test *that*. Test connection and
    // Send must read the same source — otherwise the test can pass while the
    // very next message 404s on a stale model id.
    syncApiConfigFromForm();
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify({
        provider: apiConfig.provider,
        model: apiConfig.models[apiConfig.provider],
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        maxTokens: 16,
        temperature: 0
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    toast(`Connected in ${Math.round(performance.now() - started)}ms`, 'success');
  } catch (e) {
    toast(e.message || 'Connection failed', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

function loadApiConfig() {
  $('settingProvider').value = apiConfig.provider;
  onProviderChange(apiConfig.provider);
}

async function fetchServerInfo() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.ok) {
      const badge = $('aboutServer');
      if (badge) badge.textContent = `Server: online · v${data.version} · uptime ${Math.round(data.uptime / 60)}m`;
      const version = $('aboutVersion');
      if (version) version.textContent = `v${data.version}`;
      setConnection(true);
      return data;
    }
    throw new Error('bad payload');
  } catch {
    setConnection(false);
    return null;
  }
}

async function fetchModels() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (data.ok && Array.isArray(data.providers)) {
      remoteModels = data.providers;
      populateModels(apiConfig.provider);
    }
  } catch {
    /* offline → local catalog */
  }
  // Then upgrade the active provider with the live catalog for this key.
  fetchLiveModelsFor(apiConfig.provider);
}

/**
 * Ask the server which models *this* key can actually use, and swap them into
 * the dropdown. Providers retire model ids without notice — this keeps the
 * picker honest instead of offering ids that 404. Silently degrades to the
 * static catalog if the key is missing or the provider is unreachable.
 */
async function fetchLiveModelsFor(provider) {
  if (!provider) return;
  const key = apiConfig.keys[provider];
  try {
    const headers = {};
    if (key) headers['x-api-key'] = key;
    const res = await fetch(`/api/models/live?provider=${encodeURIComponent(provider)}`, { headers });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.models) || !data.models.length) return;

    // Local inference: say so out loud when the server isn't running, instead
    // of letting the user discover it later as a confusing chat failure.
    if (provider === 'local' && data.source === 'static' && data.reachable === false) {
      toast('Ollama is not running — start it with "ollama serve", then reselect Local.', 'error');
      return;
    }

    if (!remoteModels) remoteModels = [];
    const entry = remoteModels.find((p) => p.id === provider);
    if (entry) entry.models = data.models;
    else remoteModels.push({ id: provider, models: data.models });

    // Only repaint the <select> if this provider is the one on screen.
    if ($('settingProvider')?.value === provider) populateModels(provider);
  } catch {
    /* static catalog stays */
  }
}

/* ------------------------------------------------------------------
   17. VOICE + TTS
------------------------------------------------------------------ */

function toggleVoice() {
  const btn = $('voiceBtn');
  const inpBtn = $('micBtn');
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    toast('Voice input is not supported in this browser', 'error');
    return;
  }
  if (appState.isRecording) {
    appState.recognition?.stop();
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SR();
  appState.recognition = recognition;
  recognition.lang = navigator.language || 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((r) => r[0].transcript)
      .join('');
    $('chatInput').value = transcript;
    onInputChange($('chatInput'));
    if (event.results[event.results.length - 1].isFinal) {
      stopRecording();
      sendMessage();
    }
  };
  recognition.onerror = (e) => {
    stopRecording();
    toast(e.error === 'not-allowed' ? 'Microphone permission denied' : 'Voice input error', 'error');
  };
  recognition.onend = () => stopRecording();
  recognition.start();
  appState.isRecording = true;
  btn.classList.add('recording');
  inpBtn?.classList.add('recording');
  btn.innerHTML = '<i class="ti ti-microphone-off"></i>';
  toast('Listening… speak now');
}

function stopRecording() {
  appState.isRecording = false;
  const btn = $('voiceBtn');
  const inpBtn = $('micBtn');
  btn?.classList.remove('recording');
  inpBtn?.classList.remove('recording');
  if (btn) btn.innerHTML = '<i class="ti ti-microphone"></i>';
}

/* ------------------------------------------------------------------
   18. THEMES
------------------------------------------------------------------ */

const themes = {
  dark: {
    '--bg': '#08080e', '--bg2': '#0f0f18', '--bg3': '#14141f', '--bg4': '#1a1a28',
    '--border': 'rgba(255,255,255,0.06)', '--border2': 'rgba(255,255,255,0.10)', '--border3': 'rgba(255,255,255,0.16)',
    '--text': '#ede9ff', '--text2': '#8b88a8', '--text3': '#4e4c66',
    '--glow': 'rgba(123,104,238,0.12)', '--glow2': 'rgba(123,104,238,0.22)'
  },
  light: {
    '--bg': '#f5f4ff', '--bg2': '#ffffff', '--bg3': '#eeedf8', '--bg4': '#e5e4f5',
    '--border': 'rgba(0,0,0,0.07)', '--border2': 'rgba(0,0,0,0.11)', '--border3': 'rgba(0,0,0,0.18)',
    '--text': '#1a1830', '--text2': '#5a587a', '--text3': '#9896b5',
    '--glow': 'rgba(123,104,238,0.08)', '--glow2': 'rgba(123,104,238,0.15)'
  },
  purple: {
    '--bg': '#0d0820', '--bg2': '#130c2c', '--bg3': '#1a1138', '--bg4': '#221744',
    '--border': 'rgba(200,180,255,0.08)', '--border2': 'rgba(200,180,255,0.13)', '--border3': 'rgba(200,180,255,0.2)',
    '--text': '#f0ecff', '--text2': '#a898d8', '--text3': '#6658a8',
    '--glow': 'rgba(140,110,255,0.15)', '--glow2': 'rgba(140,110,255,0.28)'
  }
};

function setTheme(theme) {
  const vars = themes[theme] || themes.dark;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  document.querySelectorAll('.theme-opt').forEach((o) => o.classList.remove('active'));
  $('th' + theme.charAt(0).toUpperCase() + theme.slice(1))?.classList.add('active');
  const icons = { dark: 'ti-moon', light: 'ti-sun', purple: 'ti-sparkles' };
  const themeBtn = $('themeBtn');
  if (themeBtn) themeBtn.innerHTML = `<i class="ti ${icons[theme] || 'ti-moon'}"></i>`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', vars['--bg']);
  appState.settings.theme = theme;
  persistDebounced();
}

function cycleTheme() {
  const order = ['dark', 'light', 'purple'];
  const cur = appState.settings.theme || 'dark';
  setTheme(order[(order.indexOf(cur) + 1) % order.length]);
}

/* ------------------------------------------------------------------
   19. SETTINGS
------------------------------------------------------------------ */

function toggleSetting(key, el) {
  el.classList.toggle('on');
  appState.settings[key] = el.classList.contains('on');
  persist();
}

function setDefaultMode(value) {
  appState.settings.defaultMode = value;
  persist();
}

function onTemperature(value) {
  const v = Number(value);
  appState.settings.temperature = v;
  $('tempVal').textContent = v.toFixed(1);
  persistDebounced();
}

function setMaxTokens(value) {
  appState.settings.maxTokens = parseInt(value, 10) || 2048;
  persist();
}

function saveInstructions() {
  appState.settings.customInstructions = ($('settingInstructions')?.value || '').slice(0, 4000);
  persist();
  toast('Instructions saved', 'success');
}

function saveProfile() {
  appState.settings.userName = $('settingName').value.trim() || 'User';
  appState.settings.userTitle = $('settingTitle').value.trim() || '';
  updateProfile();
  toast('Profile saved', 'success');
  persist();
}

function updateProfile() {
  const name = appState.settings.userName || 'User';
  const av = $('profileAv');
  const nameEl = $('profileName');
  const sub = document.querySelector('.profile-sub');
  if (av) av.textContent = name[0].toUpperCase();
  if (nameEl) nameEl.textContent = name;
  if (sub) sub.textContent = appState.settings.userTitle || 'ARIA Pro';
}

function syncSettingsUI() {
  const s = appState.settings;
  $('settingName').value = s.userName || 'User';
  $('settingTitle').value = s.userTitle || '';
  $('settingInstructions').value = s.customInstructions || '';
  $('tempRange').value = s.temperature ?? 0.7;
  $('tempVal').textContent = Number(s.temperature ?? 0.7).toFixed(1);
  $('maxTokensSetting').value = String(s.maxTokens || 2048);
  $('fontSizeSetting').value = String(s.fontSize || 14);
  $('defaultMode').value = s.defaultMode || 'think';

  const toggles = {
    enterToSend: 'toggleEnter',
    soundEnabled: 'toggleSound',
    autoScroll: 'toggleScroll',
    showTimestamp: 'toggleTimestamp',
    streaming: 'toggleStream'
  };
  Object.entries(toggles).forEach(([key, id]) => {
    const el = $(id);
    if (el) el.classList.toggle('on', Boolean(s[key]));
  });
  loadApiConfig();
}

/* ------------------------------------------------------------------
   20. EXPORT / IMPORT
------------------------------------------------------------------ */

function openExportModal() {
  const conv = activeConv();
  if (!conv || !conv.messages.length) {
    toast('No messages to export yet', 'error');
    return;
  }
  $('exportModal').classList.remove('hidden');
}
function closeExportModal() {
  $('exportModal').classList.add('hidden');
}

function downloadFile(content, filename, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportChat(format) {
  const conv = activeConv();
  if (!conv || !conv.messages.length) return;
  const msgs = conv.messages;
  const stamp = new Date().toISOString().slice(0, 10);
  let content = '';
  let filename = `aria-chat-${stamp}`;

  if (format === 'txt') {
    content = msgs.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
    filename += '.txt';
  } else if (format === 'json') {
    content = JSON.stringify({ exported: new Date().toISOString(), title: conv.title, mode: conv.mode, messages: msgs }, null, 2);
    filename += '.json';
  } else {
    content =
      `# ${conv.title || 'ARIA Chat'}\n_Mode: ${modes[conv.mode]?.label || 'Think'} · ${new Date().toLocaleString()}_\n\n---\n\n` +
      msgs.map((m) => `**${m.role === 'user' ? 'You' : 'ARIA'}:**\n\n${m.content}`).join('\n\n---\n\n');
    filename += '.md';
  }
  downloadFile(content, filename);
  closeExportModal();
  toast('Chat exported', 'success');
}

function exportAllData() {
  const data = {
    exported: new Date().toISOString(),
    app: 'aria',
    version: 2,
    stats: {
      totalMsgs: appState.totalMsgs,
      sessions: appState.sessions,
      modeCount: appState.modeCount,
      activity: appState.activity
    },
    settings: appState.settings,
    conversations: appState.conversations
  };
  downloadFile(JSON.stringify(data, null, 2), `aria-data-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  toast('Data exported', 'success');
}

function importData() {
  $('importInput').click();
}

function handleImportFile(files) {
  const file = files && files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.app !== 'aria' || !Array.isArray(data.conversations)) throw new Error('Not an ARIA export file');
      if (!confirm(`Import ${data.conversations.length} conversation(s)? They will be added to your current history.`)) return;
      appState.conversations = [...data.conversations, ...appState.conversations].slice(0, MAX_CONVERSATIONS);
      if (data.stats) {
        appState.totalMsgs = Math.max(appState.totalMsgs, data.stats.totalMsgs || 0);
        appState.modeCount = { ...appState.modeCount, ...(data.stats.modeCount || {}) };
        appState.activity = { ...data.stats.activity, ...appState.activity };
      }
      renderConversationList();
      persist();
      toast('Data imported', 'success');
    } catch (e) {
      toast(e.message || 'Import failed', 'error');
    } finally {
      $('importInput').value = '';
    }
  };
  reader.readAsText(file);
}

function resetAllStats() {
  if (!confirm('Reset stats (messages, streak, activity)? Conversations are kept.')) return;
  appState.totalMsgs = 0;
  appState.sessions = 1;
  appState.modeCount = { think: 0, research: 0, create: 0, execute: 0 };
  appState.activity = {};
  appState.sumMs = 0;
  appState.msCount = 0;
  persist();
  renderDashboard();
  toast('Stats reset');
}

/* ------------------------------------------------------------------
   21. SHORTCUTS / CONNECTION / SCROLL
------------------------------------------------------------------ */

function openShortcuts() {
  $('shortcutsModal').classList.remove('hidden');
}
function closeShortcuts() {
  $('shortcutsModal').classList.add('hidden');
}

function setConnection(online) {
  const pill = $('connPill');
  const label = $('connLabel');
  if (!pill) return;
  pill.classList.toggle('offline', !online);
  if (label) label.textContent = online ? 'Online' : 'Offline';
}

function onScrollChat() {
  refreshScrollButton();
}

function registerShortcuts() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      newChat();
    } else if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleSidebar();
    } else if (mod && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      cycleTheme();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      showView('chat');
      $('chatInput').focus();
    } else if (mod && e.key === '/') {
      e.preventDefault();
      $('shortcutsModal').classList.contains('hidden') ? openShortcuts() : closeShortcuts();
    } else if (e.key === 'Escape') {
      if (appState.isTyping) stopGeneration();
      closeExportModal();
      closeShortcuts();
      closeMobileSidebar();
    } else if (e.key === '?' && !inField) {
      openShortcuts();
    }
  });
}

/* ------------------------------------------------------------------
   22. INIT
------------------------------------------------------------------ */

function init() {
  // Opening index.html straight from disk (file://) makes every /api call fail
  // silently — the most common "it doesn't work" report. Say so instead.
  if (location.protocol === 'file:') {
    document.body.innerHTML = `<div style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:32px;
      border:1px solid #e4e4ef;border-radius:14px;line-height:1.65;color:#222">
      <h2 style="margin-top:0">Start the app with npm</h2>
      <p>ARIA can't run by opening this file directly — it needs its local API server.</p>
      <pre style="background:#f4f4fa;padding:14px;border-radius:9px;overflow:auto">npm install
npm run build
npm start</pre>
      <p>Then open <strong>http://localhost:3000</strong>.</p>
      <p style="color:#666;font-size:14px">For development use <code>npm run dev</code> (port 5173).</p>
    </div>`;
    return;
  }

  migrateRetiredModels();
  loadState();

  // Structure
  renderChips();
  renderConversationList();
  renderConversation();

  // Appearance + preferences
  setTheme(appState.settings.theme || 'dark');
  applyFontSize(appState.settings.fontSize || 14);
  updateProfile();
  syncSettingsUI();

  const defaultMode = appState.settings.defaultMode || 'think';
  if (defaultMode !== 'think') switchMode(defaultMode, { keepView: true });

  // Delegated message actions (copy / speak / regenerate / code copy)
  $('chatMessages').addEventListener('click', handleBubbleClick);
  $('chatMessages').addEventListener('scroll', onScrollChat, { passive: true });

  // Conversation list: open / delete / rename
  $('historyList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      deleteConversation(del.dataset.del);
      return;
    }
    const item = e.target.closest('[data-conv]');
    if (item) openConversation(item.dataset.conv);
  });
  $('historyList').addEventListener('dblclick', (e) => {
    const item = e.target.closest('[data-conv]');
    if (item) renameConversation(item.dataset.conv);
  });

  registerShortcuts();

  // Connectivity
  window.addEventListener('online', () => {
    setConnection(true);
    toast('Back online', 'success');
    fetchServerInfo();
  });
  window.addEventListener('offline', () => {
    setConnection(false);
    toast('You are offline — messages will fail until you reconnect', 'error');
  });

  // Flush state before the tab closes
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });

  // Server metadata (health + provider/model catalog)
  fetchServerInfo();
  fetchModels();

  // PWA service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => console.log('[Service Worker] registered:', reg.scope))
        .catch((err) => console.warn('[Service Worker] registration failed:', err));
    });
  }

  // Wire dynamic SVG spinner keyframe (used by the Test connection button)
  const style = document.createElement('style');
  style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(style);

  $('chatInput').focus();
}

/* ------------------------------------------------------------------
   23. EXPOSE FOR INLINE HTML HANDLERS
------------------------------------------------------------------ */
Object.assign(window, {
  toggleSidebar, toggleDrawer, openMobileSidebar, closeMobileSidebar,
  switchMode, showView,
  fillChip, onInputChange, handleInputKey, onSendClick, sendMessage, newChat,
  filterHistory, clearAllHistory, openConversation,
  filterNews, loadNews, deepDive,
  onProviderChange, onModelChange, toggleApiKeyVisibility, onApiKeyInput,
  syncApiConfigFromForm, saveApiConfig, testConnection,
  toggleVoice, speakText,
  setTheme, cycleTheme, toggleSetting, applyFontSize, onTemperature, setMaxTokens,
  saveProfile, saveInstructions, setDefaultMode,
  openExportModal, closeExportModal, exportChat, exportAllData, importData, handleImportFile, resetAllStats,
  openShortcuts, closeShortcuts, scrollDown,
  pickImage, handleFiles, removeImage,
  retryLast
});

init();
