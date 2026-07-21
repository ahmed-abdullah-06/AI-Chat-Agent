/* ═══════════════════════════════════════
   ARIA — app.js (FINAL FIXED VERSION)
   ═══════════════════════════════════════ */

// ───────────────────────────────────────
// STATE
// ───────────────────────────────────────

const S = {
  mode: "think",
  view: "chat",
  messages: [],
  history: [],
  totalMsgs: 0,
  sessions: 1,
  streak: 1,

  modeCount: {
    think: 0,
    research: 0,
    create: 0,
    execute: 0,
  },

  dailyActivity: Array(7).fill(0),

  sidebarCollapsed: false,
  mobileSidebarOpen: false,

  isRecording: false,
  recognition: null,

  newsData: [],
  newsFilter: "all",

  userName: "ARIA User",

  theme: "dark",
  fontSize: 16,

  styleMode: "balanced",

  chatStarted: false,
};

// ───────────────────────────────────────
// MODES
// ───────────────────────────────────────

const MODES = {
  think: {
    label: "Think",
    color: "var(--think)",
    icon: "ti-bulb",

    chips: [
      "Help me decide something hard",
      "Break down my biggest goal",
      "How do I improve my habits?",
    ],
  },

  research: {
    label: "Research",
    color: "var(--research)",
    icon: "ti-search",

    chips: [
      "Explain quantum computing",
      "Latest AI breakthroughs",
      "What is CRISPR?",
    ],
  },

  create: {
    label: "Create",
    color: "var(--create)",
    icon: "ti-pencil",

    chips: [
      "Write me a bio",
      "Cold email that converts",
      "Startup ideas",
    ],
  },

  execute: {
    label: "Execute",
    color: "var(--execute)",
    icon: "ti-rocket",

    chips: [
      "Plan my week",
      "Create a roadmap",
      "Morning routine",
    ],
  },
};

// ───────────────────────────────────────
// INIT
// ───────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  loadFromStorage();

  updateChips();

  updateMobileSidebarBtn();

  window.addEventListener("resize", updateMobileSidebarBtn);

  const inp = document.getElementById("chatInp");

  if (inp) {
    inp.addEventListener("input", () => autoResize(inp));
  }
});

// ───────────────────────────────────────
// STORAGE
// ───────────────────────────────────────

function loadFromStorage() {
  try {
    const saved = localStorage.getItem("aria_state");

    if (!saved) return;

    const d = JSON.parse(saved);

    Object.assign(S, d);

    applyTheme(S.theme);

    document.getElementById("statMsgs").textContent = S.totalMsgs || 0;

    document.getElementById("statSess").textContent = S.sessions || 1;

    renderHistory();
  } catch (err) {
    console.error(err);
  }
}

function saveToStorage() {
  localStorage.setItem(
    "aria_state",
    JSON.stringify({
      history: S.history,
      totalMsgs: S.totalMsgs,
      sessions: S.sessions,
      modeCount: S.modeCount,
      dailyActivity: S.dailyActivity,
      theme: S.theme,
      userName: S.userName,
    })
  );
}

// ───────────────────────────────────────
// HELPERS
// ───────────────────────────────────────

