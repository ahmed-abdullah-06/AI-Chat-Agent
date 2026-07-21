/* ═══════════════════════════════════════
   ARIA — app.js  (FIXED & COMPLETE)
   Direct Anthropic API — no backend needed
   ═══════════════════════════════════════ */

// ── STATE ──
const S = {
  mode: 'think',
  view: 'chat',
  messages: [],
  history: [],
  totalMsgs: 0,
  sessions: 1,
  streak: 1,
  modeCount: { think: 0, research: 0, create: 0, execute: 0 },
  dailyActivity: Array(7).fill(0),
  sidebarCollapsed: false,
  isRecording: false,
  recognition: null,
  newsData: [],
  newsFilter: 'all',
  newsLoaded: false,
  userName: 'ARIA User',
  theme: 'dark',
  styleMode: 'balanced',
  chatStarted: false,
};

// ── MODE CONFIG ──
const MODES = {
  think: {
    label: 'Think', color: 'var(--think)', icon: 'ti-bulb',
    system: () => `You are ARIA in THINK MODE — a world-class strategic thinker and life advisor. Break down the user's problem using first principles, mental models, frameworks, and decisive recommendations. Be sharp, insightful, and practical. ${styleInstructions()}`,
    chips: ['Help me decide something hard', 'Break down my biggest goal', 'How do I improve my habits?', 'Give me a fresh perspective']
  },
  research: {
    label: 'Research', color: 'var(--research)', icon: 'ti-search',
    system: () => `You are ARIA in RESEARCH MODE — a world-class researcher and analyst. Provide well-structured, accurate, insightful answers with key facts, context, and depth. ${styleInstructions()}`,
    chips: ['Explain quantum computing', 'Latest AI breakthroughs', 'What is CRISPR?', 'How does the global economy work?']
  },
  create: {
    label: 'Create', color: 'var(--create)', icon: 'ti-pencil',
    system: () => `You are ARIA in CREATE MODE — a brilliant creative mind: copywriter, storyteller, idea generator, brand strategist. Help the user create compelling, original, memorable content. Be vivid, punchy, imaginative. ${styleInstructions()}`,
    chips: ['Write me a powerful bio', 'Cold email that converts', '5 startup ideas for 2026', 'Tagline for my brand']
  },
  execute: {
    label: 'Execute', color: 'var(--execute)', icon: 'ti-rocket',
    system: () => `You are ARIA in EXECUTE MODE — a master of planning and execution. Turn goals into concrete action plans with steps, timelines, and priorities. Be ruthlessly practical, no fluff. ${styleInstructions()}`,
    chips: ['Plan my week for max output', 'Launch a project in 30 days', '90-day learning roadmap', 'Build a morning routine']
  },
};

function styleInstructions() {
  if (S.styleMode === 'concise')  return 'Keep your response under 120 words. Be direct.';
  if (S.styleMode === 'detailed') return 'Be thorough and detailed, up to 350 words.';
  return 'Keep your response under 200 words. Balance depth with brevity.';
}

// ── INIT ──
window.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  updateChips();
  updateMobileSidebarBtn();
  window.addEventListener('resize', updateMobileSidebarBtn);
  const inp = document.getElementById('chatInp');
  if (inp) inp.addEventListener('input', () => autoResize(inp));
});

// ── STORAGE ──
function loadFromStorage() {
  try {
    const saved = localStorage.getItem('aria_state');
    if (!saved) return;
    const d = JSON.parse(saved);
    if (d.userName)      { S.userName = d.userName; updateProfile(); }
    if (d.theme)         { S.theme = d.theme; applyTheme(d.theme); }
    if (d.styleMode)     { S.styleMode = d.styleMode; const sel = document.getElementById('styleSelect'); if (sel) sel.value = d.styleMode; }
    if (d.modeCount)     S.modeCount = d.modeCount;
    if (d.totalMsgs)     { S.totalMsgs = d.totalMsgs; document.getElementById('statMsgs').textContent = d.totalMsgs; }
    if (d.sessions)      { S.sessions = d.sessions; document.getElementById('statSess').textContent = d.sessions; }
    if (d.history)       { S.history = d.history; renderHistory(); }
    if (d.dailyActivity) S.dailyActivity = d.dailyActivity;
    document.getElementById('themeToggle').checked = S.theme === 'dark';
    const ni = document.getElementById('nameInput');
    if (ni) ni.value = S.userName;
  } catch (e) { console.warn('Storage load:', e); }
}

