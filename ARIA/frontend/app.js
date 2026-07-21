// ARIA Frontend - Main application logic
// Handles UI interactions and communicates with the backend API

/* ═══════════════════════════════════════
   ARIA — app.js  (Professional Edition)
   FastAPI + OpenRouter backend
   ═══════════════════════════════════════ */

// ── CONFIG ───────────────────────────────────
const API_BASE = 'http://localhost:8000';

// ── STATE ────────────────────────────────────
const S = {
  mode: 'think', view: 'chat',
  messages: [], history: [],
  totalMsgs: 0, sessions: 1, streak: 1,
  modeCount: { think:0, research:0, create:0, execute:0 },
  dailyActivity: Array(7).fill(0),
  sidebarCollapsed: false,
  isRecording: false, recognition: null,
  newsData: [], newsFilter: 'all', newsLoaded: false,
  userName: 'ARIA User', theme: 'dark',
  styleMode: 'balanced', streaming: true,
  selectedModel: 'anthropic/claude-3.5-sonnet',
  chatStarted: false,
  serverOnline: false,
};

// ── MODE CONFIG ───────────────────────────────
const MODES = {
  think:    { label:'Think',      color:'var(--think)',    icon:'ti-bulb',      chips:['Help me decide something hard','Break down my biggest goal','How do I improve?','Fresh perspective'] },
  research: { label:'Research',   color:'var(--research)', icon:'ti-search',    chips:['Explain quantum computing','Latest in AI','What is CRISPR?','How does the economy work?'] },
  create:   { label:'Create',     color:'var(--create)',   icon:'ti-pencil',    chips:['Write me a powerful bio','Cold email that converts','5 startup ideas','Tagline for my brand'] },
  execute:  { label:'Execute',    color:'var(--execute)',  icon:'ti-rocket',    chips:['Plan my week','Launch project in 30 days','90-day roadmap','Morning routine'] },
};

// ── INIT ─────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  updateChips();
  updateMobileSidebarBtn();
  window.addEventListener('resize', updateMobileSidebarBtn);
  document.getElementById('chatInp').addEventListener('input', function(){ autoResize(this); });
  checkServerHealth();
  setInterval(checkServerHealth, 30000);
});

// ── SERVER HEALTH ─────────────────────────────
async function checkServerHealth() {
  try {
    const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) });
    S.serverOnline = r.ok;
  } catch {
    S.serverOnline = false;
  }
  const dot  = document.getElementById('ssDot');
  const text = document.getElementById('ssText');
  const sp   = document.getElementById('spServerStatus');
  if (S.serverOnline) {
    dot.style.background  = 'var(--success)';
    text.textContent      = 'Connected';
    text.style.color      = 'var(--success)';
    if (sp) { sp.textContent = 'Online ✓'; sp.style.color = 'var(--success)'; }
  } else {
    dot.style.background  = 'var(--danger)';
    text.textContent      = 'Offline';
    text.style.color      = 'var(--danger)';
    if (sp) { sp.textContent = 'Offline — start backend'; sp.style.color = 'var(--danger)'; }
  }
}

// ── STORAGE ──────────────────────────────────
function loadFromStorage() {
  try {
    const d = JSON.parse(localStorage.getItem('aria_state') || '{}');
    if (d.userName)       { S.userName = d.userName; updateProfile(); }
    if (d.theme)          { S.theme = d.theme; applyTheme(d.theme); }
    if (d.styleMode)      { S.styleMode = d.styleMode; const s = document.getElementById('styleSelect'); if(s) s.value = d.styleMode; }
    if (d.streaming!=null){ S.streaming = d.streaming; const t = document.getElementById('streamToggle'); if(t) t.checked = d.streaming; }
    if (d.selectedModel)  { S.selectedModel = d.selectedModel; const m = document.getElementById('modelSelect'); if(m) m.value = d.selectedModel; }
    if (d.modeCount)      S.modeCount = d.modeCount;
    if (d.totalMsgs)      { S.totalMsgs = d.totalMsgs; document.getElementById('statMsgs').textContent = d.totalMsgs; }
    if (d.sessions)       { S.sessions = d.sessions; document.getElementById('statSess').textContent = d.sessions; }
    if (d.history)        { S.history = d.history; renderHistory(); }
    if (d.dailyActivity)  S.dailyActivity = d.dailyActivity;
    document.getElementById('themeToggle').checked = S.theme === 'dark';
    const ni = document.getElementById('nameInput'); if(ni) ni.value = S.userName;
  } catch(e) { console.warn('Storage:', e); }
}

