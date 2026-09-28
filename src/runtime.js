// Resolves the WebExtension API namespace for whichever browser is running.
//
// Firefox exposes a promise-native `browser` global. Chrome only exposes
// `chrome`, but its tabs/tabGroups/storage/windows/runtime methods have also
// returned promises (when called without a callback) since Manifest V3, so
// using it the same way as `browser` works without a compatibility layer.
// Every other module talks to the browser through this single export instead
// of referencing `chrome`/`browser` directly, so it's the only place that
// needs to know which one is present.
export const extensionApi = typeof browser !== "undefined" ? browser : chrome;
