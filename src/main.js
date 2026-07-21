// Main entry point for the frontend application
// Initializes the app and mounts it to the DOM

/* ============================================================
   ARIA — APPLICATION LOGIC (REFACTORED FOR VITE & BACKEND PROXY)
   ============================================================ */

// ---- INITIAL STATE ----
// Sets up event listeners for the chat interface
const appState = {
  currentMode: 'think',
  currentView: 'chat',
  messages: [],       // current chat
  allHistory: [],     // [{id, mode, label, msgs, time}]
  modeCount: { think:0, research:0, create:0, execute:0 },
  totalMsgs: 0,
  sessions: 1,
  streakDays: 1,
  isTyping: false,
  newsItems: [],
  newsFilter: 'all',
  recognition: null,
  isRecording: false,
  sidebarCollapsed: false,
  settings: {
    enterToSend: true,
    soundEnabled: false,
    autoScroll: true,
    showTimestamp: true,
    theme: 'dark',
    fontSize: 14,
    defaultMode: 'think',
    userName: 'User',
    userTitle: ''
  }
};

// ---- API CONFIG ----
const apiConfig = {
  provider: localStorage.getItem('aria_api_provider') || 'gemini',
  keys: {
    gemini: localStorage.getItem('aria_api_key_gemini') || '',
    openai: localStorage.getItem('aria_api_key_openai') || '',
    anthropic: localStorage.getItem('aria_api_key_anthropic') || ''
  },
  models: {
    gemini: localStorage.getItem('aria_api_model_gemini') || 'gemini-2.5-flash',
    openai: localStorage.getItem('aria_api_model_openai') || 'gpt-4o-mini',
    anthropic: localStorage.getItem('aria_api_model_anthropic') || 'claude-3-5-sonnet-latest'
  }
};

// ---- PROVIDER MODELS CONFIG ----
const providerModels = {
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' }
  ],
  anthropic: [
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' }
  ]
};

// ---- MODE CONFIG ----
const modes = {
  think: {
    label: 'Think', color: 'var(--think)', icon: 'ti-bulb',
    system: `You are ARIA in THINK mode — a world-class strategic thinker and decision coach. Break down the user's problem using first principles, mental models, frameworks (SWOT, 80/20, inversion, etc.), clear pros/cons, and decisive recommendations. Be sharp, structured, practical, and confident. Aim for 150-200 words unless depth is required.`,
    chips: ['Help me decide: quit my job or stay?','Break down my biggest goal','What mental model fits my problem?','How do I build a daily discipline?','Analyse my decision from all angles']
  },
  research: {
    label: 'Research', color: 'var(--research)', icon: 'ti-search',
    system: `You are ARIA in RESEARCH mode — a world-class analyst and knowledge expert. Give structured, accurate, insightful answers with key facts, historical context, nuance, and clear takeaways. Use headers or bullet points when helpful. Cite what you know. Be comprehensive yet concise — 200-250 words unless the topic needs more depth.`,
    chips: ['Explain quantum computing simply','What is happening in AI right now?','How does the global economy actually work?','Explain CRISPR and gene editing','What caused the 2008 financial crisis?']
  },
  create: {
    label: 'Create', color: 'var(--create)', icon: 'ti-pencil',
    system: `You are ARIA in CREATE mode — a brilliant creative director, copywriter, and storyteller. Help the user create compelling, original, memorable content. Whether writing, brainstorming, crafting pitches, or generating ideas — be vivid, punchy, and surprising. Quality over quantity. 150-220 words unless a full draft is needed.`,
    chips: ['Write a powerful personal bio','5 unique startup ideas for 2025','Cold email template that gets replies','Write an opening paragraph for my essay','Give my brand a killer tagline']
  },
  execute: {
    label: 'Execute', color: 'var(--execute)', icon: 'ti-rocket',
    system: `You are ARIA in EXECUTE mode — a master of planning, systems, and execution. Turn the user's goals into clear, prioritised, actionable step-by-step plans with timelines and milestones. No fluff — every line is an action the user can take. Use numbered lists or structured plans. 200-250 words.`,
    chips: ['Plan my week for maximum output','How do I launch a side project in 30 days?','Build a 90-day fitness plan','What\'s the fastest way to learn a skill?','Create a morning routine that actually works']
  }
};

