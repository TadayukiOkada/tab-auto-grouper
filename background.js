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
//
// An identical request (same type and payload) that is still waiting in the
// queue is coalesced: callers share the queued run instead of stacking
// another full pass (e.g. the shortcut pressed repeatedly). Once a run has
// started it no longer absorbs new requests, since the tab strip may have
// changed after it read it.
//
// A run that hangs (e.g. a browser API call that never settles) would block
// every later action, so each run is abandoned after ACTION_TIMEOUT_MS. The
// hung call isn't cancelled, but the queue and its caller move on.
const ACTION_TIMEOUT_MS = 120_000;
let actionQueue = Promise.resolve();
const queuedByKey = new Map();
function serialize(key, fn) {
  const queued = queuedByKey.get(key);
  if (queued) {
    debug("coalesced queued action", key);
    return queued;
  }
  const run = () => {
    queuedByKey.delete(key);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Action timed out")), ACTION_TIMEOUT_MS);
    });
    return Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
  };
  const result = actionQueue.then(run, run);
  queuedByKey.set(key, result);
  actionQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}

function enqueueAction(type, payload) {
  return serialize(`${type}:${JSON.stringify(payload ?? null)}`, () => runAction(type, payload));
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
  enqueueAction(message.type, message.payload)
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
    enqueueAction("groupTabs", { windowId: tab?.windowId }).catch((err) => error("keyboard group-tabs failed", err));
  }
});