function saveToStorage() {
  try {
    localStorage.setItem('aria_state', JSON.stringify({
      userName: S.userName, theme: S.theme, styleMode: S.styleMode,
      modeCount: S.modeCount, totalMsgs: S.totalMsgs, sessions: S.sessions,
      history: S.history.slice(0, 20), dailyActivity: S.dailyActivity
    }));
  } catch (e) { console.warn('Storage save:', e); }
}

// ── SIDEBAR ──
function toggleSidebar() {
  S.sidebarCollapsed = !S.sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', S.sidebarCollapsed);
}
function openMobileSidebar() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('mobOverlay').classList.add('open');
}
function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('mobOverlay').classList.remove('open');
}
function updateMobileSidebarBtn() {
  const btn = document.getElementById('mobMenuBtn');
  if (btn) btn.style.display = window.innerWidth <= 700 ? 'flex' : 'none';
}

// ── VIEW SWITCHING ──
function switchView(view, mode) {
  S.view = view;
  if (mode && MODES[mode]) S.mode = mode;
  closeMobileSidebar();

  // show/hide panels
  document.getElementById('chatView').style.display = view === 'chat' ? 'flex'  : 'none';
  document.getElementById('dashView').style.display = view === 'dash' ? 'block' : 'none';
  document.getElementById('newsView').style.display = view === 'news' ? 'block' : 'none';

  // update nav active state
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navId = view === 'dash' ? 'nav-dash' : view === 'news' ? 'nav-news' : 'nav-' + S.mode;
  const navEl = document.getElementById(navId);
  if (navEl) navEl.classList.add('active');

  // update topbar pill
  const cfg = MODES[S.mode];
  document.getElementById('modeText').textContent  = cfg.label;
  document.getElementById('modeColor').style.background = cfg.color;

  if (view === 'chat') { updateChips(); document.getElementById('chatInp').focus(); }
  if (view === 'dash') renderDash();
  if (view === 'news') loadNews(false);
}

// ── CHIPS ──
function updateChips() {
  const wrap = document.getElementById('chipsWrap');
  if (!wrap) return;
  wrap.innerHTML = MODES[S.mode].chips.map(c =>
    `<button class="chip" onclick="fillChip(this.textContent)">${c}</button>`
  ).join('');
}
function fillChip(text) {
  document.getElementById('chatInp').value = text.trim();
  sendMsg();
}

