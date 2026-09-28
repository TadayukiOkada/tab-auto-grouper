import { groupTabs, sortTabs, closeDuplicateTabs, getPreviewTabs } from "./src/actions.js";
import { initDebugFlag, setDebug, isDebugEnabled, debug, error } from "./src/logger.js";
import { extensionApi } from "./src/runtime.js";

// Load the persisted debug flag once when the service worker starts.
initDebugFlag();

// Expose a tiny console helper so the debug flag can be toggled at runtime
// from the service worker console: `TabAutoGrouper.setDebug(true)`.
globalThis.TabAutoGrouper = {
  setDebug,
  isDebugEnabled
};

// Serialize all tab/group-mutating actions through one queue so a popup
// click and the keyboard shortcut firing around the same time can't
// interleave their tabs.move/tabs.group calls against each other.
let actionQueue = Promise.resolve();
function serialize(fn) {
  const result = actionQueue.then(fn, fn);
  actionQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}

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

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  serialize(() => runAction(message.type, message.payload))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => {
      error("action failed", message?.type, err);
      sendResponse({ ok: false, error: err.message || String(err) });
    });
  return true; // keep the message channel open for the async response
});

// The commands API hands us the active tab of the focused window directly,
// which is a reliable window reference from a service worker.
extensionApi.commands.onCommand.addListener((command, tab) => {
  if (command === "group-tabs") {
    debug("keyboard command group-tabs", { windowId: tab?.windowId });
    serialize(() => groupTabs(tab?.windowId)).catch((err) => error("keyboard group-tabs failed", err));
  }
});
