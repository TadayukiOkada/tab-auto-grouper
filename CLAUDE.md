# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tab Auto Grouper is a Manifest V3 browser extension (vanilla JS, ES modules, no bundler, no build step, no package.json, no test framework) that runs on both Chrome and Firefox (140+, for `tabGroups` support and the `data_collection_permissions` manifest key) from one source tree. Loading it on Chrome is `chrome://extensions` → Developer mode → Load unpacked → select this folder (root `manifest.json`); on Firefox it's `./build-firefox.sh` then `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `firefox-build/manifest.json` (or `web-ext run --source-dir=firefox-build` if `web-ext` is installed).

## Workflow (no build/test commands exist)

- There is nothing to install, build, lint, or test to work on the extension itself — there's no `package.json`. Edit the `.js`/`.html`/`.css` files directly under the repo root.
- To try a change on Chrome: open `chrome://extensions`, enable Developer mode, "Load unpacked" on this folder (or click the reload icon on the extension if already loaded). Background script changes require reloading the extension; popup/options changes just need reopening the popup/options page.
- To try a change on Firefox: run `./build-firefox.sh` (see "Two manifests" below for why this is needed — it's a plain file copy, not a bundler), then `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" → select `firefox-build/manifest.json`. Firefox unloads temporary add-ons on browser restart, so you'll reload it each session. Re-run `build-firefox.sh` and hit "Reload" on that page to pick up any source change; popup/options changes alone just need reopening.
- To debug the background script: on Chrome, `chrome://extensions` → this extension → "Service worker" link opens its console; on Firefox, `about:debugging#/runtime/this-firefox` → this extension → "Inspect". Diagnostic logging is off by default; enable it at runtime with `TabAutoGrouper.setDebug(true)` in that console (persisted via `extensionApi.storage.local`; errors always log regardless).
- `dist/` holds a manually produced release zip and is gitignored — not part of the source build. `firefox-build/` (also gitignored) is `build-firefox.sh`'s generated output — never edit files there, they get wiped on every run.
- Bump `version` in **both** `manifest.json` and `manifest.firefox.json` together when shipping a release-worthy change (see recent commit history for the pattern, e.g. "Bump version to 0.1.3").

### Two manifests

Chrome hard-rejects a Manifest V3 manifest that declares `background.scripts` at all ("'background.scripts' requires manifest version of 2 or lower"), and Firefox's temporary-add-on loader requires a literal `manifest.json` file in the directory you point it at — so one shared manifest.json isn't possible. Symlinking a `firefox/` subdirectory back to the root source files doesn't work either: both Chrome and Firefox refuse to follow symlinks that resolve outside the loaded extension directory (a deliberate sandbox-escape protection), so a symlinked `popup.html` etc. silently fails to load — this was tried and reverted after it produced a Firefox toolbar icon with no popup. Instead:

- Root `manifest.json` — Chrome's manifest (`background.service_worker`), used directly from the repo root.
- Root `manifest.firefox.json` — Firefox's manifest (`background.scripts` as a non-persistent event page, plus `browser_specific_settings.gecko` pinning `strict_min_version` to 140 — the first release supporting both `tabGroups` (139) and `data_collection_permissions` (140) — and `gecko_android.strict_min_version` to 142, where the latter arrived; AMO warns if either is lower). It is never loaded directly.
- `build-firefox.sh` — a plain-`cp` shell script (no dependencies) that copies `background.js`, `popup.*`, `options.*`, `shared.js`, `src/`, `icons/`, and `manifest.firefox.json` (renamed to `manifest.json`) into a fresh, gitignored `firefox-build/` directory. That directory, not the repo root, is what you point Firefox at. Re-run it after any edit to a shared source file before reloading in Firefox — it's a real-file copy each time, so there's no drift to worry about as long as you always re-run it rather than hand-editing inside `firefox-build/`.

## Architecture

Logic lives under `src/` as small, single-purpose ES modules with a strict dependency direction (later modules import earlier ones, never the reverse):

```
runtime.js    → resolves the WebExtension API namespace (browser on Firefox, chrome on Chrome)
constants.js  → data only (default rules/options, enums, storage quota)
logger.js     → debug-flag-gated logging (used almost everywhere)
url-utils.js  → pure URL/hostname/domain-pattern helpers, no browser APIs
validation.js → rule/options validation and type guards
options-store.js → reads/normalizes/validates/persists settings (extensionApi.storage.local)
classifier.js → matches a tab to a rule; builds the default sort key
tab-sort.js   → comparators for the selectable tab sort methods (default/url/recency/title)
chrome-api.js → thin defensive wrapper over extensionApi.tabs/tabGroups/windows (Chrome and Firefox)
groups.js     → finding/merging/packing/internally-sorting tab groups (uses chrome-api.js)
reconcile.js  → target-tab selection, stale-tab ungrouping, collapsing
actions.js    → top-level actions: groupTabs, sortTabs, closeDuplicateTabs, getPreviewTabs
```

### Cross-browser support

Every module that talks to the browser goes through `extensionApi` (`src/runtime.js`: `typeof browser !== "undefined" ? browser : chrome`) instead of referencing `chrome`/`browser` globals directly — `runtime.js` is the only place that needs to know which browser is running. This works because Firefox's `browser.*` namespace is promise-native, and Chrome's `chrome.*` namespace has also returned promises (when called without a callback) since Manifest V3, so no separate polyfill is needed. The only per-browser difference is the manifest itself (see "Two manifests" above). Don't add a Chrome-only or Firefox-only code path without a good reason — the point of `runtime.js` is that the rest of the codebase shouldn't need one.

`shared.js` is a barrel that re-exports the public API from `src/`, giving callers a single stable surface if they want it — `options.js` imports from `./shared.js`. `background.js` and `popup.js` import directly from the specific `src/` modules they need instead; both styles are fine, and new code may use either.

### Message flow

`popup.js` resolves `extensionApi.windows.getCurrent()` itself (it has a real window context) and sends `{ type, payload: { ...payload, windowId } }` via `extensionApi.runtime.sendMessage`. `background.js`'s `onMessage` listener dispatches by `type` to the matching action in `src/actions.js` and replies `{ ok, result }` or `{ ok: false, error }` (returning `true` from the listener to keep the channel open for the async `sendResponse` — supported by both Chrome and Firefox). The keyboard shortcut (`commands` API) calls `groupTabs` directly with the windowId the browser hands it.

**Never call `extensionApi.windows.getCurrent()` or use `{ currentWindow: true }` from the background script** — it has no window of its own and resolution is unreliable there (true for both Chrome's service worker and Firefox's event page). Every action takes an explicit `windowId` resolved by the caller (popup or commands listener). See the popup's cold-start retry: a fresh service worker can miss the first `sendMessage` ("Receiving end does not exist"), so the popup retries once after a short delay.

### Classification and matching

- `classifyTab` (classifier.js) returns the first non-catch-all rule whose domains/URL-substrings/title-keywords match; catch-all rules (`rule.catchAll: true`) are evaluated last regardless of position in the rules array.
- Title keyword matching enforces word boundaries only for Latin/digit characters (`WORD_CHAR` regex) — `"ira"` won't match `"Iran"`, but CJK keywords match as plain substrings since they have no clear word boundaries.
- Domain matching (`domainMatches` in url-utils.js) matches the exact domain and subdomains, and tolerates Chrome-style match-pattern input like `*://*.github.com/*`.
- Groups are identified by normalized title (`normalizeGroupTitle`: NFKC-normalize, trim, lowercase) rather than by the browser's own group id, since a "managed" group is any group whose title matches a rule name — this is how duplicate-titled groups get merged and how existing groups get reused instead of duplicated.
- The sort step (`sortTabs` in actions.js, run standalone or via "sort after grouping") orders both ungrouped tabs and the tabs inside each group using one comparator, chosen by `options.tabSortMethod` via `getTabComparator` (`tab-sort.js`). `groups.js`'s `sortTabsWithinGroups` reorders a group's tabs by moving them within that group's own contiguous index range (never past its boundary), so a tab can't accidentally join a neighboring group during a sort.

### Settings persistence

Settings live in `extensionApi.storage.local` (not `sync`) under `STORAGE_KEY`, chosen deliberately to avoid `sync`'s small per-item quota for larger rule sets. `options-store.js` transparently migrates any legacy `sync`-stored settings to `local` on first read. `mergeOptions` is lenient (never throws, degrades gracefully for junk/partial input) and is used for every read; `validateRules`/`saveOptions` are strict and used only on explicit save/import, throwing `ValidationError` with a UI-facing message.

### Browser API defensiveness

`chrome-api.js` centralizes retry logic for group operations that can transiently fail mid-tab-strip-rearrangement (`addTabsToGroup`/`createGroup` retry once after an `ungroupTabs` + short sleep if the browser rejects the initial `group()` call). Group *moves* trust the browser to snap out-of-range indices rather than re-verifying and retrying, per a comment in `packGroups` — an earlier verify-and-retry approach caused group moves to wedge.

### Options UI

`options.js`/`options.html`/`options.css` implement a field-based rule editor (name, color, domains, URL substrings, title keywords, reordering, catch-all toggle) plus a `Behavior` settings section, JSON export/import (also accepts a bare JSON array of rules), and calls into `shared.js` for validation/persistence.
