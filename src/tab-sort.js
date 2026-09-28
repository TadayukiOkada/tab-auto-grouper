// Comparators for the sort step, selectable via options.tabSortMethod. Used
// both to order ungrouped tabs and to order tabs within each group.

import { tabSortKey } from "./classifier.js";
import { getTabUrl } from "./url-utils.js";

/**
 * Build a comparator for chrome.tabs.Tab objects for the given sort method.
 * @param {Array<object>} rules
 * @param {"default"|"url"|"recency"|"title"} method
 * @returns {(a: chrome.tabs.Tab, b: chrome.tabs.Tab) => number}
 */
export function getTabComparator(rules, method) {
  switch (method) {
    case "url":
      return (a, b) => getTabUrl(a).toLowerCase().localeCompare(getTabUrl(b).toLowerCase());
    case "recency":
      // Most recently accessed first. Tabs without a lastAccessed timestamp
      // (older Chrome versions) sort as if never accessed.
      return (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
    case "title":
      return (a, b) => (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
    case "default":
    default:
      return (a, b) => tabSortKey(a, rules).localeCompare(tabSortKey(b, rules));
  }
}
