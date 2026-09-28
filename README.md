# Tab Auto Grouper

A small Manifest V3 extension that groups tabs by local rules. Works on both Chrome and Firefox (138+) from the same source.

## Features

- Group tabs into native tab groups by domain, URL substring, or title keyword.
- Reuses existing groups with the same name instead of creating duplicates, and merges duplicate-titled groups automatically.
- Default groups for Email, Social Media, Video & Streaming, Shopping, News, Docs & Productivity, Dev & Coding, and AI Tools.
- Close duplicate tabs.
- Sort tabs: ungrouped tabs and tab groups are arranged left-to-right; tab groups can be pinned to either the left or right side (see Options below).
- Edit rules with a field-based editor on the options page (name, color, domains, URL substrings, title keywords, with reordering).
- Optional catch-all group for every tab that doesn't match any rule (off by default). When sorting, the catch-all group is always placed last.
- Export all settings to a JSON file and import them back.
- Everything runs locally. No network calls are made.

## Install

**Chrome:**

1. Open `chrome://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select this `tab-auto-grouper` folder.

**Firefox** (138 or later — earlier versions lack the `tabGroups` WebExtensions API):

1. Run `./build-firefox.sh` from this folder. Chrome and Firefox need different `manifest.json` background declarations and Firefox won't follow symlinks back to shared files, so this script copies the shared source into a `firefox-build/` folder together with `manifest.firefox.json` (renamed to `manifest.json`) — re-run it any time you change a source file.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on…`.
4. Select `firefox-build/manifest.json`.

Firefox unloads temporary add-ons when the browser closes, so you'll need to reload it each session (or package/sign it via [web-ext](https://github.com/mozilla/web-ext) for permanent installs). If you have `web-ext` installed, `web-ext run --source-dir=firefox-build` does steps 2–4 for you and auto-reloads on changes.

## Use

Click the extension icon and choose:

- `Group tabs`: groups matching tabs. Tabs are added to existing groups with matching names.
- `Sort active window`: arranges tab groups (in rule order) on the left or right side of the tab strip — see `Group position when sorting` below — and orders both ungrouped tabs and the tabs inside each group using the selected `Tab sort method`.
- `Close duplicates`: closes duplicate tabs according to the settings.

The default shortcut for grouping is `Alt+Shift+G`. Chrome may ask you to confirm or change it at `chrome://extensions/shortcuts`; on Firefox it's under `about:addons` → gear icon → `Manage Extension Shortcuts`.

Groups are collapsed by default after grouping. Pinned tabs are skipped by default because the browser keeps pinned tabs outside normal tab groups.

## Options

The options page has a `Behavior` section with these settings:

- **Group only the active window** — limit `Group tabs`, its automatic sort-after-grouping step, and the popup's match preview to the current window instead of all windows. `Sort active window` (the standalone button) always scopes to the active window regardless of this setting.
- **Collapse groups after creating them**.
- **Sort tabs after grouping** — run the sort step automatically whenever `Group tabs` runs.
- **Leave pinned tabs untouched** — when off, pinned tabs matching a rule are grouped like any other tab; the browser unpins them to do so.
- **Group position when sorting** — `Left side` (default) packs tab groups right after any pinned tabs, in rule order, with ungrouped tabs following after them. `Right side` places all tab groups at the right end of the tab strip instead, with ungrouped tabs on the left. Groups you created yourself (not backed by a rule) are packed too, after all rule-based groups, in alphabetical order by title.
- **Tab sort method** — how tabs are ordered by `Sort active window` and by "sort after grouping", both within each group and among ungrouped tabs:
  - `Rule, then domain, then title` (default) — the original behavior: tabs cluster by matching rule, then by domain, then by title.
  - `Domain, then subdomain, then path` — clusters tabs by domain first (so `docs.example.com` and `mail.example.com` sort together), then by subdomain, then by the URL's path/query/fragment.
  - `Most recently used first` — most recently active tabs first.
  - `Title (A-Z)` — alphabetical by tab title.

## Rules

Rules are evaluated from top to bottom and edited on the options page. Each rule has:

- **Name** — the tab group title (must be unique).
- **Color** — one of `grey`, `blue`, `red`, `yellow`, `green`, `pink`, `purple`, `cyan`, `orange`.
- **Domains** — comma-separated. Matches the exact domain and its subdomains (`github.com` matches `docs.github.com`). Match-pattern-style values such as `*://*.github.com/*` are also accepted.
- **URL contains** — comma-separated substrings matched against the full URL.
- **Title keywords** — comma-separated substrings matched against the tab title (case-insensitive). Latin keywords match whole words only (`IRA` does not match `Iran`); Japanese/CJK keywords match as plain substrings.

### Catch-all group

At the top of the `Rules` section, `Group all other tabs` (off by default) adds an optional catch-all group for tabs that don't match any rule. When enabled, you can set its name (default `Others`) and color. Any tab not matched by a rule is placed into this group, and when sorting it is always placed after all other groups.

## Backup

Settings are stored in local extension storage (not sync storage) so larger rule sets are not constrained by sync's small per-item quota. Use `Export settings (JSON)` on the options page to move settings between browsers/profiles/machines, and `Import settings` to restore them. The importer also accepts a bare JSON array of rules.

## Project structure

The extension logic is split into focused ES modules under `src/`:

- `runtime.js` — resolves the WebExtension API namespace (`browser` on Firefox, `chrome` on Chrome) so the rest of the codebase doesn't have to.
- `constants.js` — default rules, default options, and enum/quota constants (data only).
- `logger.js` — debug-flag-gated logging.
- `url-utils.js` — URL, hostname, and domain-pattern helpers (pure functions).
- `validation.js` — rule/type validation and small type guards.
- `options-store.js` — reading, normalizing, validating, and persisting settings.
- `classifier.js` — matching a tab to a rule and building the default sort key.
- `tab-sort.js` — comparators for the selectable tab sort methods (default, URL, recency, title).
- `chrome-api.js` — a thin, defensive wrapper over the tabs/tabGroups/windows WebExtensions APIs (works on both Chrome and Firefox via `runtime.js`).
- `groups.js` — finding, merging, packing, and internally sorting tab groups.
- `reconcile.js` — target-tab selection, stale-tab ungrouping, and collapsing.
- `actions.js` — the top-level actions (`groupTabs`, `sortTabs`, `closeDuplicateTabs`, `getPreviewTabs`).

`shared.js` is a thin barrel that re-exports the public API for callers that want a single import surface — `options.js` uses it. `background.js` and `popup.js` import directly from the specific `src/` modules they need instead.

All actions receive an explicit `windowId` (resolved by the popup, which has a real associated window) rather than calling `windows.getCurrent()` from the background script, which cannot reliably resolve the active window there.

`manifest.firefox.json` is Firefox's own manifest (Chrome and Firefox can't share one — see Install above); `build-firefox.sh` assembles it with a copy of the shared source into the gitignored `firefox-build/` folder that Firefox actually loads.

## Debugging

Diagnostic logging is off by default. To turn it on, open the extension's background console (Chrome: "Service worker" link on `chrome://extensions`; Firefox: "Inspect" on `about:debugging#/runtime/this-firefox`) and run:

```js
TabAutoGrouper.setDebug(true)
```

The choice is persisted in local extension storage. Set it back to `false` to silence the logs. Errors are always logged regardless of this flag.
