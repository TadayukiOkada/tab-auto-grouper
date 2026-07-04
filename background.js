import { groupTabs, sortTabs, closeDuplicateTabs, getPreviewTabs } from "./src/actions.js";
import { initDebugFlag, setDebug, isDebugEnabled, debug, error } from "./src/logger.js";

// Load the persisted debug flag once when the service worker starts.
initDebugFlag();

// Expose a tiny console helper so the debug flag can be toggled at runtime
// from the service worker console: `TabAutoGrouper.setDebug(true)`.
globalThis.TabAutoGrouper = {
  setDebug,
  isDebugEnabled
};

/**
 * Dispatch a popup/command request to the matching action. The popup resolves
 * and passes windowId; actions never guess the current window themselves.
 */
async function runAction(type, payload) {
  const windowId = payload?.windowId;
  switch (type) {
    case "groupTabs":
      return groupTabs(windowId);
    case "sortTabs":
      return sortTabs({ ...(payload || {}), windowId });
    case "closeDuplicateTabs":
      return closeDuplicateTabs(windowId);
    case "getPreviewTabs":
      return getPreviewTabs(windowId);
    default:
      throw new Error(`Unknown action: ${type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  runAction(message.type, message.payload)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => {
      error("action failed", message?.type, err);
      sendResponse({ ok: false, error: err.message || String(err) });
    });
  return true; // keep the message channel open for the async response
});

// The commands API hands us the active tab of the focused window directly,
// which is a reliable window reference from a service worker.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "group-tabs") {
    debug("keyboard command group-tabs", { windowId: tab?.windowId });
    groupTabs(tab?.windowId).catch((err) => error("keyboard group-tabs failed", err));
  }
});
