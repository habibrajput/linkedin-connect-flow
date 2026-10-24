// content.js — LinkedIn Connect Flow with personalized note + live analytics

const CONFIG = {
  MAX_PER_MINUTE: 5,
  MIN_GAP_MS: 18000,
  JITTER_MS: 6000,
  DAILY_CAP: 35,
  MODAL_WAIT_MS: 900,
  AFTER_SEND_MS: 600,
  SCROLL_WAIT_MS: 1500,
  MAX_CONSECUTIVE_SKIPS: 10
};

const NOTE_MESSAGE =
  "Hi, I'm Habib, a Senior Software Engineer with 6+ years of experience in E-commerce, Fintech, POS, and SaaS. Skilled in Laravel, NestJS, React, Vue, Next.js, and payment integrations. I build scalable applications and solve complex technical challenges. I'd love to connect!";

if (NOTE_MESSAGE.length > 300) {
  console.error(`[ConnectFlow] NOTE_MESSAGE is ${NOTE_MESSAGE.length} chars — LinkedIn's limit is 300. Trim it.`);
} else {
  console.log(`[ConnectFlow] note length OK (${NOTE_MESSAGE.length} chars)`);
}

// ============ Shadow-DOM helpers ============

function deepQuery(selector, root = document) {
  const direct = root.querySelector(selector);
  if (direct) return direct;
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      const hit = deepQuery(selector, el.shadowRoot);
      if (hit) return hit;
    }
  }
  return null;
}

function deepQueryAll(selector, root = document, out = []) {
  root.querySelectorAll(selector).forEach(el => out.push(el));
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) deepQueryAll(selector, el.shadowRoot, out);
  }
  return out;
}

function findAddNoteButton() {
  return (
    deepQuery('button[aria-label="Add a note"]') ||
    deepQueryAll('button').find(b => (b.innerText || '').trim().toLowerCase() === 'add a note') ||
    null
  );
}

function findSendWithoutNoteButton() {
  return (
    deepQuery('button[aria-label="Send without a note"]') ||
    deepQueryAll('button').find(b => (b.innerText || '').trim().toLowerCase() === 'send without a note') ||
    null
  );
}

function findDismissButton() {
  return deepQuery('button[aria-label="Dismiss"]');
}

function fireClick(el) {
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window }));
  });
}

// ============ Analytics state ============

const DEFAULT_STATE = {
  status: "idle",          // idle | running | cooling | stopped | cap
  cooldownUntil: 0,
  lastAction: null,        // { ts, result, name }
  totalSent: 0,
  totalNotes: 0,
  totalBlank: 0,
  totalSkipped: 0
};

async function loadState() {
  const { flowState } = await chrome.storage.local.get("flowState");
  return { ...DEFAULT_STATE, ...(flowState || {}) };
}

async function saveState(patch) {
  const current = await loadState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ flowState: next });
  try {
    chrome.runtime.sendMessage({ action: "FLOW_STATE_UPDATE", state: next });
  } catch (e) {}
  return next;
}

// ============ Flow class ============

class ConnectionFlow {
  constructor() {
    this.history = [];
    this.running = false;
    this.stopped = false;
    this.dailyCount = 0;
    this.dailyDate = "";
    this._skips = 0;
  }

  async init() {
    const data = await chrome.storage.local.get(["actionHistory", "dailyCount", "dailyDate"]);
    this.history = data.actionHistory || [];
    this.dailyDate = data.dailyDate || "";
    this.dailyCount = data.dailyCount || 0;

    const today = new Date().toDateString();
    if (this.dailyDate !== today) {
      this.dailyDate = today;
      this.dailyCount = 0;
      await this.persist();
    }
  }

