// Barrel module: re-exports the public API from the refactored src/ modules.
//
// This preserves the original single-entry import surface so background.js,
// options.js, and popup.js can import from "./shared.js" as before. New code
// may import directly from the specific src/ modules instead.

export {
  STORAGE_KEY,
  SCHEMA_VERSION,
  GROUP_COLORS,
  GROUP_POSITIONS,
  DUPLICATE_MATCH_MODES,
  DUPLICATE_SCOPES,
  DEFAULT_RULES,
  DEFAULT_OPTIONS
} from "./src/constants.js";

export { classifyTab, tabSortKey } from "./src/classifier.js";

export { getOptions, saveOptions, resetOptions, mergeOptions } from "./src/options-store.js";

export { validateRules, validateRule, ValidationError } from "./src/validation.js";

export { groupTabs, sortTabs, closeDuplicateTabs, getPreviewTabs } from "./src/actions.js";

export { setDebug, isDebugEnabled, initDebugFlag } from "./src/logger.js";