function saveToStorage() {
  try {
    localStorage.setItem('aria_state', JSON.stringify({
      userName:S.userName, theme:S.theme, styleMode:S.styleMode,
      streaming:S.streaming, selectedModel:S.selectedModel,
      modeCount:S.modeCount, totalMsgs:S.totalMsgs, sessions:S.sessions,
      history:S.history.slice(0,20), dailyActivity:S.dailyActivity
    }));
  } catch(e) {}
}

// ── SIDEBAR ──────────────────────────────────
function toggleSidebar() {
  S.sidebarCollapsed = !S.sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', S.sidebarCollapsed);
}
function openMobileSidebar()  { document.getElementById('sidebar').classList.add('mobile-open'); document.getElementById('mobOverlay').classList.add('open'); }
function closeMobileSidebar() { document.getElementById('sidebar').classList.remove('mobile-open'); document.getElementById('mobOverlay').classList.remove('open'); }
function updateMobileSidebarBtn() { const b = document.getElementById('mobMenuBtn'); if(b) b.style.display = window.innerWidth<=700?'flex':'none'; }

// ── VIEW SWITCHING ────────────────────────────
function switchView(view, mode) {
  S.view = view;
  if (mode && MODES[mode]) S.mode = mode;
  closeMobileSidebar();

  document.getElementById('chatView').style.display = view==='chat' ? 'flex'  : 'none';
  document.getElementById('dashView').style.display = view==='dash' ? 'block' : 'none';
  document.getElementById('newsView').style.display = view==='news' ? 'block' : 'none';

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navId = view==='dash' ? 'nav-dash' : view==='news' ? 'nav-news' : 'nav-'+S.mode;
  document.getElementById(navId)?.classList.add('active');

  const cfg = MODES[S.mode];
  document.getElementById('modeText').textContent = cfg.label;
  document.getElementById('modeColor').style.background = cfg.color;

  if (view==='chat') { updateChips(); document.getElementById('chatInp').focus(); }
  if (view==='dash') renderDash();
  if (view==='news') loadNews(false);
}

// ── CHIPS ─────────────────────────────────────
function updateChips() {
  document.getElementById('chipsWrap').innerHTML = MODES[S.mode].chips
    .map(c => `<button class="chip" onclick="fillChip(this.textContent)">${c}</button>`).join('');
}
function fillChip(t) { document.getElementById('chatInp').value = t.trim(); sendMsg(); }

// ── CHAT HELPERS ──────────────────────────────
function autoResize(el) { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,140)+'px'; }
function handleKey(e)   { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();} }
function scrollBottom() { const el=document.getElementById('chatMsgs'); if(el) el.scrollTop=el.scrollHeight; }
function escHTML(s='')  { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s='')  { return s.replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function formatReply(t) {
  return escHTML(t)
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,'<em>$1</em>')
    .replace(/`(.*?)`/g,'<code style="background:var(--bg3);padding:1px 5px;border-radius:4px;font-size:13px">$1</code>')
    .replace(/\n/g,'<br>');
}

