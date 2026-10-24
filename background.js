// background.js — relays Start/Stop messages from popup to content script

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "START" || msg.action === "STOP") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) {
        return sendResponse({ ok: false, error: "No active tab" });
      }
      if (!tab.url || !tab.url.includes("linkedin.com")) {
        return sendResponse({ ok: false, error: "Not a LinkedIn tab" });
      }
      chrome.tabs.sendMessage(tab.id, msg, (resp) => {
        if (chrome.runtime.lastError) {
          return sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        }
        sendResponse(resp || { ok: true });
      });
    });
    return true; // keep channel open for async response
  }
});