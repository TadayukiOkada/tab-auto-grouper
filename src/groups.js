// Group reconciliation: mapping rules to tab groups, merging duplicate
// same-named groups, and packing groups to the left or right of the tab strip.
//
// A "managed" group is one whose (normalized) title matches a rule name.

import { normalizeGroupTitle } from "./url-utils.js";
import {
  NO_GROUP,
  queryTabs,
  queryGroups,
  queryGroupTabs,
  getGroupTabInfo,
  moveGroup,
  moveTab,
  updateGroup,
  addTabsToGroup,
  resolveWindowIds
} from "./chrome-api.js";
import { debug } from "./logger.js";

/**
 * Map of normalized rule name -> rule, for quick title-based lookups.
 * @param {Array<object>} rules
 * @returns {Map<string, object>}
 */
export function ruleByTitleMap(rules) {
  const map = new Map();
  for (const rule of rules) {
    map.set(normalizeGroupTitle(rule.name), rule);
  }
  return map;
}

/**
 * All managed groups in a window, annotated with their normalized title and
 * matching rule.
 * @returns {Promise<Array<{ group: object, normalizedTitle: string, rule: object }>>}
 */
export async function getManagedGroups(windowId, rules) {
  const byTitle = ruleByTitleMap(rules);
  const groups = await queryGroups(windowId);
  return groups
    .map((group) => {
      const normalizedTitle = normalizeGroupTitle(group.title);
      return { group, normalizedTitle, rule: byTitle.get(normalizedTitle) || null };
    })
    .filter((item) => item.rule);
}

/** Sort helper: by starting index, then group id, both ascending. */
function byStartThenId(a, b) {
  const aStart = a.info.start ?? Number.MAX_SAFE_INTEGER;
  const bStart = b.info.start ?? Number.MAX_SAFE_INTEGER;
  if (aStart !== bStart) {
    return aStart - bStart;
  }
  return a.group.id - b.group.id;
}

/**
 * Find the canonical existing group for a rule in a window: the earliest
 * (leftmost, then lowest id) group whose title matches the rule name.
 * @returns {Promise<object | null>}
 */
export async function findTargetGroup(windowId, rule, rules) {
  const normalizedRuleName = normalizeGroupTitle(rule.name);
  const managed = await getManagedGroups(windowId, rules);
  const matches = [];
  for (const item of managed) {
    if (item.normalizedTitle === normalizedRuleName) {
      matches.push({ ...item, info: await getGroupTabInfo(windowId, item.group.id) });
    }
  }
  matches.sort(byStartThenId);
  return matches[0]?.group || null;
}

/**
 * Merge duplicate same-named managed groups within one window into a single
 * canonical group.
 * @returns {Promise<{ merged: number, failed: number }>}
 */
async function mergeDuplicatesInWindow(windowId, rules) {
  const managed = await getManagedGroups(windowId, rules);
  const byTitle = new Map();
  for (const item of managed) {
    const list = byTitle.get(item.normalizedTitle) || [];
    list.push(item);
    byTitle.set(item.normalizedTitle, list);
  }

  let merged = 0;
  let failed = 0;

  for (const items of byTitle.values()) {
    if (items.length < 2) {
      continue;
    }
    const withInfo = [];
    for (const item of items) {
      withInfo.push({ ...item, info: await getGroupTabInfo(windowId, item.group.id) });
    }
    withInfo.sort(byStartThenId);

    const canonical = withInfo[0];
    await updateGroup(canonical.group.id, {
      title: canonical.rule.name,
      color: canonical.rule.color || "grey"
    });

    for (const duplicate of withInfo.slice(1)) {
      const dupTabs = await queryGroupTabs(windowId, duplicate.group.id);
      if (dupTabs.length === 0) {
        merged += 1;
        continue;
      }
      const result = await addTabsToGroup(canonical.group.id, dupTabs.map((t) => t.id));
      if (result.failed > 0) {
        failed += 1;
      } else {
        merged += 1;
      }
    }
  }

  return { merged, failed };
}

/**
 * Merge duplicate managed groups across the target window(s).
 * @returns {Promise<{ merged: number, failed: number }>}
 */
export async function mergeDuplicateGroups({ rules, activeWindowOnly, windowId }) {
  const windowIds = await resolveWindowIds(activeWindowOnly, windowId);
  let merged = 0;
  let failed = 0;
  for (const wid of windowIds) {
    const result = await mergeDuplicatesInWindow(wid, rules);
    merged += result.merged;
    failed += result.failed;
  }
  return { merged, failed };
}

/**
 * Order groups by rule priority (rule index), then alphabetically by title for
 * any groups not backed by a rule.
 */
function orderGroupsByRule(groups, ruleOrder, ruleCount, includeAllGroups) {
  return groups
    .filter((group) => includeAllGroups || ruleOrder.has(normalizeGroupTitle(group.title)))
    .sort((a, b) => {
      const ai = ruleOrder.has(normalizeGroupTitle(a.title)) ? ruleOrder.get(normalizeGroupTitle(a.title)) : ruleCount;
      const bi = ruleOrder.has(normalizeGroupTitle(b.title)) ? ruleOrder.get(normalizeGroupTitle(b.title)) : ruleCount;
      if (ai !== bi) {
        return ai - bi;
      }
      return (a.title || "").localeCompare(b.title || "");
    });
}

