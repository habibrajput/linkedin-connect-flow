// popup.js — live analytics view

const statusPill = document.getElementById("status-pill");
const cooldownBar = document.getElementById("cooldown-bar");
const cooldownTime = document.getElementById("cooldown-time");

const todayCountEl = document.getElementById("today-count");
const capEl = document.getElementById("cap");
const totalSentEl = document.getElementById("total-sent");
const totalNotesEl = document.getElementById("total-notes");
const totalBlankEl = document.getElementById("total-blank");
const totalSkippedEl = document.getElementById("total-skipped");
const lastActionEl = document.getElementById("last-action-text");

const DAILY_CAP = 35; // keep in sync with content.js CONFIG.DAILY_CAP

let cooldownInterval = null;
let cooldownUntil = 0;

function renderStatus(status) {
  const labels = {
    idle: "Idle",
    running: "Running",
    cooling: "Cooling",
    stopped: "Stopped",
    cap: "Cap reached"
  };
  statusPill.textContent = labels[status] || status;
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

function formatLastAction(last) {
  if (!last) return "—";
  const time = new Date(last.ts).toLocaleTimeString();
  const who = last.name ? " → " + last.name : "";
  const res = last.result || "?";
  return `${time} · ${res}${who}`;
}

async function refresh() {
  const [
    { flowState },
    { dailyCount, dailyDate }
  ] = await Promise.all([
    chrome.storage.local.get("flowState"),
    chrome.storage.local.get(["dailyCount", "dailyDate"])
  ]);

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

  // Daily count check (resets on new date)
  const today = new Date().toDateString();
  const todayCount = dailyDate === today ? (dailyCount || 0) : 0;

  renderStatus(state.status);
  renderCooldown(state.cooldownUntil);

  todayCountEl.textContent = todayCount;
  capEl.textContent = DAILY_CAP;
  totalSentEl.textContent = state.totalSent;
  totalNotesEl.textContent = state.totalNotes;
  totalBlankEl.textContent = state.totalBlank;
  totalSkippedEl.textContent = state.totalSkipped;
  lastActionEl.textContent = formatLastAction(state.lastAction);

  // Disable / enable buttons
  document.getElementById("start").disabled = state.status === "running" || state.status === "cooling";
  document.getElementById("stop").disabled = state.status === "idle" || state.status === "stopped" || state.status === "cap";
}

// Live updates from background → popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "FLOW_STATE_PUSH") {
    // Re-read from storage (also refreshes daily count)
    refresh();
  }
});

// Buttons
document.getElementById("start").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "START" }, (resp) => {
    if (chrome.runtime.lastError) {
      console.error("[popup] START error:", chrome.runtime.lastError.message);
      return;
    }
    if (resp && !resp.ok) console.error("[popup] START:", resp.error);
    setTimeout(refresh, 200);
  });
});

document.getElementById("stop").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "STOP" }, (resp) => {
    if (chrome.runtime.lastError) {
      console.error("[popup] STOP error:", chrome.runtime.lastError.message);
      return;
    }
    if (resp && !resp.ok) console.error("[popup] STOP:", resp.error);
    setTimeout(refresh, 200);
  });
});

// Initial render
refresh();

// Safety net — poll every 1.5s in case a push is missed
setInterval(refresh, 1500);