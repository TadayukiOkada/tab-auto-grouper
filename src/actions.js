// Top-level user actions. Each takes an explicit windowId (resolved by the
// popup) so nothing here depends on service-worker "current window" guessing.

import { getOptions } from "./options-store.js";
import { classifyTab } from "./classifier.js";
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
  packGroups,
  sortTabsWithinGroups
} from "./groups.js";
import { getTabComparator } from "./tab-sort.js";
import {
  getTargetTabs,
  ungroupStaleTabs,
  collapseManagedGroups
} from "./reconcile.js";
import { debug } from "./logger.js";

/**
 * Group matching tabs into tab groups, reconciling with existing groups and
 * then packing groups to the configured side.
 * @param {number} [windowId]
 */
export async function groupTabs(windowId) {
  const options = await getOptions();
  debug("groupTabs start", { windowId, activeWindowOnly: options.activeWindowOnly });

  const stale = await ungroupStaleTabs(options, windowId);

  const preMerge = await mergeDuplicateGroups({
    rules: options.rules,
    activeWindowOnly: options.activeWindowOnly,
    windowId
  });

  // Read the tabs after the merge so each tab's groupId is current. Buckets
  // hold disjoint tabs, so one bucket's grouping can't change another's.
  const tabs = await getTargetTabs(options, windowId);

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
    let bucketFailed = 0;

    if (!target) {
      const groupId = await createGroup(bucket.windowId, tabIds);
      target = groupId != null ? await getGroup(groupId) : null;
      if (!target) {
        failedGroupTabs += tabIds.length;
        continue;
      }
    } else {
      const idsToAdd = bucket.tabs.filter((tab) => tab.groupId !== target.id).map((tab) => tab.id);
      const result = await addTabsToGroup(target.id, idsToAdd);
      failedGroupTabs += result.failed;
      bucketFailed = result.failed;
    }

    // Don't collapse here: the sort step below still moves tabs inside these
    // groups. collapseManagedGroups collapses them once, after all moves.
    const groupProps = { title: bucket.rule.name, color: bucket.rule.color || "grey" };
    if (!options.collapseGroups) {
      groupProps.collapsed = false;
    }
    await updateGroup(target.id, groupProps);
    groupedTabCount += bucket.tabs.length - bucketFailed;
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
    // Duplicates were just merged above, so skip the sort's own merge pass.
    sortResult = await sortTabs({ activeWindowOnly: options.activeWindowOnly, windowId, mergeDuplicates: false });
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
 * Sort tabs: pack groups to the configured side, then order both ungrouped
 * tabs and the tabs inside each group using the configured tab sort method.
 * @param {{ activeWindowOnly?: boolean, windowId?: number, mergeDuplicates?: boolean }} params
 */
export async function sortTabs({ activeWindowOnly = true, windowId, mergeDuplicates = true } = {}) {
  const options = await getOptions();
  const toLeft = options.groupPosition === "left";
  const compareTabs = getTabComparator(options.rules, options.tabSortMethod);
  debug("sortTabs start", {
    activeWindowOnly,
    windowId,
    groupPosition: options.groupPosition,
    tabSortMethod: options.tabSortMethod
  });

  const merge = mergeDuplicates
    ? await mergeDuplicateGroups({ rules: options.rules, activeWindowOnly, windowId })
    : { merged: 0, failed: 0 };
  const pack = await packGroups({
    rules: options.rules,
    groupPosition: options.groupPosition,
    activeWindowOnly,
    windowId
  });
  const withinGroups = await sortTabsWithinGroups({ activeWindowOnly, windowId, compareTabs });

  const windowIds = await resolveWindowIds(activeWindowOnly, windowId);
  let moved = withinGroups.moved;

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
      .sort(compareTabs);

    // `current` mirrors the live order of this band of the tab strip so each
    // move is checked against where a tab actually is, not its pre-sort
    // snapshot index (which earlier moves in this loop can shift).
    const current = [...ungrouped];
    for (let offset = 0; offset < ungrouped.length; offset += 1) {
      const tab = ungrouped[offset];
      const targetIndex = ungroupedStart + offset;
      const currentPos = current.indexOf(tab);
      if (currentPos !== offset) {
        const ok = await moveTab(tab.id, targetIndex);
        if (ok) {
          moved += 1;
          current.splice(currentPos, 1);
          current.splice(offset, 0, tab);
        }
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
 * Close duplicate tabs, keeping the "best" instance of each URL. When
 * skipPinnedTabs is on, a pinned tab is always the kept instance (so every
 * other tab sharing its URL is treated as a duplicate and closed) and is
 * itself never closed even if it's the later-seen "duplicate"; otherwise the
 * order is active > pinned > earliest window/index.
 * @param {number} [windowId]
 */
export async function closeDuplicateTabs(windowId) {
  const options = await getOptions();
  if (options.closeDuplicateScope === "activeWindow" && windowId == null) {
    // Without a window to scope to, queryTabs would span every window.
    return { closed: 0 };
  }
  const scopeWindowId = options.closeDuplicateScope === "activeWindow" ? windowId : undefined;
  const tabs = await queryTabs(scopeWindowId);

  const ranked = [...tabs].sort((a, b) => {
    if (options.skipPinnedTabs && a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
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
      if (options.skipPinnedTabs && tab.pinned) {
        continue; // never close a pinned tab, even if it's the "duplicate"
      }
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
  if (options.activeWindowOnly && windowId == null) {
    return { total: 0, matched: 0, skippedPinned: 0, counts: [] };
  }
  const scopeWindowId = options.activeWindowOnly ? windowId : undefined;
  const allTabs = await queryTabs(scopeWindowId);
  const tabs = allTabs.filter((tab) => !(options.skipPinnedTabs && tab.pinned));
  const skippedPinned = allTabs.length - tabs.length;

  const counts = new Map();
  let matched = 0;
  let unmatched = 0;
  for (const tab of tabs) {
    const rule = classifyTab(tab, options.rules);
    if (rule) {
      counts.set(rule.name, (counts.get(rule.name) || 0) + 1);
      matched += 1;
    } else {
      unmatched += 1;
    }
  }

  return {
    total: tabs.length,
    matched,
    skippedPinned,
    // The unmatched bucket is flagged rather than named, so a user rule
    // called "Ungrouped" can't collide with it.
    counts: [
      ...[...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      ...(unmatched ? [{ name: "Ungrouped", count: unmatched, unmatched: true }] : [])
    ]
  };
}