  async persist() {
    await chrome.storage.local.set({
      actionHistory: this.history,
      dailyCount: this.dailyCount,
      dailyDate: this.dailyDate
    });
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  canActNow() {
    const now = Date.now();
    this.history = this.history.filter(t => now - t < 60000);
    if (this.history.length >= CONFIG.MAX_PER_MINUTE) return false;
    const last = this.history[this.history.length - 1] || 0;
    return (now - last) >= CONFIG.MIN_GAP_MS;
  }

  msUntilNextAllowed() {
    const now = Date.now();
    const last = this.history[this.history.length - 1] || 0;
    const gapWait = Math.max(0, CONFIG.MIN_GAP_MS - (now - last));
    this.history = this.history.filter(t => now - t < 60000);
    if (this.history.length >= CONFIG.MAX_PER_MINUTE) {
      const oldest = this.history[0];
      return Math.max(gapWait, 60000 - (now - oldest));
    }
    return gapWait;
  }

  findConnectButton() {
    const anchors = document.querySelectorAll('a[aria-label]');
    for (const el of anchors) {
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (!/^invite .+ to connect$/.test(aria)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.offsetParent === null) continue;
      const ownText = (el.innerText || '').trim().toLowerCase();
      if (/pending|following/.test(ownText)) continue;
      return el;
    }
    return null;
  }

  findConnectButtonIn(root) {
    const anchors = root.querySelectorAll('a[aria-label]');
    for (const el of anchors) {
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (!/^invite .+ to connect$/.test(aria)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      return el;
    }
    return null;
  }

  findSendButton() {
    const btns = [...document.querySelectorAll('button')];
    const plain = btns.find(b => {
      if (b.offsetParent === null) return false;
      const t = (b.innerText || '').trim().toLowerCase();
      return t === 'send' || t === 'send without a note';
    });
    if (plain) return plain;
    return findSendWithoutNoteButton();
  }

  async tryClickAddNote() {
    let btn = null;
    for (let i = 0; i < 10; i++) {
      btn = findAddNoteButton();
      if (btn) break;
      await this.sleep(200);
    }
    if (!btn) {
      this.log('add-note button not found in shadow DOM');
      return false;
    }
    this.log(`clicking add-note <${btn.tagName} aria="${btn.getAttribute('aria-label')}">`);
    fireClick(btn);
    await this.sleep(700 + Math.random() * 400);
    return true;
  }

  async typeNoteAndSend() {
    let textarea = null;
    for (let i = 0; i < 15; i++) {
      textarea =
        deepQuery('textarea[name="message"]') ||
        deepQuery('textarea#custom-message') ||
        deepQuery('textarea') ||
        deepQuery('[contenteditable="true"][role="textbox"]');
      if (textarea) break;
      await this.sleep(200);
    }
    if (!textarea) {
      this.log('note textarea not found in shadow DOM after 3s');
      return false;
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (textarea.tagName === 'TEXTAREA' && nativeSetter) {
      nativeSetter.call(textarea, NOTE_MESSAGE);
    } else {
      textarea.textContent = NOTE_MESSAGE;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    await this.sleep(500 + Math.random() * 400);

    const allBtns = deepQueryAll('button');
    const send = allBtns.find(b => {
      const t = (b.innerText || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const hay = t + ' ' + aria;
      if (/without a note/i.test(hay)) return false;
      return (
        t === 'send' ||
        aria === 'send' ||
        /^send(\s|$)/.test(t) ||
        /^send(\s|$)/.test(aria)
      );
    });
    if (!send) {
      this.log('Send button not found in shadow DOM');
      return false;
    }
    this.log(`clicking send <${send.tagName} aria="${send.getAttribute('aria-label')}"> text="${(send.innerText || '').trim().slice(0, 40)}"`);
    fireClick(send);
    await this.sleep(600 + Math.random() * 500);
    return true;
  }

  closeModalIfAny() {
    const dismiss = findDismissButton();
    if (dismiss) fireClick(dismiss);
  }

  async scrollToNext() {
    window.scrollBy({ top: 400 + Math.random() * 300, behavior: 'smooth' });
    await this.sleep(CONFIG.SCROLL_WAIT_MS + Math.random() * 1000);
  }

  async processOne() {
    const btn = this.findConnectButton();
    if (!btn) return { status: 'skip', reason: 'no connect button visible' };

    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await this.sleep(600 + Math.random() * 500);

    const nameMatch = (btn.getAttribute('aria-label') || '').match(/^Invite (.+) to connect$/i);
    const inviteName = nameMatch ? nameMatch[1] : null;

    let liveBtn = null;
    if (inviteName) {
      liveBtn = [...document.querySelectorAll('a[aria-label]')].find(el => {
        const a = (el.getAttribute('aria-label') || '').toLowerCase();
        return a === `invite ${inviteName.toLowerCase()} to connect`;
      });
    }
    if (!liveBtn) liveBtn = this.findConnectButton();
    if (!liveBtn) return { status: 'skip', reason: 'button disappeared on re-render', name: inviteName };

    fireClick(liveBtn);
    await this.sleep(CONFIG.MODAL_WAIT_MS + Math.random() * 600);

    const addedNote = await this.tryClickAddNote();

    if (addedNote) {
      const sent = await this.typeNoteAndSend();
      if (sent) return { status: 'sent_with_note', name: inviteName };
      this.closeModalIfAny();
      return { status: 'skip', reason: 'note modal failed', name: inviteName };
    }

    const sendBtn = this.findSendButton();
    if (sendBtn) {
      fireClick(sendBtn);
      await this.sleep(CONFIG.AFTER_SEND_MS + Math.random() * 500);
      return { status: 'sent', name: inviteName };
    }
    return { status: 'clicked', name: inviteName };
  }

  async run() {
    await this.init();
    this.running = true;
    this.stopped = false;
    this._skips = 0;
    this.log('started');

    await saveState({ status: 'running', cooldownUntil: 0 });

    while (this.running && !this.stopped) {
      if (this.dailyCount >= CONFIG.DAILY_CAP) {
        this.log('daily cap reached — stopping');
        await saveState({ status: 'cap', cooldownUntil: 0 });
        break;
      }

      // Cooldown / rate-limit wait — push live updates so popup shows countdown
      while (!this.canActNow()) {
        if (this.stopped) break;
        const wait = this.msUntilNextAllowed() + Math.random() * CONFIG.JITTER_MS;
        const until = Date.now() + wait;
        this.log(`rate-limit wait ${Math.round(wait / 1000)}s`);
        await saveState({ status: 'cooling', cooldownUntil: until });

        // Sleep in 1s ticks so popup can re-read cooldownUntil if it reopens
        const end = Date.now() + wait;
        while (Date.now() < end && !this.stopped) {
          await this.sleep(Math.min(1000, end - Date.now()));
        }
      }
      if (this.stopped) break;

      await saveState({ status: 'running', cooldownUntil: 0 });

      const result = await this.processOne();
      this.log('result: ' + JSON.stringify(result));

      const sentOk =
        result.status === 'sent' ||
        result.status === 'sent_with_note' ||
        result.status === 'clicked';

      if (sentOk) {
        this.history.push(Date.now());
        this.dailyCount++;
        this._skips = 0;
        await this.persist();

        const state = await loadState();
        await saveState({
          status: 'running',
          cooldownUntil: 0,
          lastAction: { ts: Date.now(), result: result.status, name: result.name || null },
          totalSent: state.totalSent + 1,
          totalNotes: state.totalNotes + (result.status === 'sent_with_note' ? 1 : 0),
          totalBlank: state.totalBlank + (result.status === 'sent_with_note' ? 0 : 1)
        });
      } else {
        this._skips++;
        const state = await loadState();
        await saveState({
          totalSkipped: state.totalSkipped + 1,
          lastAction: { ts: Date.now(), result: 'skipped: ' + (result.reason || 'unknown'), name: result.name || null }
        });

        if (this._skips >= CONFIG.MAX_CONSECUTIVE_SKIPS) {
          this.log(`${CONFIG.MAX_CONSECUTIVE_SKIPS} consecutive skips — stopping`);
          await saveState({ status: 'stopped', cooldownUntil: 0 });
          break;
        }
      }

      await this.scrollToNext();

      if (this._skips >= 3) {
        window.scrollBy({ top: 800, behavior: 'smooth' });
        await this.sleep(1500);
      }
    }

    this.log('stopped');
    this.running = false;
    await saveState({ status: 'stopped', cooldownUntil: 0 });
  }

  stop() {
    this.stopped = true;
    this.running = false;
  }

  log(msg) {
    console.log('[ConnectFlow]', msg);
  }
}

// ---------- Message bridge ----------
let flow = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START') {
    if (!flow) flow = new ConnectionFlow();
    flow.run();
    sendResponse({ ok: true, state: 'running' });
  } else if (msg.action === 'STOP') {
    if (flow) flow.stop();
    sendResponse({ ok: true, state: 'stopped' });
  }
});