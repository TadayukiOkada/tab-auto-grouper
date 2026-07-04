const actionButtons = Array.from(document.querySelectorAll(".actions button"));
const countsElement = document.getElementById("counts");
const dedupeButton = document.getElementById("dedupeButton");
const groupButton = document.getElementById("groupButton");
const optionsButton = document.getElementById("optionsButton");
const sortButton = document.getElementById("sortButton");
const statusElement = document.getElementById("status");
const summaryText = document.getElementById("summaryText");

function setBusy(isBusy) {
  actionButtons.forEach((button) => {
    button.disabled = isBusy;
  });
}

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.color = isError ? "#b3261e" : "";
}

// FIX #2: MV3 service workers can be terminated between interactions.
// If the first sendMessage call fails with "Receiving end does not exist",
// wait briefly for the SW to start up and retry once before surfacing the error.
//
// chrome.windows.getCurrent() is called HERE, in the popup's own script
// context, where it reliably resolves to the window the popup is attached
// to. The background service worker has no window of its own, so it must
// not try to resolve "the current window" itself — that is what silently
// broke "Sort"/"Group tabs" when the service worker guessed the wrong
// window. We resolve it once here and send it with every message instead.
let cachedWindowId = null;
async function getPopupWindowId() {
  if (cachedWindowId == null) {
    const win = await chrome.windows.getCurrent();
    cachedWindowId = win.id;
  }
  return cachedWindowId;
}

async function sendMessage(type, payload) {
  const windowId = await getPopupWindowId();
  const fullPayload = { ...(payload || {}), windowId };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({ type, payload: fullPayload });
      if (!response || !response.ok) {
        throw new Error(response?.error ?? "Extension action failed.");
      }
      return response.result;
    } catch (err) {
      const isColdStart =
        attempt === 0 &&
        typeof err.message === "string" &&
        err.message.includes("Receiving end does not exist");
      if (isColdStart) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      throw err;
    }
  }
}

function renderPreview(preview) {
  const skipped = preview.skippedPinned ? ` ${preview.skippedPinned} pinned tabs skipped.` : "";
  summaryText.textContent = `${preview.matched} of ${preview.total} tabs match current rules.${skipped}`;
  countsElement.replaceChildren();

  preview.counts.forEach((item) => {
    const row = document.createElement("div");
    row.className = "count-row";

    const name = document.createElement("strong");
    name.textContent = item.name;

    const count = document.createElement("span");
    count.textContent = String(item.count);

    row.append(name, count);
    countsElement.append(row);
  });
}

async function refreshPreview() {
  const preview = await sendMessage("getPreviewTabs");
  renderPreview(preview);
}

async function runAction(type, successMessage, payload) {
  setBusy(true);
  setStatus("");
  try {
    const result = await sendMessage(type, payload);
    setStatus(successMessage(result));
    await refreshPreview();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

groupButton.addEventListener("click", () => {
  runAction(
    "groupTabs",
    (result) => {
      const cleanup = result.ungrouped ? ` Ungrouped ${result.ungrouped} stale tabs.` : "";
      const merged = result.mergedGroups ? ` Merged ${result.mergedGroups} duplicate groups.` : "";
      const moved = result.groupsMoved ? ` Moved ${result.groupsMoved} groups.` : "";
      const failedUngroup = result.failedUngroup ? ` Failed to ungroup ${result.failedUngroup} tabs.` : "";
      const failedMerge = result.failedMerge ? ` Failed to merge ${result.failedMerge} groups.` : "";
      const failedGroupTabs = result.failedGroupTabs ? ` Failed to group ${result.failedGroupTabs} tabs.` : "";
      const failedMove = result.failedGroupMoves ? ` Failed to move ${result.failedGroupMoves} groups.` : "";
      return `Grouped ${result.tabs} tabs into ${result.groups} groups.${cleanup}${merged}${moved}${failedUngroup}${failedMerge}${failedGroupTabs}${failedMove}`;
    }
  );
});

sortButton.addEventListener("click", () => {
  runAction(
    "sortTabs",
    (result) => {
      const merged = result.mergedGroups ? ` Merged ${result.mergedGroups} duplicate groups.` : "";
      const failedMerge = result.failedMerge ? ` Failed to merge ${result.failedMerge} groups.` : "";
      const failedMove = result.failedGroupMoves ? ` Failed to move ${result.failedGroupMoves} groups.` : "";
      return `Moved ${result.moved} tabs and ${result.groupsMoved} groups.${merged}${failedMerge}${failedMove}`;
    },
    { activeWindowOnly: true }
  );
});

dedupeButton.addEventListener("click", () => {
  runAction("closeDuplicateTabs", (result) => `Closed ${result.closed} duplicate tabs.`);
});

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refreshPreview().catch((error) => {
  setStatus(error.message || String(error), true);
});