// ── ADD MESSAGE ───────────────────────────────
function addMsg(role, text, mode) {
  const modeUsed = mode || S.mode;
  const msgs = document.getElementById('chatMsgs');
  if (!msgs) return null;
  if (role==='user' && !S.chatStarted) { S.chatStarted=true; document.getElementById('welcome')?.classList.add('hidden'); }

  const cfg = MODES[modeUsed];
  const div = document.createElement('div');
  div.className = 'msg-wrap' + (role==='user' ? ' user-wrap' : '');
  const isThinking = text==='__thinking__';
  const initials = S.userName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()||'U';

  if (role==='user') {
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
    const content  = isThinking
      ? '<span class="think-dot">●</span><span class="think-dot">●</span><span class="think-dot">●</span>'
      : formatReply(text);
    div.innerHTML = `
      <div class="msg-av aria-av">A</div>
      <div class="msg-body">
        <div class="msg-meta">ARIA <span class="mbadge" style="background:${cfg.color}22;color:${cfg.color}">${cfg.label}</span></div>
        <div class="msg-bub ${bubClass}" id="${isThinking?'thinking-bub':''}">${content}</div>
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
  return div;
}

// ── SEND MESSAGE ──────────────────────────────
// Sends the user's message to the backend and displays the response
async function sendMsg() {
  const inp  = document.getElementById('chatInp');
  const btn  = document.getElementById('sendBtn');
  const text = inp.value.trim();
  if (!text || btn.disabled) return;

  if (!S.serverOnline) { showToast('⚠️ Backend offline — start the server first'); return; }

  inp.value = ''; inp.style.height = 'auto';
  btn.disabled = true;

  const modeUsed = S.mode;
  addMsg('user', text, modeUsed);
  S.messages.push({ role:'user', content:text });
  S.totalMsgs++;
  S.dailyActivity[6]++;
  S.modeCount[modeUsed] = (S.modeCount[modeUsed]||0) + 1;
  document.getElementById('statMsgs').textContent = S.totalMsgs;
  addToHistory(text, modeUsed);

  const payload = {
    messages: S.messages.slice(-12),
    mode: modeUsed,
    style: S.styleMode,
    model: S.selectedModel,
  };

  if (S.streaming) {
    await sendStreaming(payload, modeUsed);
  } else {
    await sendRegular(payload, modeUsed);
  }

  btn.disabled = false;
  saveToStorage();
  inp.focus();
}

// ── REGULAR (non-streaming) ───────────────────
async function sendRegular(payload, modeUsed) {
  addMsg('aria', '__thinking__', modeUsed);
  try {
    const res  = await fetch(`${API_BASE}/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    document.getElementById('thinking-row')?.remove();
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const data = await res.json();
    const reply = data.reply || 'No response.';
    S.messages.push({ role:'assistant', content:reply });
    S.totalMsgs++;
    document.getElementById('statMsgs').textContent = S.totalMsgs;
    addMsg('aria', reply, modeUsed);
    if (data.model) showToast(`↳ ${data.model.split('/').pop()}`);
  } catch(e) {
    document.getElementById('thinking-row')?.remove();
    addMsg('aria', `⚠️ ${e.message}`, modeUsed);
    S.serverOnline = false; checkServerHealth();
  }
}

