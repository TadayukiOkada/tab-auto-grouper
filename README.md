# Tab Auto Grouper

A small Chrome Manifest V3 extension that groups tabs by local rules.

## Features

- Group tabs into Chrome tab groups by domain, URL substring, or title keyword.
- Reuses existing groups with the same name instead of creating duplicates, and merges duplicate-titled groups automatically.
- Default groups for Email, Social Media, Video & Streaming, Shopping, News, Docs & Productivity, Dev & Coding, and AI Tools.
- Close duplicate tabs.
- Sort tabs: ungrouped tabs and tab groups are arranged left-to-right; tab groups can be pinned to either the left or right side (see Options below).
- Edit rules with a field-based editor on the options page (name, color, domains, URL substrings, title keywords, with reordering).
- Export all settings to a JSON file and import them back.
- Everything runs locally in Chrome. No network calls are made.

## Install

1. Open `chrome://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select this `tab-auto-grouper` folder.

## Use

Click the extension icon and choose:

- `Group tabs`: groups matching tabs. Tabs are added to existing groups with matching names.
- `Sort active window`: arranges tab groups (in rule order) on the left or right side of the tab strip — see `Group position when sorting` below — and sorts ungrouped tabs on the other side by domain and title.
- `Close duplicates`: closes duplicate tabs according to the settings.

The default shortcut for grouping is `Alt+Shift+G`. Chrome may ask you to confirm or change it at `chrome://extensions/shortcuts`.

Groups are collapsed by default after grouping. Pinned tabs are skipped by default because Chrome keeps pinned tabs outside normal tab groups.

## Options

The options page has a `Behavior` section with these settings:

- **Group only the active window** — limit `Group tabs` and `Sort active window` to the current window instead of all windows.
- **Collapse groups after creating them**.
- **Sort tabs after grouping** — run the sort step automatically whenever `Group tabs` runs.
- **Leave pinned tabs untouched**.
- **Group position when sorting** — `Left side` (default) packs tab groups right after any pinned tabs, in rule order, with ungrouped tabs following after them. `Right side` places all tab groups at the right end of the tab strip instead, with ungrouped tabs on the left.

## Rules

Rules are evaluated from top to bottom and edited on the options page. Each rule has:

- **Name** — the tab group title (must be unique).
- **Color** — one of `grey`, `blue`, `red`, `yellow`, `green`, `pink`, `purple`, `cyan`, `orange`.
- **Domains** — comma-separated. Matches the exact domain and its subdomains (`github.com` matches `docs.github.com`). Chrome-style patterns such as `*://*.github.com/*` are also accepted.
- **URL contains** — comma-separated substrings matched against the full URL.
- **Title keywords** — comma-separated substrings matched against the tab title (case-insensitive).

## Backup

Settings are stored in `chrome.storage.local` so larger rule sets are not constrained by the small per-item quota of `chrome.storage.sync`. Use `Export settings (JSON)` on the options page to move settings between Chrome profiles or machines, and `Import settings` to restore them. The importer also accepts a bare JSON array of rules.

## Project structure

The extension logic is split into focused ES modules under `src/`:

- `constants.js` — default rules, default options, and enum/quota constants (data only).
- `logger.js` — debug-flag-gated logging.
- `url-utils.js` — URL, hostname, and domain-pattern helpers (pure functions).
- `validation.js` — rule/type validation and small type guards.
- `options-store.js` — reading, normalizing, validating, and persisting settings.
- `classifier.js` — matching a tab to a rule and building sort keys.
- `chrome-api.js` — a thin, defensive wrapper over the Chrome tabs/tabGroups/windows APIs.
- `groups.js` — finding, merging, and packing tab groups.
- `reconcile.js` — target-tab selection, stale-tab ungrouping, and collapsing.
- `actions.js` — the top-level actions (`groupTabs`, `sortTabs`, `closeDuplicateTabs`, `getPreviewTabs`).

`shared.js` is a thin barrel that re-exports the public API, so `background.js`, `options.js`, and `popup.js` keep a single import surface.

All actions receive an explicit `windowId` (resolved by the popup, which has a real associated window) rather than calling `chrome.windows.getCurrent()` from the service worker, which cannot reliably resolve the active window.

## Debugging

Diagnostic logging is off by default. To turn it on, open the extension's Service Worker console from `chrome://extensions` and run:

```js
TabAutoGrouper.setDebug(true)
```

The choice is persisted in `chrome.storage.local`. Set it back to `false` to silence the logs. Errors are always logged regardless of this flag.