// ── CHAT HELPERS ──
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}
function scrollBottom() {
  const el = document.getElementById('chatMsgs');
  if (el) el.scrollTop = el.scrollHeight;
}
function escHTML(str = '') {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(str = '') {
  return str.replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatReply(text) {
  return escHTML(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:var(--bg3);padding:1px 5px;border-radius:4px;font-size:13px">$1</code>')
    .replace(/\n/g, '<br>');
}

// ── RENDER MESSAGE ──
function addMsg(role, text, mode) {
  const modeUsed = mode || S.mode;
  const msgs = document.getElementById('chatMsgs');
  if (!msgs) return;

  // hide welcome screen on first user message
  if (role === 'user' && !S.chatStarted) {
    S.chatStarted = true;
    document.getElementById('welcome')?.classList.add('hidden');
  }

  const cfg = MODES[modeUsed];
  const div = document.createElement('div');
  div.className = 'msg-wrap' + (role === 'user' ? ' user-wrap' : '');
  const isThinking = text === '__thinking__';
  const initials = S.userName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || 'U';

  if (role === 'user') {
    div.innerHTML = `
      <div class="msg-av user-av">${initials}</div>
      <div class="msg-body">
        <div class="msg-meta" style="justify-content:flex-end">${escHTML(S.userName)}</div>
        <div class="msg-bub user-bub">${escHTML(text)}</div>
        <div class="msg-actions" style="justify-content:flex-end">
          <button class="msg-act-btn" onclick="copyText('${escAttr(text)}')"><i class="ti ti-copy"></i> Copy</button>
        </div>
      </div>`;
  } else {
    const bubClass = isThinking ? 'thinking-bub' : 'aria-bub';
    const bubContent = isThinking
      ? '<span class="think-dot">●</span><span class="think-dot">●</span><span class="think-dot">●</span>'
      : formatReply(text);
    div.innerHTML = `
      <div class="msg-av aria-av">A</div>
      <div class="msg-body">
        <div class="msg-meta">ARIA
          <span class="mbadge" style="background:${cfg.color}22;color:${cfg.color}">${cfg.label}</span>
        </div>
        <div class="msg-bub ${bubClass}">${bubContent}</div>
        ${isThinking ? '' : `
        <div class="msg-actions">
          <button class="msg-act-btn" onclick="copyText('${escAttr(text)}')"><i class="ti ti-copy"></i> Copy</button>
          <button class="msg-act-btn" onclick="speakText('${escAttr(text)}')"><i class="ti ti-volume"></i> Speak</button>
        </div>`}
      </div>`;
    if (isThinking) div.id = 'thinking-row';
  }

  msgs.appendChild(div);
  scrollBottom();
}

// ── SEND MESSAGE — calls Anthropic API directly ──
async function sendMsg() {
  const inp = document.getElementById('chatInp');
  const btn = document.getElementById('sendBtn');
  const text = inp.value.trim();
  if (!text || btn.disabled) return;

  inp.value = ''; inp.style.height = 'auto';
  btn.disabled = true;

  const modeUsed = S.mode;
  addMsg('user', text, modeUsed);
  S.messages.push({ role: 'user', content: text });
  S.totalMsgs++;
  S.dailyActivity[6]++;
  S.modeCount[modeUsed] = (S.modeCount[modeUsed] || 0) + 1;
  document.getElementById('statMsgs').textContent = S.totalMsgs;
  addToHistory(text, modeUsed);
  addMsg('aria', '__thinking__', modeUsed);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: MODES[modeUsed].system(),
        messages: S.messages.slice(-12)
      })
    });

    const data = await res.json();
    document.getElementById('thinking-row')?.remove();
    const reply = data.content?.[0]?.text || 'Something went wrong. Please try again.';
    S.messages.push({ role: 'assistant', content: reply });
    S.totalMsgs++;
    document.getElementById('statMsgs').textContent = S.totalMsgs;
    addMsg('aria', reply, modeUsed);
  } catch (e) {
    document.getElementById('thinking-row')?.remove();
    addMsg('aria', '⚠️ Network error. Please check your connection and try again.', modeUsed);
  }

  btn.disabled = false;
  saveToStorage();
  inp.focus();
}

// ── HISTORY ──
function addToHistory(text, mode) {
  const label = text.length > 32 ? text.slice(0, 32) + '…' : text;
  S.history.unshift({ label, mode, time: Date.now() });
  if (S.history.length > 30) S.history.pop();
  renderHistory();
}
function renderHistory() {
  const el = document.getElementById('sbHistory');
  if (!el) return;
  if (!S.history.length) { el.innerHTML = '<div class="hist-empty">No history yet</div>'; return; }
  const iconMap = { think: 'ti-bulb', research: 'ti-search', create: 'ti-pencil', execute: 'ti-rocket' };
  el.innerHTML = S.history.slice(0, 15).map(h => `
    <div class="hist-item" onclick="recallHistory('${escAttr(h.label)}','${h.mode}')">
      <i class="ti ${iconMap[h.mode] || 'ti-message'}" style="color:${MODES[h.mode]?.color || 'var(--text3)'}"></i>
      <span>${escHTML(h.label)}</span>
    </div>`
  ).join('');
}
function recallHistory(label, mode) {
  switchView('chat', mode);
  document.getElementById('chatInp').value = label.replace(/…$/, '');
  document.getElementById('chatInp').focus();
  closeMobileSidebar();
}

// ── NEW CHAT ──
function newChat() {
  S.messages = [];
  S.sessions++;
  S.chatStarted = false;
  document.getElementById('chatMsgs').innerHTML = '';
  // re-add welcome screen
  const welcome = document.createElement('div');
  welcome.className = 'welcome'; welcome.id = 'welcome';
  welcome.innerHTML = `
    <div class="welcome-mark">A</div>
    <h1>ARIA</h1>
    <p>Adaptive Real-life Intelligence Agent.<br>Think deeper, research faster, create better, execute smarter.</p>
    <div class="welcome-modes">
      <div class="wm-badge" style="color:var(--think);border-color:var(--think)">Think</div>
      <div class="wm-badge" style="color:var(--research);border-color:var(--research)">Research</div>
      <div class="wm-badge" style="color:var(--create);border-color:var(--create)">Create</div>
      <div class="wm-badge" style="color:var(--execute);border-color:var(--execute)">Execute</div>
    </div>`;
  document.getElementById('chatMsgs').appendChild(welcome);
  document.getElementById('statSess').textContent = S.sessions;
  saveToStorage();
  showToast('New chat started');
}