// ---- HELPERS ----
function $(id) { return document.getElementById(id); }
function now() { return new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }
function uid() { return Math.random().toString(36).slice(2,9); }

function toast(msg, type='') {
  const c = $('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  const icon = type==='success' ? 'ti-check' : type==='error' ? 'ti-x' : 'ti-info-circle';
  t.innerHTML = `<i class="ti ${icon}" style="font-size:15px;color:var(--${type==='success'?'research':type==='error'?'create':'accent2'})"></i>${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.style.animation='slideOut 0.25s ease forwards'; setTimeout(()=>t.remove(),250); }, 2800);
}

function playSound() {
  if (!appState.settings.soundEnabled) return;
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.18);
    o.start(); o.stop(ctx.currentTime+0.18);
  } catch(e) {}
}

// ---- STATE PERSISTENCE ----
function loadState() {
  const local = localStorage.getItem('aria_app_state');
  if (local) {
    try {
      const parsed = JSON.parse(local);
      Object.assign(appState, parsed);
      // Clean messages on load to avoid cluttering screen, but keep history
      appState.messages = [];
    } catch (e) {
      console.warn("Failed to load local appState:", e);
    }
  }
}

function saveState() {
  localStorage.setItem('aria_app_state', JSON.stringify({
    allHistory: appState.allHistory.slice(0, 30), // Limit storage size
    modeCount: appState.modeCount,
    totalMsgs: appState.totalMsgs,
    sessions: appState.sessions,
    streakDays: appState.streakDays,
    settings: appState.settings
  }));
}

// ---- SIDEBAR ----
function toggleSidebar() {
  appState.sidebarCollapsed = !appState.sidebarCollapsed;
  $('sidebar').classList.toggle('collapsed', appState.sidebarCollapsed);
}
function openMobileSidebar() {
  $('sidebar').classList.add('mobile-open');
  $('sidebarOverlay').classList.remove('hidden');
}
function closeMobileSidebar() {
  $('sidebar').classList.remove('mobile-open');
  $('sidebarOverlay').classList.add('hidden');
}

// ---- MODE SWITCH ----
function switchMode(mode) {
  appState.currentMode = mode;
  ['think','research','create','execute'].forEach(m => {
    $('nav-'+m)?.classList.remove('active');
  });
  $('nav-'+mode)?.classList.add('active');
  
  // Topbar
  $('topDot').style.background = getComputedStyle(document.documentElement).getPropertyValue(modes[mode].color.replace('var(','').replace(')','').trim()) || modes[mode].color;
  $('topModeLabel').textContent = modes[mode].label;
  $('topDot').setAttribute('style',`background:${modes[mode].color}`);
  
  showView('chat');
  renderChips();
  closeMobileSidebar();
}

// ---- VIEW SWITCH ----
function showView(view) {
  appState.currentView = view;
  const views = ['chatView','dashView','newsView','settingsView'];
  views.forEach(v => $(v).classList.add('hidden'));
  $(view+'View').classList.remove('hidden');
  
  // Nav highlight
  ['think','research','create','execute','news','dash','settings'].forEach(n => $('nav-'+n)?.classList.remove('active'));
  if (view==='chat') {
    $('nav-'+appState.currentMode)?.classList.add('active');
    $('topDot').setAttribute('style',`background:${modes[appState.currentMode].color}`);
    $('topModeLabel').textContent = modes[appState.currentMode].label;
  } else {
    $('nav-'+view)?.classList.add('active');
    const labels = {news:'World Feed',dash:'Dashboard',settings:'Settings'};
    const colors = {news:'var(--news)',dash:'var(--accent)',settings:'var(--accent)'};
    $('topDot').setAttribute('style',`background:${colors[view]||'var(--accent)'}`);
    $('topModeLabel').textContent = labels[view]||'ARIA';
  }
  if (view==='dash') renderDashboard();
  if (view==='news' && appState.newsItems.length===0) loadNews();
  closeMobileSidebar();
}

// ---- CHIPS ----
function renderChips() {
  const chips = modes[appState.currentMode]?.chips || [];
  $('chipsRow').innerHTML = chips.map(c =>
    `<button class="chip" onclick="fillChip(this.textContent)">${c}</button>`
  ).join('');
}
function fillChip(text) {
  $('chatInput').value = text;
  onInputChange($('chatInput'));
  sendMessage();
}

// ---- INPUT ----
function onInputChange(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight,140)+'px';
  const len = el.value.length;
  $('charCount').textContent = len > 100 ? len : '';
}
function handleInputKey(e) {
  if (appState.settings.enterToSend && e.key==='Enter' && !e.shiftKey) {
    e.preventDefault(); sendMessage();
  }
}

// ---- CHAT ----
function showChatMessages() {
  $('welcomeScreen').classList.add('hidden');
  $('chatMessages').classList.remove('hidden');
}
function hideChatMessages() {
  $('welcomeScreen').classList.remove('hidden');
  $('chatMessages').classList.add('hidden');
}

function addUserMsg(text) {
  const cm = $('chatMessages');
  const ts = appState.settings.showTimestamp ? `<span style="margin-left:6px">${now()}</span>` : '';
  const div = document.createElement('div');
  div.className='msg-group fade-up';
  div.innerHTML=`<div class="msg-row user-row">
    <div class="msg-av user"><i class="ti ti-user" style="font-size:13px"></i></div>
    <div class="msg-content">
      <div class="msg-meta" style="justify-content:flex-end">You${ts}</div>
      <div class="msg-bubble user-b">${escHtml(text)}</div>
    </div>
  </div>`;
  cm.appendChild(div);
  scrollDown();
}

function addThinkingMsg() {
  const cm = $('chatMessages');
  const div = document.createElement('div');
  div.className='msg-group fade-up'; div.id='thinking-group';
  div.innerHTML=`<div class="msg-row">
    <div class="msg-av aria">A</div>
    <div class="msg-content">
      <div class="msg-meta">ARIA</div>
      <div class="msg-bubble thinking"><span class="thinking-dots"><span>●</span><span>●</span><span>●</span></span></div>
    </div>
  </div>`;
  cm.appendChild(div);
  scrollDown();
}

function removeThinking() { $('thinking-group')?.remove(); }

function addAriaMsg(text, mode) {
  const cm = $('chatMessages');
  const cfg = modes[mode];
  const ts = appState.settings.showTimestamp ? `<span style="margin-left:6px">${now()}</span>` : '';
  const div = document.createElement('div');
  div.className='msg-group fade-up';
  div.innerHTML=`<div class="msg-row">
    <div class="msg-av aria">A</div>
    <div class="msg-content">
      <div class="msg-meta">
        ARIA <span class="msg-badge" style="background:${cfg.color}18;color:${cfg.color}">${cfg.label}</span>${ts}
      </div>
      <div class="msg-bubble aria-b">${formatMsg(text)}</div>
      <div class="msg-actions">
        <button class="msg-act-btn" onclick="copyText(this)" data-text="${escAttr(text)}"><i class="ti ti-copy"></i> Copy</button>
        <button class="msg-act-btn" onclick="speakText(this)" data-text="${escAttr(text)}"><i class="ti ti-volume"></i> Speak</button>
      </div>
    </div>
  </div>`;
  cm.appendChild(div);
  applyFontSize(appState.settings.fontSize);
  scrollDown();
}

function formatMsg(text) {
  return escHtml(text)
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,'<em>$1</em>')
    .replace(/`(.*?)`/g,'<code style="background:var(--bg4);padding:1px 5px;border-radius:4px;font-size:12px">$1</code>')
    .replace(/\n/g,'<br>');
}
function escHtml(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(t) { return String(t).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function scrollDown() {
  if (!appState.settings.autoScroll) return;
  const cm = $('chatMessages');
  cm.scrollTop = cm.scrollHeight;
}

// ---- NETWORKING WITH SERVER PROXY ----
async function sendMessage() {
  const input = $('chatInput');
  const btn = $('sendBtn');
  const text = input.value.trim();
  if (!text || btn.disabled) return;

  input.value=''; input.style.height='auto'; $('charCount').textContent='';
  btn.disabled=true; appState.isTyping=true;

  const modeUsed = appState.currentMode;
  showChatMessages();
  addUserMsg(text);
  appState.messages.push({role:'user',content:text});
  appState.totalMsgs++; appState.modeCount[modeUsed]=(appState.modeCount[modeUsed]||0)+1;
  addHistoryEntry(text, modeUsed);
  playSound();
  addThinkingMsg();

  try {
    const provider = apiConfig.provider;
    const model = apiConfig.models[provider];
    const key = apiConfig.keys[provider];

    // Configure headers (send key to proxy if loaded locally)
    const headers = {
      'Content-Type': 'application/json'
    };
    if (key) {
      headers['x-api-key'] = key;
    }

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        provider: provider,
        model: model,
        messages: appState.messages.slice(-12),
        system: modes[modeUsed].system
      })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Server error ' + res.status);
    }
    
    const data = await res.json();
    removeThinking();
    const reply = data.reply || 'Sorry, I could not get a response.';
    appState.messages.push({role:'assistant',content:reply});
    appState.totalMsgs++;
    addAriaMsg(reply, modeUsed);
    playSound();
    saveState();
  } catch(e) {
    removeThinking();
    addAriaMsg(`Error: ${e.message}. (Tip: Check Settings to verify your API Key and Provider configurations).`, modeUsed);
  }

  btn.disabled=false; appState.isTyping=false;
  updateSidebarStats();
  input.focus();
}

function newChat() {
  if (appState.messages.length > 0) appState.sessions++;
  appState.messages=[];
  $('chatMessages').innerHTML='';
  hideChatMessages();
  showView('chat');
  renderChips();
  toast('New chat started','success');
  updateSidebarStats();
  saveState();
}

// ---- HISTORY ----
function addHistoryEntry(text, mode) {
  const label = text.length>40 ? text.slice(0,40)+'…' : text;
  appState.allHistory.unshift({id:uid(), mode, label, time:now(), msgs:[...appState.messages]});
  if (appState.allHistory.length>50) appState.allHistory.pop();
  renderHistory();
}

function renderHistory() {
  const el = $('historyList');
  if (!el) return;
  if (appState.allHistory.length===0) {
    el.innerHTML='<div style="font-size:11px;color:var(--text3);padding:6px 8px">No history yet</div>'; return;
  }
  el.innerHTML = appState.allHistory.slice(0,20).map(h => {
    const icon = {think:'ti-bulb',research:'ti-search',create:'ti-pencil',execute:'ti-rocket'}[h.mode]||'ti-message';
    const color = modes[h.mode]?.color || 'var(--text3)';
    return `<div class="hist-item" onclick="loadHistory('${h.id}')">
      <i class="ti ${icon}" style="color:${color}"></i>
      <span class="hist-item-label">${escHtml(h.label)}</span>
    </div>`;
  }).join('');
}

function loadHistory(id) {
  const h = appState.allHistory.find(x=>x.id===id);
  if (!h) return;
  appState.currentMode = h.mode;
  appState.messages = [...h.msgs];
  $('chatMessages').innerHTML='';
  h.msgs.forEach((m) => {
    if (m.role==='user') addUserMsg(m.content);
    else addAriaMsg(m.content, h.mode);
  });
  showChatMessages();
  showView('chat');
  switchMode(h.mode);
  toast('History loaded','success');
}

function clearAllHistory() {
  if (!confirm('Clear all history? This cannot be undone.')) return;
  appState.allHistory=[];
  renderHistory();
  toast('History cleared');
  saveState();
}

// ---- SIDEBAR STATS ----
function updateSidebarStats() {
  const avatarEl = $('profileAv');
  const nameEl = $('profileName');
  if (avatarEl) avatarEl.textContent = (appState.settings.userName||'U')[0].toUpperCase();
  if (nameEl) nameEl.textContent = appState.settings.userName || 'User';
}

// ---- DASHBOARD ----
function renderDashboard() {
  const total = appState.totalMsgs;
  const fav = Object.entries(appState.modeCount).sort((a,b)=>b[1]-a[1])[0];
  const favLabel = fav && fav[1]>0 ? modes[fav[0]]?.label : '—';

  $('statGrid').innerHTML = [
    {icon:'ti-message-2',color:'var(--accent2)',val:total,label:'Total messages'},
    {icon:'ti-refresh',color:'var(--research)',val:appState.sessions,label:'Sessions'},
    {icon:'ti-flame',color:'var(--execute)',val:appState.streakDays,label:'Day streak'},
    {icon:'ti-star',color:'var(--create)',val:favLabel,label:'Favourite mode'},
    {icon:'ti-clock',color:'var(--news)',val:appState.allHistory.length,label:'Conversations'},
    {icon:'ti-brain',color:'var(--think)',val:Object.values(appState.modeCount).reduce((a,b)=>a+b,0),label:'AI queries'},
  ].map(s=>`
    <div class="stat-card">
      <div class="stat-icon" style="color:${s.color}"><i class="ti ${s.icon}"></i></div>
      <div class="stat-val">${s.val}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');

  // Activity bars
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const today=new Date().getDay();
  const reordered=[...days.slice(today),...days.slice(0,today)];
  const vals=reordered.map((_,i)=>i===6?Math.max(total,1):Math.floor(Math.random()*Math.max(total,8)));
  const max=Math.max(...vals,1);
  const barColors=['#3ecfb2','#7b68ee','#f06292','#ffa552','#52b8ff','#a89cf7','#3ecfb2'];
  $('activityChart').innerHTML=reordered.map((d,i)=>`
    <div class="bar-wrap">
      <div class="bar" style="height:${Math.round(vals[i]/max*100)}%;background:${barColors[i]};opacity:${i===6?1:0.45}" title="${d}: ${vals[i]} msgs"></div>
      <div class="bar-label">${d.slice(0,1)}</div>
    </div>`).join('');

  // Mode breakdown
  const modeList=[
    {k:'think',label:'Think',color:'var(--think)',icon:'ti-bulb'},
    {k:'research',label:'Research',color:'var(--research)',icon:'ti-search'},
    {k:'create',label:'Create',color:'var(--create)',icon:'ti-pencil'},
    {k:'execute',label:'Execute',color:'var(--execute)',icon:'ti-rocket'},
  ];
  const mTotal=Object.values(appState.modeCount).reduce((a,b)=>a+b,0)||1;
  $('modeGrid').innerHTML=modeList.map(m=>{
    const pct=Math.round((appState.modeCount[m.k]||0)/mTotal*100);
    return `<div class="mode-stat">
      <div class="mode-stat-icon" style="color:${m.color}"><i class="ti ${m.icon}"></i></div>
      <div class="mode-stat-info">
        <div class="mode-stat-name">${m.label}</div>
        <div class="mode-stat-bar-wrap"><div class="mode-stat-bar" style="width:${pct}%;background:${m.color}"></div></div>
      </div>
      <div class="mode-stat-count">${pct}%</div>
    </div>`;
  }).join('');

  // Recent
  $('recentList').innerHTML = appState.allHistory.slice(0,8).map(h=>{
    const color=modes[h.mode]?.color||'var(--text3)';
    return `<div class="recent-item">
      <div class="recent-mode-dot" style="background:${color}"></div>
      <div class="recent-text">${escHtml(h.label)}</div>
      <div class="recent-time">${h.time}</div>
    </div>`;
  }).join('') || '<div style="font-size:13px;color:var(--text3);padding:12px">No recent activity</div>';
}

// ---- NEWS FEED ----
async function loadNews() {
  $('newsGrid').innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text3)">
    <i class="ti ti-satellite" style="font-size:32px;display:block;margin-bottom:10px"></i>Fetching world feed...</div>`;
  try {
    const provider = apiConfig.provider;
    const model = apiConfig.models[provider];
    const key = apiConfig.keys[provider];

    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['x-api-key'] = key;

    const res = await fetch('/api/news', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ provider, model })
    });

    if (!res.ok) throw new Error('API server returned error ' + res.status);
    const data = await res.json();
    appState.newsItems = data.news || [];
    renderNews();
    if (data.source && data.source.startsWith('fallback')) {
      toast('Displaying fallback feed (Configure API key for live feed)', 'info');
    } else {
      toast(`Feed updated via ${data.source.toUpperCase()}`, 'success');
    }
  } catch(e) {
    $('newsGrid').innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text3)">
      <i class="ti ti-wifi-off" style="font-size:28px;display:block;margin-bottom:10px"></i>
      Could not load feed. <button onclick="loadNews()" style="background:transparent;border:none;color:var(--accent2);cursor:pointer;font-size:13px;text-decoration:underline">Retry</button>
    </div>`;
  }
}

