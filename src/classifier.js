// Tab classification: deciding which rule (if any) a tab belongs to, and
// producing a stable sort key for ungrouped tabs.

import { parseUrl, getTabUrl, normalizeHost, domainMatches } from "./url-utils.js";

// Latin letters/digits/underscore count as "word" characters. CJK text has no
// clear word boundaries, so it is deliberately not included here.
const WORD_CHAR = /[\p{Script=Latin}\p{N}_]/u;

/**
 * Substring match on a title, but where the keyword starts/ends with a word
 * character, it must not be embedded in a longer word (so "ira" does not match
 * "Iran"). Keyword edges that are non-Latin (e.g. Japanese) match as substrings.
 * @param {string} title lowercased title
 * @param {string} keyword lowercased keyword
 * @returns {boolean}
 */
function titleHasKeyword(title, keyword) {
  if (!keyword) {
    return false;
  }
  const checkStart = WORD_CHAR.test(keyword[0]);
  const checkEnd = WORD_CHAR.test(keyword[keyword.length - 1]);
  let from = 0;
  for (;;) {
    const index = title.indexOf(keyword, from);
    if (index === -1) {
      return false;
    }
    const before = title.slice(0, index).slice(-1);
    const after = title.charAt(index + keyword.length);
    const startOk = !checkStart || !before || !WORD_CHAR.test(before);
    const endOk = !checkEnd || !after || !WORD_CHAR.test(after);
    if (startOk && endOk) {
      return true;
    }
    from = index + 1;
  }
}

/**
 * Find the first rule that matches a tab, or null if none do.
 *
 * Rules with `catchAll: true` always match, but are evaluated LAST regardless
 * of their position in the `rules` array — this means a catch-all rule can't
 * accidentally swallow tabs that a later, more specific rule would have
 * caught, even if it's accidentally not placed at the bottom of the list.
 *
 * @param {chrome.tabs.Tab} tab
 * @param {Array<object>} rules
 * @returns {object | null}
 */
export function classifyTab(tab, rules) {
  const parsed = parseUrl(getTabUrl(tab));
  if (!parsed) {
    return null;
  }

  const url = parsed.href.toLowerCase();
  const title = (tab.title || "").toLowerCase();
  let catchAllRule = null;

  for (const rule of rules) {
    if (rule.catchAll) {
      // Remember the first catch-all rule, but keep checking specific rules first.
      if (!catchAllRule) {
        catchAllRule = rule;
      }
      continue;
    }

    const domains = Array.isArray(rule.domains) ? rule.domains : [];
    const urlIncludes = Array.isArray(rule.urlIncludes) ? rule.urlIncludes : [];
    const titleKeywords = Array.isArray(rule.titleKeywords) ? rule.titleKeywords : [];

    const matches =
      domains.some((domain) => domainMatches(parsed.hostname, domain)) ||
      urlIncludes.some((needle) => url.includes(String(needle).toLowerCase())) ||
      titleKeywords.some((keyword) => titleHasKeyword(title, String(keyword).toLowerCase()));

    if (matches) {
      return rule;
    }
  }

  return catchAllRule;
}

/**
 * Build a sort key for an ungrouped tab so that tabs cluster by rule, then by
 * host, then by title. Tabs matching no rule sort last (the "zzz" sentinel).
 * @param {chrome.tabs.Tab} tab
 * @param {Array<object>} rules
 * @returns {string}
 */
export function tabSortKey(tab, rules) {
  const rule = classifyTab(tab, rules);
  const parsed = parseUrl(getTabUrl(tab));
  const ruleIndex = rule ? rules.findIndex((item) => item.name === rule.name) : rules.length;
  const groupName = rule ? rule.name : "zzz-ungrouped";
  const host = parsed ? normalizeHost(parsed.hostname) : "";
  const title = (tab.title || "").toLowerCase();
  return `${String(ruleIndex).padStart(3, "0")}|${groupName}|${host}|${title}`;
}
