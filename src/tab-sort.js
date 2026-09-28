// Comparators for the sort step, selectable via options.tabSortMethod. Used
// both to order ungrouped tabs and to order tabs within each group.

import { tabSortKey } from "./classifier.js";
import { getTabUrl, urlSortKey } from "./url-utils.js";

/**
 * Build a comparator for chrome.tabs.Tab objects for the given sort method.
 * @param {Array<object>} rules
 * @param {"default"|"url"|"recency"|"title"} method
 * @returns {(a: chrome.tabs.Tab, b: chrome.tabs.Tab) => number}
 */
export function getTabComparator(rules, method) {
  switch (method) {
    case "url":
      // Domain, then subdomain, then path/query/hash — not a plain string
      // compare on the full URL, so e.g. docs.example.com and
      // mail.example.com cluster together instead of interleaving with
      // unrelated domains that happen to sort alphabetically between them.
      return (a, b) => urlSortKey(getTabUrl(a)).localeCompare(urlSortKey(getTabUrl(b)));
    case "recency":
      // Most recently accessed first. Tabs without a lastAccessed timestamp
      // (older Chrome versions) sort as if never accessed.
      return (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
    case "title":
      return (a, b) => (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
    case "default":
    default: {
      // tabSortKey classifies the tab against every rule; a plain sort()
      // calls the comparator O(n log n) times, so the same tab gets
      // reclassified repeatedly on a large window. Cache per tab (by
      // reference) for the lifetime of this comparator/sort pass.
      const cache = new WeakMap();
      const keyFor = (tab) => {
        let key = cache.get(tab);
        if (key === undefined) {
          key = tabSortKey(tab, rules);
          cache.set(tab, key);
        }
        return key;
      };
      return (a, b) => keyFor(a).localeCompare(keyFor(b));
    }
  }
}
