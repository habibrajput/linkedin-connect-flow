// popup.js — live analytics view + settings
const RING_CIRC = 2 * Math.PI * 34;

const statusPill = document.getElementById("status-pill");
const statusLabel = statusPill.querySelector(".pill-label");
const cooldownBar = document.getElementById("cooldown-bar");
const cooldownTime = document.getElementById("cooldown-time");

const todayCountEl = document.getElementById("today-count");
const capEl = document.getElementById("cap");
const totalSentEl = document.getElementById("total-sent");
const totalNotesEl = document.getElementById("total-notes");
const totalBlankEl = document.getElementById("total-blank");
const totalSkippedEl = document.getElementById("total-skipped");
const lastActionListEl = document.getElementById("last-action-list");

const ringProgress = document.getElementById("ring-progress");
const progressFill = document.getElementById("progress-fill");
const usageSub = document.getElementById("usage-sub");
const remainingCountEl = document.getElementById("remaining-count");

const noteInput = document.getElementById("note-input");
const noteCount = document.getElementById("note-count");
const capInput = document.getElementById("cap-input");
const saveSettingsBtn = document.getElementById("save-settings");
const resumeBtn = document.getElementById("resume");
const resetStatsBtn = document.getElementById("reset-stats");
const settingsStatus = document.getElementById("settings-status");

let cooldownInterval = null;
let cooldownUntil = 0;
let dailyCap = 35;

const DEFAULT_NOTE = "Hi, I'm Habib, a Senior Software Engineer with 6+ years of experience in E-commerce, Fintech, POS, and SaaS. Skilled in Laravel, NestJS, React, Vue, Next.js, and payment integrations. I build scalable applications and solve complex technical challenges. I'd love to connect!";

function renderStatus(status) {
  const labels = {
    idle: "Idle",
    running: "Running",
    cooling: "Cooling",
    stopped: "Stopped",
    cap: "Cap reached"
  };
  statusLabel.textContent = labels[status] || status;
  statusPill.className = "pill " + status;
}

function renderCooldown(until) {
  cooldownUntil = until || 0;
  if (cooldownInterval) {
    clearInterval(cooldownInterval);
    cooldownInterval = null;
  }
  if (!cooldownUntil || cooldownUntil <= Date.now()) {
    cooldownBar.classList.add("hidden");
    return;
  }
  cooldownBar.classList.remove("hidden");
  const tick = () => {
    const remaining = Math.max(0, cooldownUntil - Date.now());
    if (remaining <= 0) {
      cooldownTime.textContent = "0s";
      clearInterval(cooldownInterval);
      cooldownInterval = null;
      cooldownBar.classList.add("hidden");
      return;
    }
    cooldownTime.textContent = Math.ceil(remaining / 1000) + "s";
  };
  tick();
  cooldownInterval = setInterval(tick, 500);
}

function renderLastActions(actions) {
  if (!lastActionListEl) return;
  if (!actions || !actions.length) {
    lastActionListEl.innerHTML = '<div class="last-action-empty">—</div>';
    return;
  }
  const sorted = [...actions].reverse();
  lastActionListEl.innerHTML = sorted.map((a) => {
    const time = new Date(a.ts).toLocaleTimeString();
    const who = a.name ? " → " + a.name : "";
    const res = a.result || "?";
    return `<div class="last-action-row">${time} · ${res}${who}</div>`;
  }).join("");
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings || {};
  dailyCap = (s.dailyCap && s.dailyCap > 0) ? s.dailyCap : 35;
  noteInput.value = (s.noteMessage != null) ? s.noteMessage : DEFAULT_NOTE;
  capInput.value = dailyCap;
  updateNoteCount();
}

function updateNoteCount() {
  noteCount.textContent = (noteInput.value || "").length;
}
async function refresh() {
  const [
    { flowState },
    { dailyCount, dailyDate },
    { settings },
    { flowResumeUrl }
  ] = await Promise.all([
    chrome.storage.local.get("flowState"),
    chrome.storage.local.get(["dailyCount", "dailyDate"]),
    chrome.storage.local.get("settings"),
    chrome.storage.local.get("flowResumeUrl")
  ]);

  if (settings && settings.dailyCap) {
    dailyCap = settings.dailyCap;
    capInput.value = dailyCap;
  }

  const state = {
    status: "idle",
    cooldownUntil: 0,
    lastAction: null,
    totalSent: 0,
    totalNotes: 0,
    totalBlank: 0,
    totalSkipped: 0,
    ...(flowState || {})
  };

  const today = new Date().toDateString();
  const todayCount = dailyDate === today ? (dailyCount || 0) : 0;

  renderStatus(state.status);
  renderCooldown(state.cooldownUntil);

  todayCountEl.textContent = todayCount;
  capEl.textContent = dailyCap;
  totalSentEl.textContent = state.totalSent;
  totalNotesEl.textContent = state.totalNotes;
  totalBlankEl.textContent = state.totalBlank;
  totalSkippedEl.textContent = state.totalSkipped;
  const actions = Array.isArray(state.lastActions)
    ? state.lastActions
    : (state.lastAction ? [state.lastAction] : []);
  renderLastActions(actions);

  const pct = dailyCap > 0 ? Math.min(1, todayCount / dailyCap) : 0;
  progressFill.style.width = (pct * 100).toFixed(1) + "%";
  ringProgress.style.strokeDashoffset = (RING_CIRC * (1 - pct)).toFixed(2);
  remainingCountEl.textContent = Math.max(0, dailyCap - todayCount);
  usageSub.textContent = todayCount === 1
    ? "1 connection sent today"
    : `${todayCount} connections sent today`;

  document.getElementById("start").disabled = state.status === "running" || state.status === "cooling";
  document.getElementById("stop").disabled = state.status === "idle" || state.status === "stopped" || state.status === "cap";
  if (resumeBtn) resumeBtn.disabled = !flowResumeUrl || todayCount >= dailyCap;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "FLOW_STATE_PUSH") refresh();
});

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");

