// Lightweight logger with a runtime-toggleable debug flag.
//
// Diagnostic logging is off by default so a released build stays quiet. Turn
// it on without editing code by either:
//   • running `TabAutoGrouper.setDebug(true)` in the service worker console
//     (exposed in background.js), or
//   • setting chrome.storage.local "tabAutoGrouperDebug" to true.
//
// The flag is cached in memory and refreshed from storage at startup so that
// hot paths don't await storage on every log call.

const DEBUG_STORAGE_KEY = "tabAutoGrouperDebug";
const LOG_PREFIX = "[TabAutoGrouper]";

let debugEnabled = false;

/**
 * Load the persisted debug flag once at module init. Safe to call in any
 * context that has chrome.storage; silently no-ops otherwise.
 */
export async function initDebugFlag() {
  try {
    const stored = await chrome.storage.local.get(DEBUG_STORAGE_KEY);
    debugEnabled = Boolean(stored?.[DEBUG_STORAGE_KEY]);
  } catch {
    debugEnabled = false;
  }
  return debugEnabled;
}

/** Enable or disable debug logging and persist the choice. */
export async function setDebug(enabled) {
  debugEnabled = Boolean(enabled);
  try {
    await chrome.storage.local.set({ [DEBUG_STORAGE_KEY]: debugEnabled });
  } catch {
    // Ignore persistence failures; the in-memory flag still applies.
  }
  return debugEnabled;
}

/** Whether debug logging is currently on. */
export function isDebugEnabled() {
  return debugEnabled;
}

/** Debug-level log. Suppressed unless debug logging is enabled. */
export function debug(...args) {
  if (debugEnabled) {
    console.log(LOG_PREFIX, ...args);
  }
}

/** Warning-level log. Suppressed unless debug logging is enabled. */
export function warn(...args) {
  if (debugEnabled) {
    console.warn(LOG_PREFIX, ...args);
  }
}

/**
 * Error-level log. Always emitted regardless of the debug flag, because a
 * thrown/caught error is worth surfacing even in a released build.
 */
export function error(...args) {
  console.error(LOG_PREFIX, ...args);
}
