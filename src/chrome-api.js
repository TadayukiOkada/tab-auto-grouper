// A thin, defensive wrapper over the Chrome tabs/tabGroups/windows APIs.
//
// Goals:
//   • Never call chrome.windows.getCurrent() or use { currentWindow: true }
//     from the service worker. A service worker has no window of its own, so
//     "current window" resolution there is unreliable. Callers always pass an
//     explicit windowId (resolved by the popup, which does have a window).
//   • Centralize the retry/settle logic for the handful of operations that can
//     transiently fail while the tab strip is mid-rearrangement.
//   • Provide small typed helpers (group tab counts, group lookups) so the
//     higher-level modules read clearly.

import { debug, error } from "./logger.js";

/** chrome.tabGroups.TAB_GROUP_ID_NONE, resolved defensively. */
export const NO_GROUP = (typeof chrome !== "undefined" && chrome.tabGroups && chrome.tabGroups.TAB_GROUP_ID_NONE) ?? -1;

/** Await a fixed delay. Used to let the tab strip settle between operations. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** All normal browser windows' ids. */
export async function getAllNormalWindowIds() {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  return windows.map((win) => win.id);
}

/**
 * Resolve the set of window ids an action should operate on.
 * @param {boolean} activeWindowOnly
 * @param {number|undefined} windowId explicit id from the popup
 * @returns {Promise<number[]>}
 */
export async function resolveWindowIds(activeWindowOnly, windowId) {
  if (activeWindowOnly) {
    return windowId != null ? [windowId] : [];
  }
  return getAllNormalWindowIds();
}

/**
 * Query tabs in a window (or all windows when windowId is null/undefined).
 * @param {number|undefined} windowId
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function queryTabs(windowId) {
  return chrome.tabs.query(windowId != null ? { windowId } : {});
}

/**
 * Query tab groups in a window (or all windows).
 * @param {number|undefined} windowId
 * @returns {Promise<chrome.tabGroups.TabGroup[]>}
 */
export async function queryGroups(windowId) {
  return chrome.tabGroups.query(windowId != null ? { windowId } : {});
}

/**
 * Get a group by id, or null if it no longer exists.
 * @param {number} groupId
 * @returns {Promise<chrome.tabGroups.TabGroup | null>}
 */
export async function getGroup(groupId) {
  try {
    return await chrome.tabGroups.get(groupId);
  } catch {
    return null;
  }
}

/**
 * Size and starting index of a group within a window.
 * @param {number} windowId
 * @param {number} groupId
 * @returns {Promise<{ size: number, start: number | null }>}
 */
export async function getGroupTabInfo(windowId, groupId) {
  const groupTabs = (await chrome.tabs.query({ windowId, groupId })).sort((a, b) => a.index - b.index);
  return {
    size: groupTabs.length,
    start: groupTabs.length > 0 ? groupTabs[0].index : null
  };
}

/** Update a group's title/color/collapsed state. Best-effort. */
export async function updateGroup(groupId, props) {
  try {
    await chrome.tabGroups.update(groupId, props);
    return true;
  } catch (err) {
    error("tabGroups.update failed", groupId, props, err);
    return false;
  }
}

/** Collapse a group. Best-effort. */
export async function collapseGroup(groupId) {
  return updateGroup(groupId, { collapsed: true });
}

/**
 * Move a group to an index (or -1 for the end). One call, trusting Chrome to
 * snap an out-of-range index to the nearest valid boundary — verifying the
 * exact resulting index and retrying is what previously wedged group moves.
 * @returns {Promise<boolean>} whether the move call succeeded
 */
export async function moveGroup(groupId, index) {
  try {
    await chrome.tabGroups.move(groupId, { index });
    return true;
  } catch (err) {
    error("tabGroups.move failed", groupId, index, err);
    return false;
  }
}

/** Move a single tab to an index. Best-effort. */
export async function moveTab(tabId, index) {
  try {
    await chrome.tabs.move(tabId, { index });
    return true;
  } catch (err) {
    error("tabs.move failed", tabId, index, err);
    return false;
  }
}

/** Ungroup one or more tabs. Best-effort. */
export async function ungroupTabs(tabIds) {
  const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
  try {
    await chrome.tabs.ungroup(ids);
    return true;
  } catch (err) {
    error("tabs.ungroup failed", ids, err);
    return false;
  }
}

/** Remove (close) one or more tabs. Best-effort. */
export async function removeTabs(tabIds) {
  const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
  if (ids.length === 0) {
    return true;
  }
  try {
    await chrome.tabs.remove(ids);
    return true;
  } catch (err) {
    error("tabs.remove failed", ids, err);
    return false;
  }
}

/** Dedupe + keep only integer tab ids. Guards the group APIs from bad input. */
function sanitizeTabIds(tabIds) {
  return [...new Set(tabIds)].filter((id) => Number.isInteger(id));
}

/**
 * Add tabs to an existing group. If Chrome rejects moving already-grouped tabs
 * directly, ungroup them, let the strip settle, and retry once.
 * @returns {Promise<{ added: number, failed: number }>}
 */
export async function addTabsToGroup(groupId, tabIds) {
  const ids = sanitizeTabIds(tabIds);
  if (ids.length === 0) {
    return { added: 0, failed: 0 };
  }
  try {
    await chrome.tabs.group({ groupId, tabIds: ids });
    return { added: ids.length, failed: 0 };
  } catch (firstErr) {
    debug("group() rejected, retrying after ungroup", groupId, ids, firstErr?.message);
    await ungroupTabs(ids);
    await sleep(80);
    try {
      await chrome.tabs.group({ groupId, tabIds: ids });
      return { added: ids.length, failed: 0 };
    } catch (secondErr) {
      error("addTabsToGroup failed after retry", groupId, ids, secondErr);
      return { added: 0, failed: ids.length };
    }
  }
}

/**
 * Create a new group in a window from the given tabs, with one retry.
 * @returns {Promise<number | null>} new group id, or null on failure
 */
export async function createGroup(windowId, tabIds) {
  const ids = sanitizeTabIds(tabIds);
  if (ids.length === 0) {
    return null;
  }
  try {
    return await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
  } catch (firstErr) {
    debug("create group() rejected, retrying after ungroup", windowId, ids, firstErr?.message);
    await ungroupTabs(ids);
    await sleep(80);
    try {
      return await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
    } catch (secondErr) {
      error("createGroup failed after retry", windowId, ids, secondErr);
      return null;
    }
  }
}