function filterNews(cat, btn) {
  appState.newsFilter=cat;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderNews();
}

function renderNews() {
  const items=appState.newsFilter==='all'?appState.newsItems:appState.newsItems.filter(n=>n.category===appState.newsFilter);
  if (items.length===0) { $('newsGrid').innerHTML='<div style="grid-column:1/-1;color:var(--text3);padding:40px;text-align:center">No items in this category</div>'; return; }
  const catColor={Tech:'var(--news)',World:'var(--research)',Science:'var(--accent)',Business:'var(--execute)'};
  const urgIcon={high:'🔴',medium:'🟡',low:'🔵'};
  const urgLabel={high:'Breaking',medium:'Developing',low:'Update'};
  $('newsGrid').innerHTML=items.map(item=>`
    <div class="news-card fade-up" onclick="deepDive('${escAttr(item.title)}')">
      <div class="nc-stripe" style="background:${catColor[item.category]||'var(--accent)'}"></div>
      <div class="nc-cat-label" style="color:${catColor[item.category]||'var(--accent)'}">${item.category}</div>
      <div class="nc-title">${escHtml(item.title)}</div>
      <div class="nc-summary">${escHtml(item.summary)}</div>
      <div class="nc-footer">
        <span class="nc-urgency">${urgIcon[item.urgency]||'🔵'} ${urgLabel[item.urgency]||'Update'}</span>
        <span class="nc-read-more">Deep dive <i class="ti ti-arrow-right" style="font-size:11px"></i></span>
      </div>
    </div>`).join('');
}

