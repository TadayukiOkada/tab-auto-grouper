// Top-level user actions. Each takes an explicit windowId (resolved by the
// popup) so nothing here depends on service-worker "current window" guessing.

import { getOptions } from "./options-store.js";
import { classifyTab, tabSortKey } from "./classifier.js";
import { normalizeGroupTitle, normalizeDuplicateUrl, getTabUrl } from "./url-utils.js";
import {
  NO_GROUP,
  queryTabs,
  queryGroups,
  getGroup,
  getGroupTabInfo,
  updateGroup,
  moveTab,
  removeTabs,
  addTabsToGroup,
  createGroup,
  resolveWindowIds
} from "./chrome-api.js";
import {
  findTargetGroup,
  mergeDuplicateGroups,
  packGroups
} from "./groups.js";
import {
  getTargetTabs,
  ungroupStaleTabs,
  collapseManagedGroups
} from "./reconcile.js";
import { debug } from "./logger.js";

/**
 * Group matching tabs into Chrome tab groups, reconciling with existing groups
 * and then packing groups to the configured side.
 * @param {number} [windowId]
 */
export async function groupTabs(windowId) {
  const options = await getOptions();
  debug("groupTabs start", { windowId, activeWindowOnly: options.activeWindowOnly });

  const stale = await ungroupStaleTabs(options, windowId);
  let tabs = await getTargetTabs(options, windowId);

  const preMerge = await mergeDuplicateGroups({
    rules: options.rules,
    activeWindowOnly: options.activeWindowOnly,
    windowId
  });

  // Bucket tabs by (window, rule).
  const buckets = new Map();
  for (const tab of tabs) {
    const rule = classifyTab(tab, options.rules);
    if (!rule) {
      continue;
    }
    const key = `${tab.windowId}:${normalizeGroupTitle(rule.name)}`;
    const bucket = buckets.get(key) || { windowId: tab.windowId, rule, tabs: [] };
    bucket.tabs.push(tab);
    buckets.set(key, bucket);
  }

  let groupedTabCount = 0;
  let failedGroupTabs = 0;

  for (const bucket of buckets.values()) {
    const tabIds = bucket.tabs.map((tab) => tab.id);
    let target = await findTargetGroup(bucket.windowId, bucket.rule, options.rules);

    if (!target) {
      const groupId = await createGroup(bucket.windowId, tabIds);
      target = groupId != null ? await getGroup(groupId) : null;
      if (!target) {
        failedGroupTabs += tabIds.length;
        continue;
      }
    } else {
      const fresh = await queryTabs(bucket.windowId);
      const freshById = new Map(fresh.map((tab) => [tab.id, tab]));
      const idsToAdd = tabIds.filter((id) => freshById.get(id)?.groupId !== target.id);
      const result = await addTabsToGroup(target.id, idsToAdd);
      failedGroupTabs += result.failed;
    }

    await updateGroup(target.id, {
      title: bucket.rule.name,
      color: bucket.rule.color || "grey",
      collapsed: Boolean(options.collapseGroups)
    });
    groupedTabCount += bucket.tabs.length;
  }

  // Chrome may keep an emptied duplicate group alive briefly; merge again.
  const postMerge = await mergeDuplicateGroups({
    rules: options.rules,
    activeWindowOnly: options.activeWindowOnly,
    windowId
  });

  // Place grouped tabs on the configured side. When sortAfterGrouping is on we
  // run the full sort (which also orders ungrouped tabs); otherwise just pack.
  let sortResult = { moved: 0, groupsMoved: 0, failedGroupMoves: 0 };
  if (options.sortAfterGrouping) {
    sortResult = await sortTabs({ activeWindowOnly: options.activeWindowOnly, windowId });
  } else {
    const pack = await packGroups({
      rules: options.rules,
      groupPosition: options.groupPosition,
      activeWindowOnly: options.activeWindowOnly,
      windowId
    });
    sortResult = { moved: 0, groupsMoved: pack.moved, failedGroupMoves: pack.failed };
  }

  if (options.collapseGroups) {
    await collapseManagedGroups(options, windowId);
  }

  return {
    groups: buckets.size,
    tabs: groupedTabCount,
    ungrouped: stale.ungrouped,
    failedUngroup: stale.failed,
    mergedGroups: preMerge.merged + postMerge.merged,
    failedMerge: preMerge.failed + postMerge.failed,
    failedGroupTabs,
    moved: sortResult.moved,
    groupsMoved: sortResult.groupsMoved,
    failedGroupMoves: sortResult.failedGroupMoves
  };
}

