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

/** Whether a normalized host is a literal IPv4 or IPv6 address rather than a domain name. */
function isIpAddress(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/**
 * The registrable-ish domain of a hostname: its last two labels (e.g.
 * "google.com" from "docs.google.com"). Not a real eTLD+1 (it doesn't know
 * about multi-part public suffixes like "co.uk"), but enough to cluster
 * same-site tabs together when sorting by URL. IP addresses are returned
 * as-is rather than being sliced into a bogus last-two-labels "domain"
 * (e.g. "1.10" from "192.168.1.10").
 * @param {string} hostname
 * @returns {string}
 */
export function registrableDomain(hostname) {
  const host = normalizeHost(hostname);
  if (isIpAddress(host)) {
    return host;
  }
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}

/**
 * Sort key for the "url" tab sort method: orders by domain first (so
 * subdomains of the same site cluster together), then by full subdomain
 * within that domain, then by path/query/hash. Non-web URLs fall back to the
 * lowercased raw string.
 * @param {string} url
 * @returns {string}
 */
export function urlSortKey(url) {
  const parsed = parseUrl(url || "");
  if (!parsed) {
    return String(url || "").toLowerCase();
  }
  const domain = registrableDomain(parsed.hostname);
  const host = normalizeHost(parsed.hostname);
  const path = parsed.pathname + parsed.search + parsed.hash;
  return `${domain}|${host}|${path}`.toLowerCase();
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