function deepDive(title) {
  switchMode('research');
  $('chatInput').value=`Tell me more about: ${title}`;
  onInputChange($('chatInput'));
  sendMessage();
}

// ---- API CONFIG SAVE & POPULATE ----
function onProviderChange(provider) {
  populateModels(provider);
  // Fill key field if exists in localStorage
  $('settingApiKey').value = apiConfig.keys[provider] || '';
}

function populateModels(provider) {
  const modelSelect = $('settingModel');
  if (!modelSelect) return;
  const list = providerModels[provider] || [];
  modelSelect.innerHTML = list.map(m => 
    `<option value="${m.value}">${m.label}</option>`
  ).join('');

  // Select active model
  modelSelect.value = apiConfig.models[provider] || list[0]?.value || '';
}

function toggleApiKeyVisibility() {
  const input = $('settingApiKey');
  const icon = $('toggleKeyBtn').querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'ti ti-eye-off';
  } else {
    input.type = 'password';
    icon.className = 'ti ti-eye';
  }
}

function saveApiConfig() {
  const provider = $('settingProvider').value;
  const key = $('settingApiKey').value.trim();
  const model = $('settingModel').value;

  apiConfig.provider = provider;
  apiConfig.keys[provider] = key;
  apiConfig.models[provider] = model;

  localStorage.setItem('aria_api_provider', provider);
  localStorage.setItem(`aria_api_key_${provider}`, key);
  localStorage.setItem(`aria_api_model_${provider}`, model);

  toast('API Settings saved successfully!', 'success');
}