function escHTML(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatReply(text) {
  return escHTML(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

function scrollBottom() {
  const el = document.getElementById("chatMsgs");

  if (!el) return;

  el.scrollTop = el.scrollHeight;
}

function autoResize(el) {
  el.style.height = "auto";

  el.style.height = Math.min(el.scrollHeight, 140) + "px";
}

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();

    sendMsg();
  }
}

function showToast(msg) {
  const toast = document.getElementById("toast");

  if (!toast) return;

  document.getElementById("toastMsg").textContent = msg;

  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

// ───────────────────────────────────────
// SIDEBAR
// ───────────────────────────────────────

function toggleSidebar() {
  S.sidebarCollapsed = !S.sidebarCollapsed;

  document
    .getElementById("sidebar")
    ?.classList.toggle("collapsed", S.sidebarCollapsed);
}

function openMobileSidebar() {
  document.getElementById("sidebar")?.classList.add("mobile-open");

  document.getElementById("mobOverlay")?.classList.add("open");
}

function closeMobileSidebar() {
  document.getElementById("sidebar")?.classList.remove("mobile-open");

  document.getElementById("mobOverlay")?.classList.remove("open");
}

function updateMobileSidebarBtn() {
  const btn = document.getElementById("mobMenuBtn");

  if (!btn) return;

  btn.style.display = window.innerWidth <= 700 ? "flex" : "none";
}

// ───────────────────────────────────────
// VIEWS
// ───────────────────────────────────────

function switchView(view, mode = S.mode) {
  S.view = view;

  S.mode = mode;

  document.getElementById("chatView").style.display =
    view === "chat" ? "flex" : "none";

  document.getElementById("dashView").style.display =
    view === "dash" ? "block" : "none";

  document.getElementById("newsView").style.display =
    view === "news" ? "block" : "none";

  updateChips();
}

// ───────────────────────────────────────
// CHIPS
// ───────────────────────────────────────

function updateChips() {
  const chipsWrap = document.getElementById("chipsWrap");

  if (!chipsWrap) return;

  const chips = MODES[S.mode].chips;

  chipsWrap.innerHTML = chips
    .map(
      (c) =>
        `<button class="chip" onclick="fillChip(this.textContent)">
          ${c}
        </button>`
    )
    .join("");
}

function fillChip(text) {
  document.getElementById("chatInp").value = text;

  sendMsg();
}

// ───────────────────────────────────────
// ADD MESSAGE
// ───────────────────────────────────────

function addMsg(role, text, mode = S.mode) {
  const msgs = document.getElementById("chatMsgs");

  if (!msgs) return;

  const cfg = MODES[mode];

  const div = document.createElement("div");

  div.className = "msg-wrap";

  if (role === "user") {
    div.classList.add("user-wrap");

    div.innerHTML = `
      <div class="msg-av user-av">U</div>

      <div class="msg-body">

        <div class="msg-meta">
          ${escHTML(S.userName)}
        </div>

        <div class="msg-bub user-bub">
          ${escHTML(text)}
        </div>

      </div>
    `;
  } else {
    const thinking = text === "__thinking__";

    div.innerHTML = `
      <div class="msg-av aria-av">A</div>

      <div class="msg-body">

        <div class="msg-meta">
          ARIA

          <span class="mbadge"
          style="background:${cfg.color}22;color:${cfg.color}">
            ${cfg.label}
          </span>

        </div>

        <div class="msg-bub ${
          thinking ? "thinking-bub" : "aria-bub"
        }">

          ${
            thinking
              ? `
            <span class="think-dot">●</span>
            <span class="think-dot">●</span>
            <span class="think-dot">●</span>
          `
              : formatReply(text)
          }

        </div>

      </div>
    `;

    if (thinking) {
      div.id = "thinking-row";
    }
  }

  msgs.appendChild(div);

  scrollBottom();
}

// ───────────────────────────────────────
// SEND MESSAGE
// ───────────────────────────────────────

async function sendMsg() {
  const inp = document.getElementById("chatInp");

  const btn = document.getElementById("sendBtn");

  const text = inp.value.trim();

  if (!text || btn.disabled) return;

  btn.disabled = true;

  inp.value = "";

  inp.style.height = "auto";

  addMsg("user", text);

  S.messages.push({
    role: "user",
    content: text,
  });

  S.totalMsgs++;

  document.getElementById("statMsgs").textContent = S.totalMsgs;

  addToHistory(text, S.mode);

  addMsg("assistant", "__thinking__");

  try {
    const res = await fetch("http://localhost:3000/chat", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        message: text,
        mode: S.mode,
      }),
    });

    const data = await res.json();

    document.getElementById("thinking-row")?.remove();

    const reply = data.reply || "No response from server.";

    S.messages.push({
      role: "assistant",
      content: reply,
    });

    addMsg("assistant", reply);

    saveToStorage();
  } catch (err) {
    console.error(err);

    document.getElementById("thinking-row")?.remove();

    addMsg(
      "assistant",
      "Server connection failed. Make sure backend is running."
    );
  }

  btn.disabled = false;

  inp.focus();
}

// ───────────────────────────────────────
// HISTORY
// ───────────────────────────────────────

function addToHistory(text, mode) {
  const label =
    text.length > 30 ? text.slice(0, 30) + "..." : text;

  S.history.unshift({
    label,
    mode,
  });

  if (S.history.length > 20) {
    S.history.pop();
  }

  renderHistory();
}

function renderHistory() {
  const el = document.getElementById("sbHistory");

  if (!el) return;

  if (!S.history.length) {
    el.innerHTML =
      '<div class="hist-empty">No history yet</div>';

    return;
  }

  el.innerHTML = S.history
    .map(
      (h) => `
      <div class="hist-item">
        <span>${escHTML(h.label)}</span>
      </div>
    `
    )
    .join("");
}

// ───────────────────────────────────────
// THEME
// ───────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute(
    "data-theme",
    theme
  );

  S.theme = theme;
}

function toggleTheme() {
  const checked =
    document.getElementById("themeToggle").checked;

  applyTheme(checked ? "dark" : "light");

  saveToStorage();
}

// ───────────────────────────────────────
// NEW CHAT
// ───────────────────────────────────────

function newChat() {
  S.messages = [];

  document.getElementById("chatMsgs").innerHTML = "";

  S.sessions++;

  document.getElementById("statSess").textContent =
    S.sessions;

  saveToStorage();

  showToast("New chat started");
}

// ───────────────────────────────────────
// EXPORT
// ───────────────────────────────────────

function exportChat() {
  if (!S.messages.length) {
    showToast("No messages to export");

    return;
  }

  const blob = new Blob(
    [JSON.stringify(S.messages, null, 2)],
    {
      type: "application/json",
    }
  );

  const a = document.createElement("a");

  a.href = URL.createObjectURL(blob);

  a.download = "aria-chat.json";

  a.click();
}

function clearAll() {
  localStorage.removeItem("aria_state");

  location.reload();
}

// ───────────────────────────────────────
// NEWS
// ───────────────────────────────────────

function loadNews() {
  const grid = document.getElementById("newsGrid");

  if (!grid) return;

  grid.innerHTML = `
    <div class="news-loading">
      News system ready.
    </div>
  `;
}

// ───────────────────────────────────────
// VOICE
// ───────────────────────────────────────

function toggleVoice() {
  if (
    !window.SpeechRecognition &&
    !window.webkitSpeechRecognition
  ) {
    showToast("Voice not supported");

    return;
  }

  if (S.isRecording && S.recognition) {
    S.recognition.stop();

    S.isRecording = false;

    return;
  }

  const SR =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  const recognition = new SR();

  recognition.lang = "en-US";

  recognition.onresult = (e) => {
    document.getElementById("chatInp").value =
      e.results[0][0].transcript;

    sendMsg();
  };

  recognition.onend = () => {
    S.isRecording = false;
  };

  recognition.start();

  S.recognition = recognition;

  S.isRecording = true;
}

// ───────────────────────────────────────
// COPY
// ───────────────────────────────────────

function copyText(text) {
  navigator.clipboard.writeText(text);

  showToast("Copied");
}