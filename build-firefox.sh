#!/usr/bin/env bash
# Assembles a real (non-symlinked) directory for loading this extension in
# Firefox. Both Chrome and Firefox refuse to follow symlinks that point
# outside the loaded extension directory, so the Firefox variant can't just
# symlink back to the root source files the way a bundler-based project
# might — this script copies them instead. Re-run it after editing any
# shared file (background.js, popup.*, options.*, shared.js, src/, icons/)
# and before reloading in Firefox.
set -euo pipefail
cd "$(dirname "$0")"

OUT="firefox-build"
rm -rf "$OUT"
mkdir -p "$OUT"

cp background.js popup.html popup.js popup.css options.html options.js options.css shared.js "$OUT"/
cp -r src icons "$OUT"/
cp manifest.firefox.json "$OUT/manifest.json"

echo "Firefox build ready: $OUT/manifest.json"
echo "  about:debugging#/runtime/this-firefox -> Load Temporary Add-on -> select $OUT/manifest.json"
if command -v web-ext >/dev/null 2>&1; then
  echo "  or: web-ext run --source-dir=$OUT"
fi
