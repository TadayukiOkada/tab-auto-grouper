// Tab selection and reconciliation helpers used by the grouping actions:
//   • choosing which tabs an action operates on (honoring active-window and
//     skip-pinned settings),
//   • ungrouping tabs that no longer belong to their managed group,
//   • collapsing managed groups.

import { normalizeGroupTitle } from "./url-utils.js";
import { classifyTab } from "./classifier.js";
import { ruleByTitleMap } from "./groups.js";
import {
  NO_GROUP,
  queryTabs,
  queryGroups,
  getGroup,
  updateGroup,
  collapseGroup,
  ungroupTabs,
  moveTab
} from "./chrome-api.js";

/**
 * Tabs an action should operate on: those in scope (a window, or all windows),
 * minus pinned tabs when skipPinnedTabs is set.
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function getTargetTabs(options, windowId) {
  const scopeWindowId = options.activeWindowOnly ? windowId : undefined;
  const tabs = await queryTabs(scopeWindowId);
  return tabs.filter((tab) => !(options.skipPinnedTabs && tab.pinned));
}

/**
 * Ungroup tabs sitting in a managed group they no longer belong to (e.g. a tab
 * that navigated away, or was manually dragged in). Tabs matching no rule are
 * moved to the end of their window so they visibly leave the old group; tabs
 * matching a different rule are left for the grouping pass to relocate.
 *
 * @returns {Promise<{ ungrouped: number, failed: number }>}
 */
export async function ungroupStaleTabs(options, windowId) {
  const tabs = await getTargetTabs(options, windowId);
  const byTitle = ruleByTitleMap(options.rules);

  const groupIds = [...new Set(tabs.filter((t) => t.groupId !== NO_GROUP).map((t) => t.groupId))];
  if (groupIds.length === 0) {
    return { ungrouped: 0, failed: 0 };
  }

  const groupsById = new Map();
  for (const groupId of groupIds) {
    const group = await getGroup(groupId);
    if (group) {
      groupsById.set(groupId, group);
    }
  }

  const stale = [];
  for (const tab of tabs) {
    if (tab.groupId === NO_GROUP) {
      continue;
    }
    const currentGroup = groupsById.get(tab.groupId);
    const currentGroupRule = currentGroup ? byTitle.get(normalizeGroupTitle(currentGroup.title)) : null;
    if (!currentGroup || !currentGroupRule) {
      continue; // not a managed group; leave it alone
    }
    const expectedRule = classifyTab(tab, options.rules);
    const expectedTitle = expectedRule ? normalizeGroupTitle(expectedRule.name) : null;
    if (expectedTitle !== normalizeGroupTitle(currentGroup.title)) {
      stale.push({ tab, currentGroup, expectedTitle });
    }
  }

  if (stale.length === 0) {
    return { ungrouped: 0, failed: 0 };
  }

  let ungrouped = 0;
  let failed = 0;
  const expanded = new Set();

  for (const { tab, currentGroup, expectedTitle } of stale) {
    // A collapsed group can hide the fact that tabs left it; expand once first.
    if (!expanded.has(currentGroup.id)) {
      await updateGroup(currentGroup.id, { collapsed: false });
      expanded.add(currentGroup.id);
    }
    const ok = await ungroupTabs(tab.id);
    if (!ok) {
      failed += 1;
      continue;
    }
    ungrouped += 1;
    if (!expectedTitle) {
      await moveTab(tab.id, -1);
    }
  }

  return { ungrouped, failed };
}

/**
 * Collapse all managed groups in scope.
 * @returns {Promise<{ collapsed: number }>}
 */
export async function collapseManagedGroups(options, windowId) {
  const scopeWindowId = options.activeWindowOnly ? windowId : undefined;
  const groups = await queryGroups(scopeWindowId);
  const ruleNames = new Set(options.rules.map((rule) => normalizeGroupTitle(rule.name)));
  const managed = groups.filter((group) => ruleNames.has(normalizeGroupTitle(group.title)));
  for (const group of managed) {
    await collapseGroup(group.id);
  }
  return { collapsed: managed.length };
}
