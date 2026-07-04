// Centralized constants and default configuration for Tab Auto Grouper.
//
// This module holds only data — no behavior — so it can be imported by any
// other module without creating circular dependencies.

/** Storage key under which all extension settings are persisted. */
export const STORAGE_KEY = "tabAutoGrouperOptions";

/** Current settings schema version. Bump when the shape of stored options changes. */
export const SCHEMA_VERSION = 2;

/** Valid Chrome tab group colors (chrome.tabGroups.ColorEnum). */
export const GROUP_COLORS = Object.freeze([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange"
]);

/** Where grouped tabs are packed relative to ungrouped tabs when sorting. */
export const GROUP_POSITIONS = Object.freeze(["left", "right"]);

/** How duplicate tabs are matched when closing duplicates. */
export const DUPLICATE_MATCH_MODES = Object.freeze(["exact", "withoutHash", "withoutHashOrQuery"]);

/** Scope options for the close-duplicates action. */
export const DUPLICATE_SCOPES = Object.freeze(["allWindows", "activeWindow"]);

/**
 * chrome.storage.local's default quota is 5,242,880 bytes (5 MiB) unless the
 * "unlimitedStorage" permission is granted, which this extension does not
 * request. Leave a safety margin below that for other extension data and for
 * the JSON overhead of nested rule arrays.
 */
export const LOCAL_STORAGE_QUOTA_BYTES = 4_500_000;

/** Default grouping rules shipped with the extension. */
export const DEFAULT_RULES = Object.freeze([
  {
    name: "Email",
    color: "blue",
    domains: ["mail.google.com", "outlook.live.com", "outlook.office.com", "mail.yahoo.com", "protonmail.com"],
    urlIncludes: [],
    titleKeywords: []
  },
  {
    name: "Social Media",
    color: "purple",
    domains: ["x.com", "twitter.com", "facebook.com", "instagram.com", "reddit.com", "linkedin.com", "tiktok.com"],
    urlIncludes: [],
    titleKeywords: []
  },
  {
    name: "Video & Streaming",
    color: "red",
    domains: ["youtube.com", "netflix.com", "twitch.tv", "hulu.com", "disneyplus.com", "primevideo.com"],
    urlIncludes: [],
    titleKeywords: []
  },
  {
    name: "Shopping",
    color: "orange",
    domains: ["amazon.com", "ebay.com", "etsy.com", "walmart.com", "target.com"],
    urlIncludes: [],
    titleKeywords: []
  },
  {
    name: "News",
    color: "yellow",
    domains: ["nytimes.com", "bbc.com", "cnn.com", "reuters.com", "theverge.com", "techcrunch.com"],
    urlIncludes: [],
    titleKeywords: []
  },
  {
    name: "Docs & Productivity",
    color: "green",
    domains: ["docs.google.com", "sheets.google.com", "slides.google.com", "drive.google.com", "notion.so", "dropbox.com", "office.com"],
    urlIncludes: [],
    titleKeywords: []
  },
  {
    name: "Dev & Coding",
    color: "cyan",
    domains: ["github.com", "gist.github.com", "gitlab.com", "stackoverflow.com", "developer.mozilla.org", "npmjs.com", "pypi.org"],
    urlIncludes: [],
    titleKeywords: []
  },
  {
    name: "AI Tools",
    color: "pink",
    domains: ["chatgpt.com", "claude.ai", "openai.com", "gemini.google.com", "perplexity.ai", "huggingface.co"],
    urlIncludes: [],
    titleKeywords: []
  }
]);

/** Default settings object. */
export const DEFAULT_OPTIONS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  rules: DEFAULT_RULES,
  activeWindowOnly: false,
  collapseGroups: true,
  closeDuplicateScope: "allWindows",
  duplicateMatch: "withoutHash",
  skipPinnedTabs: true,
  sortAfterGrouping: true,
  groupPosition: "left"
});
