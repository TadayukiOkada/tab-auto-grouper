// URL, hostname, and domain-pattern helpers. Pure functions with no Chrome
// or storage dependencies, so they're trivially testable in isolation.

/**
 * Lowercase a hostname and drop a leading "www." so comparisons are stable.
 * @param {string} hostname
 * @returns {string}
 */
export function normalizeHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

/**
 * Normalize a group title for identity comparison: NFKC-normalized, trimmed,
 * lowercased. Used everywhere a group is matched to a rule by name so that
 * case/width/whitespace differences never cause a managed group to be treated
 * as unmanaged (or vice versa).
 * @param {string} title
 * @returns {string}
 */
export function normalizeGroupTitle(title) {
  return String(title || "").normalize("NFKC").trim().toLowerCase();
}

/**
 * The best-known URL for a tab, preferring pendingUrl (set during navigation
 * before url is committed) so classification works on not-yet-loaded tabs.
 * @param {chrome.tabs.Tab} tab
 * @returns {string}
 */
export function getTabUrl(tab) {
  return tab?.pendingUrl || tab?.url || "";
}

/**
 * Parse a URL, returning a URL object only for http(s) schemes. Non-web
 * schemes (chrome:, file:, about:, etc.) and invalid input return null so
 * callers can skip them uniformly.
 * @param {string} url
 * @returns {URL | null}
 */
export function parseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
}

/**
 * Reduce a user-entered domain pattern to a bare, comparable hostname.
 * Handles Chrome match-pattern prefixes ("*://*.github.com/*"), explicit
 * schemes, ports, and paths by leaning on the URL parser, with a defensive
 * regex fallback for inputs the parser rejects.
 * @param {string} domain
 * @returns {string}
 */
export function normalizeDomainPattern(domain) {
  let wanted = String(domain || "").trim().toLowerCase();
  if (!wanted) {
    return "";
  }
  // Strip Chrome match-pattern glob prefixes like "*://*." and any scheme.
  wanted = wanted.replace(/^\*:\/\/(\*\.)?/, "").replace(/^[a-z]+:\/\//, "");
  try {
    const parsed = new URL("https://" + wanted);
    return parsed.hostname.replace(/^www\./, "").replace(/^\*\./, "");
  } catch {
    return wanted
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .replace(/^www\./, "")
      .replace(/^\*\./, "");
  }
}

/**
 * Whether a hostname matches a domain pattern, including subdomains
 * ("github.com" matches "docs.github.com").
 * @param {string} hostname
 * @param {string} domain
 * @returns {boolean}
 */
export function domainMatches(hostname, domain) {
  const host = normalizeHost(hostname);
  const wanted = normalizeDomainPattern(domain);
  if (!wanted) {
    return false;
  }
  return host === wanted || host.endsWith("." + wanted);
}

/**
 * Produce a canonical key for duplicate detection based on the chosen match
 * mode. Returns null for non-web URLs so they're never treated as duplicates.
 * @param {string} url
 * @param {"exact"|"withoutHash"|"withoutHashOrQuery"} mode
 * @returns {string | null}
 */
export function normalizeDuplicateUrl(url, mode) {
  const parsed = parseUrl(url || "");
  if (!parsed) {
    return null;
  }
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = normalizeHost(parsed.hostname);
  if (mode === "withoutHash" || mode === "withoutHashOrQuery") {
    parsed.hash = "";
  }
  if (mode === "withoutHashOrQuery") {
    parsed.search = "";
  }
  return parsed.href;
}