function loadApiConfig() {
  $('settingProvider').value = apiConfig.provider;
  onProviderChange(apiConfig.provider);
}

// ---- VOICE ----
function toggleVoice() {
  const btn=$('voiceBtn'); const inpBtn=$('micBtn');
  if (!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)) {
    toast('Voice input not supported in this browser','error'); return;
  }
  if (appState.isRecording) {
    appState.recognition?.stop(); stopRecording(); return;
  }
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  appState.recognition=new SR();
  appState.recognition.lang='en-US'; appState.recognition.continuous=false; appState.recognition.interimResults=true;
  appState.recognition.onresult=e=>{
    const transcript=Array.from(e.results).map(r=>r[0].transcript).join('');
    $('chatInput').value=transcript;
    onInputChange($('chatInput'));
    if (e.results[0].isFinal) { stopRecording(); sendMessage(); }
  };
  appState.recognition.onerror=()=>{ stopRecording(); toast('Voice input error','error'); };
  appState.recognition.onend=()=>stopRecording();
  appState.recognition.start();
  appState.isRecording=true;
  btn.classList.add('recording'); inpBtn?.classList.add('recording');
  btn.innerHTML='<i class="ti ti-microphone-off"></i>';
  toast('Listening... speak now');
}
function stopRecording() {
  appState.isRecording=false;
  const btn=$('voiceBtn'); const inpBtn=$('micBtn');
  btn.classList.remove('recording'); inpBtn?.classList.remove('recording');
  btn.innerHTML='<i class="ti ti-microphone"></i>';
}