/**
 * Sort tabs: pack groups to the configured side, then order ungrouped tabs on
 * the opposite side by rule/host/title.
 * @param {{ activeWindowOnly?: boolean, windowId?: number }} params
 */
export async function sortTabs({ activeWindowOnly = true, windowId } = {}) {
  const options = await getOptions();
  const toLeft = options.groupPosition === "left";
  debug("sortTabs start", { activeWindowOnly, windowId, groupPosition: options.groupPosition });

  const merge = await mergeDuplicateGroups({ rules: options.rules, activeWindowOnly, windowId });
  const pack = await packGroups({
    rules: options.rules,
    groupPosition: options.groupPosition,
    activeWindowOnly,
    windowId
  });

  const windowIds = await resolveWindowIds(activeWindowOnly, windowId);
  let moved = 0;

  for (const wid of windowIds) {
    const tabs = await queryTabs(wid);
    const pinnedCount = tabs.filter((tab) => tab.pinned).length;

    // When groups are on the left, ungrouped tabs start after the group block.
    let groupTabCount = 0;
    if (toLeft) {
      for (const group of await queryGroups(wid)) {
        groupTabCount += (await getGroupTabInfo(wid, group.id)).size;
      }
    }
    const ungroupedStart = toLeft ? pinnedCount + groupTabCount : pinnedCount;

    const ungrouped = tabs
      .filter((tab) => !tab.pinned && tab.groupId === NO_GROUP)
      .sort((a, b) => tabSortKey(a, options.rules).localeCompare(tabSortKey(b, options.rules)));

    for (let offset = 0; offset < ungrouped.length; offset += 1) {
      const tab = ungrouped[offset];
      const targetIndex = ungroupedStart + offset;
      if (tab.index !== targetIndex) {
        await moveTab(tab.id, targetIndex);
        moved += 1;
      }
    }
  }

  debug("sortTabs done", { moved, groupsMoved: pack.moved });

  return {
    moved,
    groupsMoved: pack.moved,
    failedGroupMoves: pack.failed,
    mergedGroups: merge.merged,
    failedMerge: merge.failed
  };
}

/**
 * Close duplicate tabs, keeping the "best" instance of each URL (active >
 * pinned > earliest window/index).
 * @param {number} [windowId]
 */
export async function closeDuplicateTabs(windowId) {
  const options = await getOptions();
  const scopeWindowId = options.closeDuplicateScope === "activeWindow" ? windowId : undefined;
  const tabs = (await queryTabs(scopeWindowId)).filter((tab) => !(options.skipPinnedTabs && tab.pinned));

  const ranked = [...tabs].sort((a, b) => {
    if (a.active !== b.active) {
      return a.active ? -1 : 1;
    }
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    if (a.windowId !== b.windowId) {
      return a.windowId - b.windowId;
    }
    return a.index - b.index;
  });

  const seen = new Set();
  const closeIds = [];
  for (const tab of ranked) {
    const key = normalizeDuplicateUrl(getTabUrl(tab), options.duplicateMatch);
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      closeIds.push(tab.id);
    } else {
      seen.add(key);
    }
  }

  await removeTabs(closeIds);
  return { closed: closeIds.length };
}

/**
 * Preview how the current rules would bucket the in-scope tabs, for the popup.
 * @param {number} [windowId]
 */
export async function getPreviewTabs(windowId) {
  const options = await getOptions();
  const scopeWindowId = options.activeWindowOnly ? windowId : undefined;
  const allTabs = await queryTabs(scopeWindowId);
  const tabs = allTabs.filter((tab) => !(options.skipPinnedTabs && tab.pinned));
  const skippedPinned = allTabs.length - tabs.length;

  const counts = new Map();
  let matched = 0;
  for (const tab of tabs) {
    const rule = classifyTab(tab, options.rules);
    const name = rule ? rule.name : "Ungrouped";
    counts.set(name, (counts.get(name) || 0) + 1);
    if (rule) {
      matched += 1;
    }
  }

  return {
    total: tabs.length,
    matched,
    skippedPinned,
    counts: [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name === "Ungrouped") return 1;
        if (b.name === "Ungrouped") return -1;
        return a.name.localeCompare(b.name);
      })
  };
}
