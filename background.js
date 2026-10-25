// background.js — relays Start/Stop messages from popup to content script

function sendToTab(tab, msg, sendResponse, allowInject = true) {
  chrome.tabs.sendMessage(tab.id, msg, (resp) => {
    if (chrome.runtime.lastError) {
      const err = chrome.runtime.lastError.message || '';
      if (allowInject && /receiving end does not exist|could not establish connection/i.test(err)) {
        // Content script not present — inject it, then retry once.
        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, files: ['content.js'] },
          () => {
            if (chrome.runtime.lastError) {
              return sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            }
            sendToTab(tab, msg, sendResponse, false);
          }
        );
        return;
      }
      return sendResponse({ ok: false, error: err });
    }
    sendResponse(resp || { ok: true });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "START" || msg.action === "STOP" || msg.action === "RESUME") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) {
        return sendResponse({ ok: false, error: "No active tab" });
      }
      if (!tab.url || !tab.url.includes("linkedin.com")) {
        return sendResponse({ ok: false, error: "Not a LinkedIn tab" });
      }
      sendToTab(tab, msg, sendResponse, true);
    });
    return true; // keep channel open for async response
  }
});