startBtn.addEventListener("click", () => {
  const icon = startBtn.querySelector(".btn-icon");
  const label = startBtn.querySelector("span:last-child");
  const prevIcon = icon ? icon.textContent : "";
  const prevLabel = label ? label.textContent : "";
  if (icon) icon.textContent = "⏳";
  if (label) label.textContent = "Starting…";
  startBtn.disabled = true;
  chrome.runtime.sendMessage({ action: "START" }, (resp) => {
    if (chrome.runtime.lastError) { console.error("[popup] START error:", chrome.runtime.lastError.message); }
    if (resp && !resp.ok) console.error("[popup] START:", resp.error);
    setTimeout(() => {
      if (icon) icon.textContent = prevIcon || "▶";
      if (label) label.textContent = prevLabel || "Start";
      refresh();
    }, 200);
  });
});

stopBtn.addEventListener("click", () => {
  const icon = stopBtn.querySelector(".btn-icon");
  const label = stopBtn.querySelector("span:last-child");
  const prevIcon = icon ? icon.textContent : "";
  const prevLabel = label ? label.textContent : "";
  if (icon) icon.textContent = "⏳";
  if (label) label.textContent = "Stopping…";
  stopBtn.disabled = true;
  chrome.runtime.sendMessage({ action: "STOP" }, (resp) => {
    if (chrome.runtime.lastError) { console.error("[popup] STOP error:", chrome.runtime.lastError.message); }
    if (resp && !resp.ok) console.error("[popup] STOP:", resp.error);
    setTimeout(() => {
      if (icon) icon.textContent = prevIcon || "■";
      if (label) label.textContent = prevLabel || "Stop";
      refresh();
    }, 200);
  });
});

if (resumeBtn) resumeBtn.addEventListener("click", async () => {
  chrome.runtime.sendMessage({ action: "RESUME" }, (resp) => {
    if (chrome.runtime.lastError) { console.error("[popup] RESUME error:", chrome.runtime.lastError.message); return; }
    if (resp && !resp.ok) console.error("[popup] RESUME:", resp.error);
    setTimeout(refresh, 300);
  });
});

const settingsToggleBtn = document.getElementById("settings-toggle");
const settingsCloseBtn = document.getElementById("settings-close");
const settingsOverlay = document.getElementById("settings-overlay");

if (settingsToggleBtn) settingsToggleBtn.addEventListener("click", () => settingsOverlay.classList.remove("hidden"));
noteInput.addEventListener("input", updateNoteCount);
if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", () => settingsOverlay.classList.add("hidden"));

saveSettingsBtn.addEventListener("click", async () => {
  const noteMessage = noteInput.value.trim();
  const cap = parseInt(capInput.value, 10);
  if (!noteMessage) {
    settingsStatus.textContent = "Note cannot be empty";
    settingsStatus.style.color = "#c62828";
    return;
  }
  if (!cap || cap < 1 || cap > 100) {
    settingsStatus.textContent = "Daily cap must be 1–100";
    settingsStatus.style.color = "#c62828";
    return;
  }
  await chrome.storage.local.set({ settings: { noteMessage, dailyCap: cap } });
  dailyCap = cap;
  settingsStatus.style.color = "#2e7d32";
  settingsStatus.textContent = "Settings saved";
  setTimeout(() => { settingsStatus.textContent = ""; }, 2000);
  refresh();
});

const openRecruiterSearchBtn = document.getElementById("open-recruiter-search");
if (openRecruiterSearchBtn) openRecruiterSearchBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.linkedin.com/search/results/people/?keywords=technical%20recruiter&origin=GLOBAL_SEARCH_HEADER" });
});

resetStatsBtn.addEventListener("click", async () => {
  if (!confirm("Reset all stats and daily count?")) return;
  await chrome.storage.local.set({
    flowState: { status: "idle", cooldownUntil: 0, lastAction: null, lastActions: [], totalSent: 0, totalNotes: 0, totalBlank: 0, totalSkipped: 0 },
    dailyCount: 0,
    dailyDate: new Date().toDateString(),
    flowResumeUrl: null,
    actionHistory: []
  });
  settingsStatus.style.color = "#2e7d32";
  settingsStatus.textContent = "Stats reset";
  setTimeout(() => { settingsStatus.textContent = ""; }, 2000);
  refresh();
});

(async () => {
  await loadSettings();
  refresh();
})();

setInterval(refresh, 1500);
