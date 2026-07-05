// Settings persistence and normalization. Owns the single source of truth for
// how raw stored data becomes a well-formed options object.

import {
  STORAGE_KEY,
  SCHEMA_VERSION,
  DEFAULT_OPTIONS,
  LOCAL_STORAGE_QUOTA_BYTES
} from "./constants.js";
import {
  isPlainObject,
  toStringArray,
  validateRules,
  oneOf,
  ENUMS,
  ValidationError
} from "./validation.js";
import { debug } from "./logger.js";

/** Deep clone via structured JSON. Options are plain data, so this is safe. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Normalize a single rule into a consistent shape: known fields only, arrays
 * coerced to clean string arrays, color defaulted to grey.
 */
function normalizeRule(rule) {
  return {
    name: typeof rule.name === "string" ? rule.name.trim() : "",
    color: typeof rule.color === "string" ? rule.color : "grey",
    domains: toStringArray(rule.domains),
    urlIncludes: toStringArray(rule.urlIncludes),
    titleKeywords: toStringArray(rule.titleKeywords),
    catchAll: Boolean(rule.catchAll)
  };
}

/**
 * Merge arbitrary stored data over defaults, sanitizing enum-like fields and
 * normalizing rules. Never throws — returns a usable options object even for
 * junk input, so the extension degrades gracefully. (Strict validation is a
 * separate step used on save/import.)
 * @param {unknown} stored
 * @returns {typeof DEFAULT_OPTIONS}
 */
export function mergeOptions(stored) {
  const base = clone(DEFAULT_OPTIONS);
  if (!isPlainObject(stored)) {
    return base;
  }

  const rules = Array.isArray(stored.rules) && stored.rules.length > 0
    ? stored.rules.filter(isPlainObject).map(normalizeRule)
    : base.rules;

  const merged = {
    schemaVersion: SCHEMA_VERSION,
    rules,
    activeWindowOnly: Boolean(stored.activeWindowOnly ?? base.activeWindowOnly),
    // Pre-schema-v2 data had no collapseGroups; default it on.
    collapseGroups: stored.schemaVersion ? Boolean(stored.collapseGroups) : true,
    closeDuplicateScope: oneOf(stored.closeDuplicateScope, ENUMS.DUPLICATE_SCOPES, base.closeDuplicateScope),
    duplicateMatch: oneOf(stored.duplicateMatch, ENUMS.DUPLICATE_MATCH_MODES, base.duplicateMatch),
    skipPinnedTabs: Boolean(stored.skipPinnedTabs ?? base.skipPinnedTabs),
    sortAfterGrouping: Boolean(stored.sortAfterGrouping ?? base.sortAfterGrouping),
    groupPosition: oneOf(stored.groupPosition, ENUMS.GROUP_POSITIONS, base.groupPosition)
  };

  return merged;
}

/**
 * Read options, preferring chrome.storage.local. Transparently migrates
 * settings written by older versions that used chrome.storage.sync.
 * @returns {Promise<typeof DEFAULT_OPTIONS>}
 */
export async function getOptions() {
  const local = await chrome.storage.local.get(STORAGE_KEY);
  if (local?.[STORAGE_KEY]) {
    return mergeOptions(local[STORAGE_KEY]);
  }

  const sync = await chrome.storage.sync.get(STORAGE_KEY);
  if (sync?.[STORAGE_KEY]) {
    const migrated = mergeOptions(sync[STORAGE_KEY]);
    await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
    debug("migrated settings from sync to local storage");
    return migrated;
  }

  return mergeOptions(null);
}

/**
 * Validate, normalize, and persist options to chrome.storage.local.
 * Throws ValidationError on invalid rules or oversized payloads.
 * @param {unknown} options
 * @returns {Promise<typeof DEFAULT_OPTIONS>}
 */
export async function saveOptions(options) {
  const normalized = mergeOptions(options);
  validateRules(normalized.rules);

  const payload = JSON.stringify({ [STORAGE_KEY]: normalized });
  if (payload.length > LOCAL_STORAGE_QUOTA_BYTES) {
    throw new ValidationError(
      `Settings exceed the local storage limit (${payload.length} / ${LOCAL_STORAGE_QUOTA_BYTES} bytes). ` +
        "Reduce the number of rules or keywords."
    );
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

/**
 * Reset to defaults and clear any legacy synced copy.
 * @returns {Promise<typeof DEFAULT_OPTIONS>}
 */
export async function resetOptions() {
  const defaults = clone(DEFAULT_OPTIONS);
  await chrome.storage.local.set({ [STORAGE_KEY]: defaults });
  try {
    await chrome.storage.sync.remove(STORAGE_KEY);
  } catch {
    // Legacy cleanup is best-effort.
  }
  return defaults;
}
