import {
  DEFAULT_OPTIONS,
  getOptions,
  saveOptions,
  resetOptions,
  validateRules
} from "./shared.js";

// Approximate hex values for Chrome's tab group colors. Chrome does not
// publish exact pixel values (and they can shift slightly with theme), so
// these are close, readable approximations — not a guaranteed pixel match.
const GROUP_COLOR_HEX = {
  grey: "#5f6368",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#188038",
  pink: "#d01884",
  purple: "#9334e6",
  cyan: "#00778a",
  orange: "#b3560a"
};
const GROUP_COLORS = Object.keys(GROUP_COLOR_HEX);

/**
 * Pick black or white text for a given hex background using the WCAG
 * relative luminance formula, so every swatch stays readable regardless of
 * how light or dark its color is.
 */
function readableTextColor(hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#1a1a1a" : "#ffffff";
}

/** Apply the color swatch styling to a <select>'s options and its own closed-state box. */
function applyColorSwatchStyles(selectEl) {
  Array.from(selectEl.options).forEach((option) => {
    const hex = GROUP_COLOR_HEX[option.value] || "#5f6368";
    option.style.backgroundColor = hex;
    option.style.color = readableTextColor(hex);
  });
  const hex = GROUP_COLOR_HEX[selectEl.value] || "#5f6368";
  selectEl.style.backgroundColor = hex;
  selectEl.style.color = readableTextColor(hex);
  selectEl.style.borderColor = hex;
}

const activeWindowOnly = document.getElementById("activeWindowOnly");
const addRuleButton = document.getElementById("addRuleButton");
const closeDuplicateScope = document.getElementById("closeDuplicateScope");
const collapseGroups = document.getElementById("collapseGroups");
const duplicateMatch = document.getElementById("duplicateMatch");
const groupPosition = document.getElementById("groupPosition");
const exportButton = document.getElementById("exportButton");
const importButton = document.getElementById("importButton");
const importFile = document.getElementById("importFile");
const resetButton = document.getElementById("resetButton");
const rulesContainer = document.getElementById("rulesContainer");
const saveButton = document.getElementById("saveButton");
const skipPinnedTabs = document.getElementById("skipPinnedTabs");
const sortAfterGrouping = document.getElementById("sortAfterGrouping");
const statusElement = document.getElementById("status");

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.color = isError ? "#b3261e" : "";
}

// ---------------------------------------------------------------------------
// Rule editor (field-based)
// ---------------------------------------------------------------------------

function parseList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(items) {
  return Array.isArray(items) ? items.join(", ") : "";
}

function makeTextField(labelText, className, value, placeholder) {
  const label = document.createElement("label");
  label.className = "rule-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.className = className;
  input.value = value;
  if (placeholder) {
    input.placeholder = placeholder;
  }
  label.append(span, input);
  return label;
}

function renderRuleCard(rule, index, total) {
  const card = document.createElement("div");
  card.className = "rule-card";
  card.dataset.index = String(index);

  // --- header: name + color + reorder/delete controls
  const header = document.createElement("div");
  header.className = "rule-header";

  const nameLabel = document.createElement("label");
  nameLabel.className = "rule-field rule-name";
  const nameSpan = document.createElement("span");
  nameSpan.textContent = "Name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "rule-name-input";
  nameInput.value = rule.name || "";
  nameInput.placeholder = "Group name";
  nameLabel.append(nameSpan, nameInput);

  const colorLabel = document.createElement("label");
  colorLabel.className = "rule-field rule-color";
  const colorSpan = document.createElement("span");
  colorSpan.textContent = "Color";
  const colorSelect = document.createElement("select");
  colorSelect.className = "rule-color-select";
  GROUP_COLORS.forEach((color) => {
    const option = document.createElement("option");
    option.value = color;
    option.textContent = color;
    colorSelect.append(option);
  });
  colorSelect.value = GROUP_COLORS.includes(rule.color) ? rule.color : "grey";
  applyColorSwatchStyles(colorSelect);
  // Keep the closed <select> box tinted to match the currently chosen color —
  // browsers don't do this automatically from <option> background styling.
  colorSelect.addEventListener("change", () => applyColorSwatchStyles(colorSelect));
  colorLabel.append(colorSpan, colorSelect);

  const controls = document.createElement("div");
  controls.className = "rule-controls";

  const upButton = document.createElement("button");
  upButton.type = "button";
  upButton.textContent = "↑";
  upButton.title = "Move up (higher priority)";
  upButton.disabled = index === 0;
  upButton.addEventListener("click", () => moveRule(index, -1));

  const downButton = document.createElement("button");
  downButton.type = "button";
  downButton.textContent = "↓";
  downButton.title = "Move down (lower priority)";
  downButton.disabled = index === total - 1;
  downButton.addEventListener("click", () => moveRule(index, 1));

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => deleteRule(index));

  controls.append(upButton, downButton, deleteButton);
  header.append(nameLabel, colorLabel, controls);

  // --- match fields
  const domainsField = makeTextField(
    "Domains",
    "rule-domains-input",
    joinList(rule.domains),
    "github.com, docs.github.com"
  );
  const urlField = makeTextField(
    "URL contains",
    "rule-url-input",
    joinList(rule.urlIncludes),
    "/pulls, ?tab=repositories"
  );
  const titleField = makeTextField(
    "Title keywords",
    "rule-title-input",
    joinList(rule.titleKeywords),
    "News, Sports"
  );

  card.append(header, domainsField, urlField, titleField);
  return card;
}