// ── STREAMING ────────────────────────────────
async function sendStreaming(payload, modeUsed) {
  const cfg  = MODES[modeUsed];
  const msgs = document.getElementById('chatMsgs');
  const initials = S.userName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()||'U';

  // create streaming bubble
  const div = document.createElement('div');
  div.className = 'msg-wrap';
  div.id = 'stream-row';
  div.innerHTML = `
    <div class="msg-av aria-av">A</div>
    <div class="msg-body">
      <div class="msg-meta">ARIA <span class="mbadge" style="background:${cfg.color}22;color:${cfg.color}">${cfg.label}</span></div>
      <div class="msg-bub aria-bub" id="stream-bub"><span class="think-dot">●</span><span class="think-dot">●</span><span class="think-dot">●</span></div>
    </div>`;
  msgs.appendChild(div);
  scrollBottom();

  const bub = document.getElementById('stream-bub');
  let fullText = '';

  try {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    bub.innerHTML = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const chunk = line.slice(6);
        if (chunk.trim() === '[DONE]') break;
        try {
          const obj = JSON.parse(chunk);
          fullText += obj.text || '';
          bub.innerHTML = formatReply(fullText) + '<span class="stream-cursor">▋</span>';
          scrollBottom();
        } catch {}
      }
    }

    // finalise
    bub.innerHTML = formatReply(fullText);
    div.querySelector('.msg-body').innerHTML += `
      <div class="msg-actions">
        <button class="msg-act-btn" onclick="copyText('${escAttr(fullText)}')"><i class="ti ti-copy"></i> Copy</button>
        <button class="msg-act-btn" onclick="speakText('${escAttr(fullText)}')"><i class="ti ti-volume"></i> Speak</button>
      </div>`;
    div.id = '';
    S.messages.push({ role:'assistant', content:fullText });
    S.totalMsgs++;
    document.getElementById('statMsgs').textContent = S.totalMsgs;

  } catch(e) {
    bub.innerHTML = `⚠️ ${escHTML(e.message)}`;
    div.id = '';
    S.serverOnline = false; checkServerHealth();
  }
}

// ── HISTORY ──────────────────────────────────
function addToHistory(text, mode) {
  const label = text.length>32 ? text.slice(0,32)+'…' : text;
  S.history.unshift({ label, mode, time:Date.now() });
  if (S.history.length>30) S.history.pop();
  renderHistory();
}
function renderHistory() {
  const el = document.getElementById('sbHistory');
  if (!el) return;
  if (!S.history.length) { el.innerHTML='<div class="hist-empty">No history yet</div>'; return; }
  const icon = { think:'ti-bulb', research:'ti-search', create:'ti-pencil', execute:'ti-rocket' };
  el.innerHTML = S.history.slice(0,15).map(h => `
    <div class="hist-item" onclick="recallHistory('${escAttr(h.label)}','${h.mode}')">
      <i class="ti ${icon[h.mode]||'ti-message'}" style="color:${MODES[h.mode]?.color||'var(--text3)'}"></i>
      <span>${escHTML(h.label)}</span>
    </div>`).join('');
}
function recallHistory(label, mode) {
  switchView('chat', mode);
  document.getElementById('chatInp').value = label.replace(/…$/,'');
  document.getElementById('chatInp').focus();
  closeMobileSidebar();
}

// ── NEW CHAT ──────────────────────────────────
function newChat() {
  S.messages = []; S.sessions++; S.chatStarted = false;
  const cm = document.getElementById('chatMsgs');
  cm.innerHTML = '';
  const w = document.createElement('div');
  w.className='welcome'; w.id='welcome';
  w.innerHTML=`<div class="welcome-mark">A</div><h1>ARIA</h1>
    <p>Adaptive Real-life Intelligence Agent.<br>Think deeper, research faster, create better, execute smarter.</p>
    <div class="welcome-modes">
      <div class="wm-badge" style="color:var(--think);border-color:var(--think)">Think</div>
      <div class="wm-badge" style="color:var(--research);border-color:var(--research)">Research</div>
      <div class="wm-badge" style="color:var(--create);border-color:var(--create)">Create</div>
      <div class="wm-badge" style="color:var(--execute);border-color:var(--execute)">Execute</div>
    </div>`;
  cm.appendChild(w);
  document.getElementById('statSess').textContent = S.sessions;
  saveToStorage(); showToast('New chat started');
}