// ---- TTS ----
function speakText(btn) {
  const text=btn.getAttribute('data-text');
  if (!text||!window.speechSynthesis) { toast('Text-to-speech not supported','error'); return; }
  window.speechSynthesis.cancel();
  const utt=new SpeechSynthesisUtterance(text);
  utt.rate=0.95; utt.pitch=1.05;
  window.speechSynthesis.speak(utt);
  toast('Speaking...');
}

// ---- COPY ----
function copyText(btn) {
  const text=btn.getAttribute('data-text');
  navigator.clipboard.writeText(text).then(()=>toast('Copied!','success')).catch(()=>toast('Copy failed','error'));
}

// ---- THEME ----
const themes = {
  dark: {
    '--bg':'#08080e','--bg2':'#0f0f18','--bg3':'#14141f','--bg4':'#1a1a28',
    '--border':'rgba(255,255,255,0.06)','--border2':'rgba(255,255,255,0.10)','--border3':'rgba(255,255,255,0.16)',
    '--text':'#ede9ff','--text2':'#8b88a8','--text3':'#4e4c66',
    '--glow':'rgba(123,104,238,0.12)','--glow2':'rgba(123,104,238,0.22)'
  },
  light: {
    '--bg':'#f5f4ff','--bg2':'#ffffff','--bg3':'#eeedf8','--bg4':'#e5e4f5',
    '--border':'rgba(0,0,0,0.07)','--border2':'rgba(0,0,0,0.11)','--border3':'rgba(0,0,0,0.18)',
    '--text':'#1a1830','--text2':'#5a587a','--text3':'#9896b5',
    '--glow':'rgba(123,104,238,0.08)','--glow2':'rgba(123,104,238,0.15)'
  },
  purple: {
    '--bg':'#0d0820','--bg2':'#130c2c','--bg3':'#1a1138','--bg4':'--bg4',
    '--bg4':'#221744',
    '--border':'rgba(200,180,255,0.08)','--border2':'rgba(200,180,255,0.13)','--border3':'rgba(200,180,255,0.2)',
    '--text':'#f0ecff','--text2':'#a898d8','--text3':'#6658a8',
    '--glow':'rgba(140,110,255,0.15)','--glow2':'rgba(140,110,255,0.28)'
  }
};