function renderRules(rules) {
  rulesContainer.replaceChildren();
  rules.forEach((rule, index) => {
    rulesContainer.append(renderRuleCard(rule, index, rules.length));
  });
}

// Read the current field values back into a rules array. Used both for saving
// and for preserving in-progress edits across re-renders (reorder/add/delete).
function readRulesFromDom() {
  return Array.from(rulesContainer.querySelectorAll(".rule-card")).map((card) => ({
    name: card.querySelector(".rule-name-input").value.trim(),
    color: card.querySelector(".rule-color-select").value,
    domains: parseList(card.querySelector(".rule-domains-input").value),
    urlIncludes: parseList(card.querySelector(".rule-url-input").value),
    titleKeywords: parseList(card.querySelector(".rule-title-input").value)
  }));
}

function moveRule(index, delta) {
  const rules = readRulesFromDom();
  const target = index + delta;
  if (target < 0 || target >= rules.length) {
    return;
  }
  [rules[index], rules[target]] = [rules[target], rules[index]];
  renderRules(rules);
}

function deleteRule(index) {
  const rules = readRulesFromDom();
  rules.splice(index, 1);
  renderRules(rules);
}

addRuleButton.addEventListener("click", () => {
  const rules = readRulesFromDom();
  rules.push({ name: "", color: "grey", domains: [], urlIncludes: [], titleKeywords: [] });
  renderRules(rules);
  const cards = rulesContainer.querySelectorAll(".rule-card");
  const lastCard = cards[cards.length - 1];
  lastCard.querySelector(".rule-name-input").focus();
  lastCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// ---------------------------------------------------------------------------
// Options load / save
// ---------------------------------------------------------------------------

function renderOptions(options) {
  activeWindowOnly.checked = options.activeWindowOnly;
  closeDuplicateScope.value = options.closeDuplicateScope;
  collapseGroups.checked = options.collapseGroups;
  duplicateMatch.value = options.duplicateMatch;
  groupPosition.value = options.groupPosition;
  skipPinnedTabs.checked = options.skipPinnedTabs;
  sortAfterGrouping.checked = options.sortAfterGrouping;
  renderRules(options.rules);
}

function collectOptions() {
  const rules = readRulesFromDom();
  validateRules(rules);

  return {
    schemaVersion: DEFAULT_OPTIONS.schemaVersion,
    activeWindowOnly: activeWindowOnly.checked,
    closeDuplicateScope: closeDuplicateScope.value,
    collapseGroups: collapseGroups.checked,
    duplicateMatch: duplicateMatch.value,
    groupPosition: groupPosition.value,
    rules,
    skipPinnedTabs: skipPinnedTabs.checked,
    sortAfterGrouping: sortAfterGrouping.checked
  };
}

async function loadOptions() {
  const options = await getOptions();
  renderOptions(options);
}

saveButton.addEventListener("click", async () => {
  try {
    const options = collectOptions();
    await saveOptions(options);
    setStatus("Saved.");
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
});

resetButton.addEventListener("click", async () => {
  try {
    const options = await resetOptions();
    renderOptions(options);
    setStatus("Defaults restored.");
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
});

// ---------------------------------------------------------------------------
// Export / Import (JSON backup)
// ---------------------------------------------------------------------------

exportButton.addEventListener("click", () => {
  try {
    // Export what is currently on screen (including unsaved edits) so the
    // file always matches what the user sees.
    const options = collectOptions();
    const json = JSON.stringify(options, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `tab-auto-grouper-settings-${stamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Exported.");
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
});

importButton.addEventListener("click", () => {
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = ""; // allow re-importing the same file later
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    // Accept either a full options object or a bare rules array.
    const candidate = Array.isArray(parsed) ? { ...DEFAULT_OPTIONS, rules: parsed } : parsed;
    const saved = await saveOptions(candidate); // validates + normalizes + persists
    renderOptions(saved);
    setStatus(`Imported ${saved.rules.length} rules.`);
  } catch (error) {
    setStatus(`Import failed: ${error.message || String(error)}`, true);
  }
});

loadOptions().catch((error) => {
  setStatus(error.message || String(error), true);
});
