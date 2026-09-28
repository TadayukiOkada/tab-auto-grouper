# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tab Auto Grouper is a Chrome Manifest V3 extension (vanilla JS, ES modules, no bundler, no build step, no package.json, no test framework). Loading it is simply `chrome://extensions` → Developer mode → Load unpacked → select this folder.

## Workflow (no build/test commands exist)

- There is nothing to install, build, lint, or test — there's no `package.json`. Edit the `.js`/`.html`/`.css` files directly.
- To try a change: open `chrome://extensions`, enable Developer mode, "Load unpacked" on this folder (or click the reload icon on the extension if already loaded). Background script changes require reloading the extension; popup/options changes just need reopening the popup/options page.
- To debug the service worker: `chrome://extensions` → this extension → "Service worker" link opens its console. Diagnostic logging is off by default; enable it at runtime with `TabAutoGrouper.setDebug(true)` in that console (persisted in `chrome.storage.local`; errors always log regardless).
- `dist/` holds a manually produced release zip and is gitignored — not part of the source build.
- Bump `version` in `manifest.json` when shipping a release-worthy change (see recent commit history for the pattern, e.g. "Bump version to 0.1.3").

## Architecture

Logic lives under `src/` as small, single-purpose ES modules with a strict dependency direction (later modules import earlier ones, never the reverse):

```
constants.js  → data only (default rules/options, enums, storage quota)
logger.js     → debug-flag-gated logging (used almost everywhere)
url-utils.js  → pure URL/hostname/domain-pattern helpers, no Chrome APIs
validation.js → rule/options validation and type guards
options-store.js → reads/normalizes/validates/persists settings (chrome.storage.local)
classifier.js → matches a tab to a rule; builds the default sort key
tab-sort.js   → comparators for the selectable tab sort methods (default/url/recency/title)
chrome-api.js → thin defensive wrapper over chrome.tabs/tabGroups/windows
groups.js     → finding/merging/packing/internally-sorting tab groups (uses chrome-api.js)
reconcile.js  → target-tab selection, stale-tab ungrouping, collapsing
actions.js    → top-level actions: groupTabs, sortTabs, closeDuplicateTabs, getPreviewTabs
```

`shared.js` is a barrel that re-exports the public API from `src/`, so `background.js`, `options.js`, and `popup.js` all import from `./shared.js` for a single stable surface. New code may import a `src/` module directly instead.

### Message flow

`popup.js` resolves `chrome.windows.getCurrent()` itself (it has a real window context) and sends `{ type, payload: { ...payload, windowId } }` via `chrome.runtime.sendMessage`. `background.js`'s `onMessage` listener dispatches by `type` to the matching action in `src/actions.js` and replies `{ ok, result }` or `{ ok: false, error }`. The keyboard shortcut (`chrome.commands`) calls `groupTabs` directly with the windowId Chrome hands it.

**Never call `chrome.windows.getCurrent()` or use `{ currentWindow: true }` from the service worker** — it has no window of its own and resolution is unreliable there. Every action takes an explicit `windowId` resolved by the caller (popup or commands listener). See the popup's cold-start retry: a fresh service worker can miss the first `sendMessage` ("Receiving end does not exist"), so the popup retries once after a short delay.

### Classification and matching

- `classifyTab` (classifier.js) returns the first non-catch-all rule whose domains/URL-substrings/title-keywords match; catch-all rules (`rule.catchAll: true`) are evaluated last regardless of position in the rules array.
- Title keyword matching enforces word boundaries only for Latin/digit characters (`WORD_CHAR` regex) — `"ira"` won't match `"Iran"`, but CJK keywords match as plain substrings since they have no clear word boundaries.
- Domain matching (`domainMatches` in url-utils.js) matches the exact domain and subdomains, and tolerates Chrome match-pattern input like `*://*.github.com/*`.
- Groups are identified by normalized title (`normalizeGroupTitle`: NFKC-normalize, trim, lowercase) rather than by Chrome group id, since a "managed" group is any group whose title matches a rule name — this is how duplicate-titled groups get merged and how existing groups get reused instead of duplicated.
- The sort step (`sortTabs` in actions.js, run standalone or via "sort after grouping") orders both ungrouped tabs and the tabs inside each group using one comparator, chosen by `options.tabSortMethod` via `getTabComparator` (`tab-sort.js`). `groups.js`'s `sortTabsWithinGroups` reorders a group's tabs by moving them within that group's own contiguous index range (never past its boundary), so a tab can't accidentally join a neighboring group during a sort.

### Settings persistence

Settings live in `chrome.storage.local` (not `sync`) under `STORAGE_KEY`, chosen deliberately to avoid `sync`'s small per-item quota for larger rule sets. `options-store.js` transparently migrates any legacy `sync`-stored settings to `local` on first read. `mergeOptions` is lenient (never throws, degrades gracefully for junk/partial input) and is used for every read; `validateRules`/`saveOptions` are strict and used only on explicit save/import, throwing `ValidationError` with a UI-facing message.

### Chrome API defensiveness

`chrome-api.js` centralizes retry logic for group operations that can transiently fail mid-tab-strip-rearrangement (`addTabsToGroup`/`createGroup` retry once after an `ungroupTabs` + short sleep if Chrome rejects the initial `group()` call). Group *moves* trust Chrome to snap out-of-range indices rather than re-verifying and retrying, per a comment in `packGroups` — an earlier verify-and-retry approach caused group moves to wedge.

### Options UI

`options.js`/`options.html`/`options.css` implement a field-based rule editor (name, color, domains, URL substrings, title keywords, reordering, catch-all toggle) plus a `Behavior` settings section, JSON export/import (also accepts a bare JSON array of rules), and calls into `shared.js` for validation/persistence.