// ── VOICE ─────────────────────────────────────
function toggleVoice() {
  const btn = document.getElementById('voiceBtn');
  if (!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)){ showToast('Voice not supported'); return; }
  if (S.isRecording){ S.recognition?.stop(); S.isRecording=false; btn.classList.remove('recording'); btn.innerHTML='<i class="ti ti-microphone"></i>'; return; }
  const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
  S.recognition = new SR();
  S.recognition.lang='en-US'; S.recognition.continuous=false; S.recognition.interimResults=false;
  S.recognition.onresult = e => { document.getElementById('chatInp').value=e.results[0][0].transcript; S.isRecording=false; btn.classList.remove('recording'); btn.innerHTML='<i class="ti ti-microphone"></i>'; sendMsg(); };
  S.recognition.onerror  = () => { S.isRecording=false; btn.classList.remove('recording'); btn.innerHTML='<i class="ti ti-microphone"></i>'; showToast('Voice error.'); };
  S.recognition.start(); S.isRecording=true;
  btn.classList.add('recording'); btn.innerHTML='<i class="ti ti-microphone-off"></i>';
}
function speakText(text) { if(!window.speechSynthesis){showToast('TTS not supported');return;} window.speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.rate=0.95; window.speechSynthesis.speak(u); showToast('Speaking…'); }
function copyText(text)  { navigator.clipboard.writeText(text).then(()=>showToast('Copied!')); }

// ── SETTINGS ─────────────────────────────────
function openSettings()  { document.getElementById('settingsOverlay').classList.add('open'); document.getElementById('settingsPanel').classList.add('open'); }
function closeSettings() { document.getElementById('settingsOverlay').classList.remove('open'); document.getElementById('settingsPanel').classList.remove('open'); }
function toggleTheme()   { S.theme=document.getElementById('themeToggle').checked?'dark':'light'; applyTheme(S.theme); saveToStorage(); }
function applyTheme(t)   { document.documentElement.setAttribute('data-theme',t); const el=document.getElementById('themeToggle'); if(el) el.checked=t==='dark'; }
function updateProfile() {
  const name = document.getElementById('nameInput')?.value.trim()||'ARIA User';
  S.userName = name;
  const pn=document.getElementById('profName'); if(pn) pn.textContent=name;
  const pa=document.getElementById('profAv');
  const ini=name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()||'A';
  if(pa) pa.textContent=ini;
  saveToStorage();
}
function clearAll() { if(!confirm('Clear all data?')) return; localStorage.removeItem('aria_state'); location.reload(); }