function setTheme(theme) {
  const vars=themes[theme]||themes.dark;
  const root=document.documentElement;
  Object.entries(vars).forEach(([k,v])=>root.style.setProperty(k,v));
  document.querySelectorAll('.theme-opt').forEach(o=>o.classList.remove('active'));
  $('th'+theme.charAt(0).toUpperCase()+theme.slice(1))?.classList.add('active');
  const themeIcons={dark:'ti-moon',light:'ti-sun',purple:'ti-sparkles'};
  const themeBtn = $('themeBtn');
  if (themeBtn) {
    themeBtn.innerHTML=`<i class="ti ${themeIcons[theme]}"></i>`;
  }
  appState.settings.theme=theme;
  saveState();
}

function cycleTheme() {
  const order=['dark','light','purple'];
  const cur=appState.settings.theme||'dark';
  const next=order[(order.indexOf(cur)+1)%order.length];
  setTheme(next);
}

// ---- SETTINGS ----
function toggleSetting(key, el) {
  el.classList.toggle('on');
  appState.settings[key]=el.classList.contains('on');
  saveState();
}
function applyFontSize(size) {
  document.querySelectorAll('.msg-bubble').forEach(el=>el.style.fontSize=size+'px');
  appState.settings.fontSize=parseInt(size);
  const sizeSelect = $('fontSizeSetting');
  if (sizeSelect) sizeSelect.value = size;
  saveState();
}
function saveProfile() {
  appState.settings.userName=$('settingName').value||'User';
  appState.settings.userTitle=$('settingTitle').value||'';
  updateSidebarStats();
  toast('Profile saved','success');
  saveState();
}

// ---- EXPORT ----
function openExportModal() {
  if (appState.messages.length===0) { toast('No messages to export','error'); return; }
  $('exportModal').classList.remove('hidden');
}
function closeExportModal() { $('exportModal').classList.add('hidden'); }