/**
 * Whether the non-empty groups in `ordered` already sit as one contiguous
 * block in that exact order, starting right after the pinned tabs (left) or
 * ending at the last tab of the window (right).
 * @param {Array<chrome.tabGroups.TabGroup>} ordered
 * @param {chrome.tabs.Tab[]} tabs all tabs in the window
 * @param {number} pinnedCount
 * @param {boolean} toLeft
 * @returns {boolean}
 */
function isAlreadyPacked(ordered, tabs, pinnedCount, toLeft) {
  const infoById = new Map();
  for (const tab of tabs) {
    if (tab.groupId === NO_GROUP) {
      continue;
    }
    const info = infoById.get(tab.groupId);
    if (info) {
      info.start = Math.min(info.start, tab.index);
      info.size += 1;
    } else {
      infoById.set(tab.groupId, { start: tab.index, size: 1 });
    }
  }

  const placed = ordered.map((group) => infoById.get(group.id)).filter(Boolean);
  const blockSize = placed.reduce((sum, info) => sum + info.size, 0);
  let expectedStart = toLeft ? pinnedCount : tabs.length - blockSize;
  for (const info of placed) {
    if (info.start !== expectedStart) {
      return false;
    }
    expectedStart += info.size;
  }
  return true;
}

/**
 * Pack all groups to one side of the tab strip, in rule order.
 *
 * Both directions avoid computing a running numeric cursor from group sizes
 * (which drifts out of sync with Chrome's actual placement). Instead:
 *   • right: move each group to index -1 (end) in ascending rule order, so the
 *     last-moved lowest-priority group ends up rightmost.
 *   • left: move each group to the same fixed anchor (right after pinned tabs)
 *     in DESCENDING rule order, so each higher-priority group pushes the
 *     previous one rightward and the highest-priority group ends up leftmost.
 *
 * @returns {Promise<{ moved: number, failed: number }>}
 */
export async function packGroups({ rules, groupPosition, activeWindowOnly, windowId, includeAllGroups = true }) {
  const ruleOrder = new Map(rules.map((rule, index) => [normalizeGroupTitle(rule.name), index]));
  const toLeft = groupPosition === "left";
  const windowIds = await resolveWindowIds(activeWindowOnly, windowId);

  debug("packGroups", { toLeft, windowIds });

  let moved = 0;
  let failed = 0;

  for (const wid of windowIds) {
    const tabs = await queryTabs(wid);
    const pinnedCount = tabs.filter((tab) => tab.pinned).length;
    const groups = await queryGroups(wid);
    const ordered = orderGroupsByRule(groups, ruleOrder, rules.length, includeAllGroups);

    if (ordered.length === 0) {
      continue;
    }
    // Each tabGroups.move physically moves every tab in the group, so skip
    // the whole window when it's already laid out the way we'd leave it.
    if (isAlreadyPacked(ordered, tabs, pinnedCount, toLeft)) {
      debug("packGroups: already packed", { windowId: wid });
      continue;
    }

    const sequence = toLeft ? [...ordered].reverse() : ordered;
    const targetIndex = toLeft ? pinnedCount : -1;

    for (const group of sequence) {
      const before = await getGroupTabInfo(wid, group.id);
      if (before.size === 0) {
        continue;
      }
      if (toLeft && before.start === pinnedCount) {
        continue; // already anchored left
      }
      const ok = await moveGroup(group.id, targetIndex);
      if (ok) {
        moved += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { moved, failed };
}

/**
 * Reorder the tabs inside each group (any group, managed or not) using the
 * given comparator, without changing which group a tab belongs to or where
 * the group itself sits in the tab strip — each group's tabs are re-laid-out
 * within the group's own contiguous index range.
 * @param {{ activeWindowOnly: boolean, windowId: number | undefined, compareTabs: (a: chrome.tabs.Tab, b: chrome.tabs.Tab) => number }} params
 * @returns {Promise<{ moved: number }>}
 */
export async function sortTabsWithinGroups({ activeWindowOnly, windowId, compareTabs }) {
  const windowIds = await resolveWindowIds(activeWindowOnly, windowId);
  let moved = 0;

  for (const wid of windowIds) {
    const groups = await queryGroups(wid);
    for (const group of groups) {
      const tabs = await queryGroupTabs(wid, group.id);
      if (tabs.length < 2) {
        continue;
      }
      const start = tabs[0].index;
      const ordered = [...tabs].sort(compareTabs);
      // `current` mirrors the live order of this group's tabs so each move is
      // checked against where a tab actually is, not its pre-sort snapshot
      // index (which earlier moves in this loop can shift).
      const current = [...tabs];
      for (let offset = 0; offset < ordered.length; offset += 1) {
        const tab = ordered[offset];
        const targetIndex = start + offset;
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
  }

  return { moved };
}