// ── EXPORT ────────────────────────────────────
function exportChat() {
  if(!S.messages.length){showToast('No messages');return;}
  const txt = S.messages.map(m=>`[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
  dl(new Blob([`ARIA Chat Export\n${new Date().toLocaleString()}\n\n`+txt],{type:'text/plain'}), 'ARIA_chat_'+Date.now()+'.txt');
  showToast('Exported .txt');
}
function exportJSON() {
  if(!S.messages.length){showToast('No messages');return;}
  dl(new Blob([JSON.stringify({exported:new Date().toISOString(),mode:S.mode,messages:S.messages},null,2)],{type:'application/json'}),'ARIA_chat_'+Date.now()+'.json');
  showToast('Exported .json');
}
function dl(blob,name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href); }

// ── DASHBOARD ────────────────────────────────
function renderDash() {
  const favMode  = Object.entries(S.modeCount).sort((a,b)=>b[1]-a[1])[0]?.[0]||'think';
  const favLabel = MODES[favMode]?.label||'Think';
  const total    = Object.values(S.modeCount).reduce((a,b)=>a+b,0);
  document.getElementById('kpiGrid').innerHTML = [
    {icon:'ti-message-2',color:'var(--accent)',  val:S.totalMsgs,delta:'+'+S.dailyActivity[6]+' today',     lbl:'Total messages'},
    {icon:'ti-history',  color:'var(--research)',val:S.sessions, delta:'Active',                             lbl:'Sessions'},
    {icon:'ti-flame',    color:'var(--execute)', val:S.streak,   delta:'Keep going!',                       lbl:'Day streak'},
    {icon:'ti-brain',    color:'var(--think)',   val:favLabel,   delta:total+' queries total',               lbl:'Favourite mode'},
  ].map(k=>`<div class="kpi-card"><div class="kpi-icon" style="color:${k.color}"><i class="ti ${k.icon}"></i></div><div class="kpi-val">${k.val}</div><div class="kpi-lbl">${k.lbl}</div><div class="kpi-delta">${k.delta}</div></div>`).join('');

  const days=['M','T','W','T','F','S','S'];
  const vals=S.dailyActivity.map((v,i)=>i<6?Math.floor(Math.random()*12)+1:v);
  const maxV=Math.max(...vals,1);
  const colors=['var(--research)','var(--accent)','var(--create)','var(--execute)','var(--news)','var(--think)','var(--accent2)'];
  document.getElementById('actBars').innerHTML   = vals.map((v,i)=>`<div class="bc-bar" style="height:${Math.round(v/maxV*100)}%;background:${colors[i]};opacity:${i===6?1:0.55}"></div>`).join('');
  document.getElementById('actLabels').innerHTML = days.map(d=>`<div class="bc-label">${d}</div>`).join('');

  const mTotal=total||1;
  document.getElementById('modeBars').innerHTML = Object.entries(MODES).map(([k,m])=>{
    const pct=Math.round((S.modeCount[k]||0)/mTotal*100);
    return `<div class="mb-row"><div class="mb-lbl">${m.label}</div><div class="mb-track"><div class="mb-fill" style="width:${pct}%;background:${m.color}"></div></div><div class="mb-pct">${pct}%</div></div>`;
  }).join('');
}

// ── NEWS ──────────────────────────────────────
async function loadNews(force=false) {
  if(S.newsLoaded&&!force&&S.newsData.length){renderNews();return;}
  document.getElementById('newsGrid').innerHTML='<div class="news-loading"><i class="ti ti-satellite"></i><span>Fetching world feed…</span></div>';
  if(!S.serverOnline){document.getElementById('newsGrid').innerHTML='<div class="news-loading" style="color:var(--danger)"><i class="ti ti-wifi-off"></i><span>Backend offline. Start the server first.</span></div>';return;}
  try {
    const res=await fetch(`${API_BASE}/news`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({count:10})});
    const data=await res.json();
    S.newsData=data.news||[]; S.newsLoaded=true; renderNews();
  } catch(e) {
    document.getElementById('newsGrid').innerHTML='<div class="news-loading" style="color:var(--danger)"><i class="ti ti-wifi-off"></i><span>Could not load feed.</span></div>';
  }
}

function renderNews() {
  const filtered=S.newsFilter==='all'?S.newsData:S.newsData.filter(n=>n.category.toLowerCase()===S.newsFilter);
  const catCls={Tech:'tech',World:'world',Science:'science',Business:'business'};
  const urgIco={high:'🔴',medium:'🟡',low:'🔵'};
  document.getElementById('newsGrid').innerHTML=filtered.length
    ?filtered.map(item=>`
      <div class="news-card ${catCls[item.category]||'world'}">
        <div class="nc-cat ${catCls[item.category]||'world'}">${item.category}</div>
        <div class="nc-title">${escHTML(item.title)}</div>
        <div class="nc-summary">${escHTML(item.summary)}</div>
        <div class="nc-foot">
          <span class="nc-urgency">${urgIco[item.urgency]||'🔵'} ${item.urgency==='high'?'Breaking':item.urgency==='medium'?'Developing':'Update'}</span>
          <button class="nc-dive" onclick="deepDive('${escAttr(item.title)}')">Deep dive ↗</button>
        </div>
      </div>`).join('')
    :'<div class="news-loading">No items.</div>';
}

function filterNews(cat,btn){ S.newsFilter=cat; document.querySelectorAll('.filter-chip').forEach(b=>b.classList.toggle('active',b===btn)); renderNews(); }
function deepDive(title){ switchView('chat','research'); document.getElementById('chatInp').value=`Tell me more about: ${title}`; sendMsg(); }

// ── TOAST ─────────────────────────────────────
function showToast(msg) {
  const t=document.getElementById('toast');
  document.getElementById('toastMsg').textContent=msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}