// ── VOICE ──
function toggleVoice() {
  const btn = document.getElementById('voiceBtn');
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('Voice not supported in this browser'); return;
  }
  if (S.isRecording) {
    S.recognition?.stop(); S.isRecording = false;
    if (btn) { btn.classList.remove('recording'); btn.innerHTML = '<i class="ti ti-microphone"></i>'; }
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  S.recognition = new SR();
  S.recognition.lang = 'en-US'; S.recognition.continuous = false; S.recognition.interimResults = false;
  S.recognition.onresult = e => {
    document.getElementById('chatInp').value = e.results[0][0].transcript;
    S.isRecording = false;
    if (btn) { btn.classList.remove('recording'); btn.innerHTML = '<i class="ti ti-microphone"></i>'; }
    sendMsg();
  };
  S.recognition.onerror = () => {
    S.isRecording = false;
    if (btn) { btn.classList.remove('recording'); btn.innerHTML = '<i class="ti ti-microphone"></i>'; }
    showToast('Voice error. Try again.');
  };
  S.recognition.start();
  S.isRecording = true;
  if (btn) { btn.classList.add('recording'); btn.innerHTML = '<i class="ti ti-microphone-off"></i>'; }
}

function speakText(text) {
  if (!window.speechSynthesis) { showToast('TTS not supported'); return; }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.95; utt.pitch = 1;
  window.speechSynthesis.speak(utt);
  showToast('Speaking…');
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'));
}

// ── SETTINGS ──
function openSettings()  {
  document.getElementById('settingsOverlay').classList.add('open');
  document.getElementById('settingsPanel').classList.add('open');
}
function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('open');
  document.getElementById('settingsPanel').classList.remove('open');
}
function toggleTheme() {
  const isDark = document.getElementById('themeToggle').checked;
  S.theme = isDark ? 'dark' : 'light';
  applyTheme(S.theme);
  saveToStorage();
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const t = document.getElementById('themeToggle');
  if (t) t.checked = theme === 'dark';
}
function updateProfile() {
  const name = document.getElementById('nameInput')?.value.trim() || 'ARIA User';
  S.userName = name;
  const pn = document.getElementById('profName'); if (pn) pn.textContent = name;
  const pa = document.getElementById('profAv');
  const initials = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || 'A';
  if (pa) pa.textContent = initials;
  saveToStorage();
}
function clearAll() {
  if (!confirm('Clear all data and history?')) return;
  localStorage.removeItem('aria_state');
  location.reload();
}

