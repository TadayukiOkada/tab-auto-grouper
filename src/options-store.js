// Settings persistence and normalization. Owns the single source of truth for
// how raw stored data becomes a well-formed options object.

import {
  STORAGE_KEY,
  SCHEMA_VERSION,
  DEFAULT_OPTIONS,
  GROUP_COLORS,
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
import { extensionApi } from "./runtime.js";

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
    color: oneOf(rule.color, GROUP_COLORS, "grey"),
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

  const rules = Array.isArray(stored.rules)
    ? stored.rules.filter(isPlainObject).map(normalizeRule)
    : base.rules;
  // Catch-all rules always sort/pack last (an import can place one mid-array).
  rules.sort((a, b) => Boolean(a.catchAll) - Boolean(b.catchAll));

  const merged = {
    schemaVersion: SCHEMA_VERSION,
    rules,
    activeWindowOnly: Boolean(stored.activeWindowOnly ?? base.activeWindowOnly),
    collapseGroups: Boolean(stored.collapseGroups ?? base.collapseGroups),
    closeDuplicateScope: oneOf(stored.closeDuplicateScope, ENUMS.DUPLICATE_SCOPES, base.closeDuplicateScope),
    duplicateMatch: oneOf(stored.duplicateMatch, ENUMS.DUPLICATE_MATCH_MODES, base.duplicateMatch),
    skipPinnedTabs: Boolean(stored.skipPinnedTabs ?? base.skipPinnedTabs),
    sortAfterGrouping: Boolean(stored.sortAfterGrouping ?? base.sortAfterGrouping),
    groupPosition: oneOf(stored.groupPosition, ENUMS.GROUP_POSITIONS, base.groupPosition),
    tabSortMethod: oneOf(stored.tabSortMethod, ENUMS.TAB_SORT_METHODS, base.tabSortMethod)
  };

  return merged;
}

/**
 * Read options, preferring local storage. Transparently migrates settings
 * written by older versions that used sync storage.
 * @returns {Promise<typeof DEFAULT_OPTIONS>}
 */
export async function getOptions() {
  const local = await extensionApi.storage.local.get(STORAGE_KEY);
  if (local?.[STORAGE_KEY]) {
    return mergeOptions(local[STORAGE_KEY]);
  }

  try {
    const sync = await extensionApi.storage.sync.get(STORAGE_KEY);
    if (sync?.[STORAGE_KEY]) {
      const migrated = mergeOptions(sync[STORAGE_KEY]);
      await extensionApi.storage.local.set({ [STORAGE_KEY]: migrated });
      debug("migrated settings from sync to local storage");
      return migrated;
    }
  } catch (err) {
    // sync storage can be disabled/unavailable (some Firefox configurations);
    // don't let a failed legacy-migration read break every action.
    debug("storage.sync read failed, skipping migration", err?.message);
  }

  return mergeOptions(null);
}

/**
 * Validate, normalize, and persist options to local storage.
 * Throws ValidationError on invalid rules or oversized payloads.
 * @param {unknown} options
 * @returns {Promise<typeof DEFAULT_OPTIONS>}
 */
export async function saveOptions(options) {
  // Validate the raw input before mergeOptions' lenient normalization, which
  // would otherwise fall back to the default rules for a missing `rules`
  // array, coerce invalid colors to grey, and drop malformed rule entries.
  if (!isPlainObject(options)) {
    throw new ValidationError("Settings must be a JSON object.");
  }
  if (!Array.isArray(options.rules)) {
    throw new ValidationError('Settings must include a "rules" array.');
  }
  validateRules(options.rules);
  const normalized = mergeOptions(options);

  const payload = JSON.stringify({ [STORAGE_KEY]: normalized });
  const payloadBytes = new TextEncoder().encode(payload).length;
  if (payloadBytes > LOCAL_STORAGE_QUOTA_BYTES) {
    throw new ValidationError(
      `Settings exceed the local storage limit (${payloadBytes} / ${LOCAL_STORAGE_QUOTA_BYTES} bytes). ` +
        "Reduce the number of rules or keywords."
    );
  }

  await extensionApi.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

/**
 * Reset to defaults and clear any legacy synced copy.
 * @returns {Promise<typeof DEFAULT_OPTIONS>}
 */
export async function resetOptions() {
  const defaults = clone(DEFAULT_OPTIONS);
  await extensionApi.storage.local.set({ [STORAGE_KEY]: defaults });
  try {
    await extensionApi.storage.sync.remove(STORAGE_KEY);
  } catch {
    // Legacy cleanup is best-effort.
  }
  return defaults;
}