function exportChat(format) {
  const msgs=appState.messages;
  let content='', filename='aria-chat';
  if (format==='txt') {
    content=msgs.map(m=>`[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
    filename+='.txt';
  } else if (format==='json') {
    content=JSON.stringify({exported:new Date().toISOString(),mode:appState.currentMode,messages:msgs},null,2);
    filename+='.json';
  } else if (format==='md') {
    content=`# ARIA Chat Export\n_Mode: ${modes[appState.currentMode].label} · ${new Date().toLocaleString()}_\n\n---\n\n`
      +msgs.map(m=>`**${m.role==='user'?'You':'ARIA'}:** ${m.content}`).join('\n\n');
    filename+='.md';
  }
  const blob=new Blob([content],{type:'text/plain'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=filename; a.click();
  closeExportModal(); toast('Chat exported','success');
}

function exportAllData() {
  const data={exported:new Date().toISOString(),stats:{totalMsgs:appState.totalMsgs,sessions:appState.sessions,modeCount:appState.modeCount},history:appState.allHistory};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='aria-data.json'; a.click();
  toast('Data exported','success');
}

function resetAllStats() {
  if (!confirm('Reset all stats? Cannot be undone.')) return;
  appState.totalMsgs=0; appState.sessions=1; appState.modeCount={think:0,research:0,create:0,execute:0};
  toast('Stats reset');
  saveState();
  renderDashboard();
}

// ---- INIT ----
function init() {
  loadState();
  loadApiConfig();
  renderChips();
  renderHistory();
  setTheme(appState.settings.theme || 'dark');
  applyFontSize(appState.settings.fontSize || 14);
  updateSidebarStats();

  // Load profile values to input fields
  const nameInput = $('settingName');
  const titleInput = $('settingTitle');
  if (nameInput) nameInput.value = appState.settings.userName || 'User';
  if (titleInput) titleInput.value = appState.settings.userTitle || '';

  // Setup behaviour toggles UI
  const toggles = {
    enterToSend: 'toggleEnter',
    soundEnabled: 'toggleSound',
    autoScroll: 'toggleScroll',
    showTimestamp: 'toggleTimestamp'
  };
  Object.entries(toggles).forEach(([key, id]) => {
    const el = $(id);
    if (el) {
      if (appState.settings[key]) el.classList.add('on');
      else el.classList.remove('on');
    }
  });

  const defaultModeSelect = $('defaultMode');
  if (defaultModeSelect) defaultModeSelect.value = appState.settings.defaultMode || 'think';

  // Apply default mode
  if (appState.settings.defaultMode && appState.settings.defaultMode !== 'think') {
    switchMode(appState.settings.defaultMode);
  }

  // keyboard shortcut: Ctrl+K new chat
  document.addEventListener('keydown',e=>{
    if ((e.ctrlKey||e.metaKey)&&e.key==='k') { e.preventDefault(); newChat(); }
    if (e.key==='Escape') { closeExportModal(); closeMobileSidebar(); }
  });

  // Register Service Worker for PWA mobile installation
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('[Service Worker] Registered successfully:', reg.scope))
        .catch((err) => console.warn('[Service Worker] Registration failed:', err));
    });
  }
}

// ---- EXPOSE TO WINDOW FOR INLINE HTML EVENT HANDLERS ----
window.toggleSidebar = toggleSidebar;
window.openMobileSidebar = openMobileSidebar;
window.closeMobileSidebar = closeMobileSidebar;
window.switchMode = switchMode;
window.showView = showView;
window.fillChip = fillChip;
window.onInputChange = onInputChange;
window.handleInputKey = handleInputKey;
window.sendMessage = sendMessage;
window.newChat = newChat;
window.loadHistory = loadHistory;
window.clearAllHistory = clearAllHistory;
window.filterNews = filterNews;
window.loadNews = loadNews;
window.deepDive = deepDive;
window.onProviderChange = onProviderChange;
window.toggleApiKeyVisibility = toggleApiKeyVisibility;
window.saveApiConfig = saveApiConfig;
window.toggleVoice = toggleVoice;
window.speakText = speakText;
window.copyText = copyText;
window.setTheme = setTheme;
window.cycleTheme = cycleTheme;
window.toggleSetting = toggleSetting;
window.applyFontSize = applyFontSize;
window.saveProfile = saveProfile;
window.openExportModal = openExportModal;
window.closeExportModal = closeExportModal;
window.exportChat = exportChat;
window.exportAllData = exportAllData;
window.resetAllStats = resetAllStats;

// Run initialization
init();