// ── EXPORT ──
function exportChat() {
  if (!S.messages.length) { showToast('No messages to export'); return; }
  const lines = S.messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}\n`).join('\n---\n\n');
  const blob = new Blob([`ARIA Chat Export\n${new Date().toLocaleString()}\n\n` + lines], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'ARIA_chat_' + Date.now() + '.txt';
  a.click(); URL.revokeObjectURL(a.href);
  showToast('Chat exported as .txt');
}
function exportJSON() {
  if (!S.messages.length) { showToast('No messages to export'); return; }
  const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), mode: S.mode, messages: S.messages }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'ARIA_chat_' + Date.now() + '.json';
  a.click(); URL.revokeObjectURL(a.href);
  showToast('Exported as JSON');
}

// ── DASHBOARD ──
function renderDash() {
  const favMode  = Object.entries(S.modeCount).sort((a,b) => b[1]-a[1])[0]?.[0] || 'think';
  const favLabel = MODES[favMode]?.label || 'Think';
  const total    = Object.values(S.modeCount).reduce((a,b) => a+b, 0);

  document.getElementById('kpiGrid').innerHTML = [
    { icon: 'ti-message-2', color: 'var(--accent)',   val: S.totalMsgs, lbl: 'Total messages', delta: '+' + S.dailyActivity[6] + ' today' },
    { icon: 'ti-history',   color: 'var(--research)', val: S.sessions,  lbl: 'Sessions',       delta: 'Active' },
    { icon: 'ti-flame',     color: 'var(--execute)',  val: S.streak,    lbl: 'Day streak',     delta: 'Keep going!' },
    { icon: 'ti-brain',     color: 'var(--think)',    val: favLabel,    lbl: 'Favourite mode', delta: total + ' queries total' },
  ].map(k => `
    <div class="kpi-card">
      <div class="kpi-icon" style="color:${k.color}"><i class="ti ${k.icon}"></i></div>
      <div class="kpi-val">${k.val}</div>
      <div class="kpi-lbl">${k.lbl}</div>
      <div class="kpi-delta">${k.delta}</div>
    </div>`).join('');

  const days = ['M','T','W','T','F','S','S'];
  const vals = S.dailyActivity.map((v,i) => i < 6 ? Math.floor(Math.random()*12)+1 : v);
  const maxV = Math.max(...vals, 1);
  const barColors = ['var(--research)','var(--accent)','var(--create)','var(--execute)','var(--news)','var(--think)','var(--accent2)'];
  document.getElementById('actBars').innerHTML = vals.map((v,i) =>
    `<div class="bc-bar" style="height:${Math.round(v/maxV*100)}%;background:${barColors[i]};opacity:${i===6?1:0.55}" title="${days[i]}: ${v} msgs"></div>`
  ).join('');
  document.getElementById('actLabels').innerHTML = days.map(d => `<div class="bc-label">${d}</div>`).join('');

  const mTotal = total || 1;
  document.getElementById('modeBars').innerHTML = Object.entries(MODES).map(([k, m]) => {
    const pct = Math.round((S.modeCount[k] || 0) / mTotal * 100);
    return `<div class="mb-row">
      <div class="mb-lbl">${m.label}</div>
      <div class="mb-track"><div class="mb-fill" style="width:${pct}%;background:${m.color}"></div></div>
      <div class="mb-pct">${pct}%</div>
    </div>`;
  }).join('');
}

// ── WORLD FEED / NEWS ──
async function loadNews(force = false) {
  if (S.newsLoaded && !force && S.newsData.length) { renderNews(); return; }
  const grid = document.getElementById('newsGrid');
  grid.innerHTML = '<div class="news-loading"><i class="ti ti-satellite"></i><span>Fetching world feed…</span></div>';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'Return ONLY a valid JSON array, no markdown, no explanation. Generate 10 realistic, diverse world news items for today (May 2026). Each: {"title":string,"summary":string max 28 words,"category":"Tech"|"World"|"Science"|"Business","urgency":"high"|"medium"|"low"}',
        messages: [{ role: 'user', content: 'World news briefing now.' }]
      })
    });
    const data = await res.json();
    let raw = (data.content?.[0]?.text || '[]').replace(/```json|```/g, '').trim();
    S.newsData = JSON.parse(raw);
    S.newsLoaded = true;
    renderNews();
  } catch (e) {
    grid.innerHTML = '<div class="news-loading" style="color:var(--danger)"><i class="ti ti-wifi-off"></i><span>Could not load feed. Check your connection.</span></div>';
  }
}

function renderNews() {
  const filtered = S.newsFilter === 'all'
    ? S.newsData
    : S.newsData.filter(n => n.category.toLowerCase() === S.newsFilter);
  const catClass = { Tech: 'tech', World: 'world', Science: 'science', Business: 'business' };
  const urgIcon  = { high: '🔴', medium: '🟡', low: '🔵' };
  const grid = document.getElementById('newsGrid');
  if (!grid) return;
  grid.innerHTML = filtered.length
    ? filtered.map(item => `
      <div class="news-card ${catClass[item.category] || 'world'}">
        <div class="nc-cat ${catClass[item.category] || 'world'}">${item.category}</div>
        <div class="nc-title">${escHTML(item.title)}</div>
        <div class="nc-summary">${escHTML(item.summary)}</div>
        <div class="nc-foot">
          <span class="nc-urgency">${urgIcon[item.urgency]||'🔵'} ${item.urgency==='high'?'Breaking':item.urgency==='medium'?'Developing':'Update'}</span>
          <button class="nc-dive" onclick="deepDive('${escAttr(item.title)}')">Deep dive ↗</button>
        </div>
      </div>`).join('')
    : '<div class="news-loading">No items in this category.</div>';
}

function filterNews(cat, btn) {
  S.newsFilter = cat;
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.toggle('active', b === btn));
  renderNews();
}

function deepDive(title) {
  switchView('chat', 'research');
  document.getElementById('chatInp').value = `Tell me more about: ${title}`;
  sendMsg();
}

// ── TOAST ──
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}