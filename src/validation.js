// Input validation and small type guards. Strengthened so that malformed
// rules (e.g. from a hand-edited or corrupted JSON import) fail loudly with a
// clear message instead of causing confusing downstream behavior.

import { GROUP_COLORS, GROUP_POSITIONS, DUPLICATE_MATCH_MODES, DUPLICATE_SCOPES } from "./constants.js";
import { normalizeGroupTitle } from "./url-utils.js";

/** @returns {boolean} true if value is a plain non-null object (not array). */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @returns {boolean} true if value is a non-empty string after trimming. */
export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Coerce a value to an array of trimmed non-empty strings. Non-arrays and
 * non-string entries are dropped rather than throwing, so lenient fields
 * (domains/urlIncludes/titleKeywords) tolerate minor import sloppiness.
 * @param {unknown} value
 * @returns {string[]}
 */
export function toStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * A ValidationError carries a user-facing message suitable for showing in the
 * options UI status line.
 */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validate a single rule, throwing ValidationError with a specific message on
 * the first problem found. Returns nothing; use for its throw behavior.
 * @param {unknown} rule
 * @param {number} index zero-based index, for human-friendly messages
 */
export function validateRule(rule, index) {
  const label = `Rule ${index + 1}`;
  if (!isPlainObject(rule)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  if (!isNonEmptyString(rule.name)) {
    throw new ValidationError(`${label} needs a non-empty name.`);
  }
  if (rule.color !== undefined && !GROUP_COLORS.includes(rule.color)) {
    throw new ValidationError(`Rule "${rule.name}" has an invalid color "${rule.color}".`);
  }
  for (const field of ["domains", "urlIncludes", "titleKeywords"]) {
    if (rule[field] !== undefined && !Array.isArray(rule[field])) {
      throw new ValidationError(`Rule "${rule.name}" field "${field}" must be an array.`);
    }
  }
  // A rule that matches nothing is almost certainly a mistake worth flagging.
  const hasCriteria =
    toStringArray(rule.domains).length > 0 ||
    toStringArray(rule.urlIncludes).length > 0 ||
    toStringArray(rule.titleKeywords).length > 0;
  if (!hasCriteria) {
    throw new ValidationError(
      `Rule "${rule.name}" has no match criteria. Add at least one domain, URL substring, or title keyword.`
    );
  }
}

/**
 * Validate an array of rules and reject duplicate names (case/whitespace
 * insensitive, matching how groups are reconciled at runtime).
 * @param {unknown} rules
 */
export function validateRules(rules) {
  if (!Array.isArray(rules)) {
    throw new ValidationError("Rules must be an array.");
  }
  rules.forEach(validateRule);

  const seen = new Set();
  const duplicates = new Set();
  for (const rule of rules) {
    const key = normalizeGroupTitle(rule.name);
    if (seen.has(key)) {
      duplicates.add(rule.name);
    }
    seen.add(key);
  }
  if (duplicates.size > 0) {
    throw new ValidationError(`Duplicate rule names are not allowed: ${[...duplicates].join(", ")}`);
  }
}

/**
 * Return value if it's one of the allowed choices, else fallback. Used to
 * sanitize enum-like settings coming from storage or import.
 */
export function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export const ENUMS = Object.freeze({
  GROUP_POSITIONS,
  DUPLICATE_MATCH_MODES,
  DUPLICATE_SCOPES
});
