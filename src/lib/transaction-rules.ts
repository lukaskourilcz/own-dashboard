/**
 * The transaction rule engine.
 *
 * A rule is a list of conditions (every one must hold) and a set of actions
 * (category, subscription, project, note). Rules run in three stages — `pre`,
 * `default`, `post` — and inside a stage they are ordered least-specific first,
 * so a narrow rule overwrites a broad one instead of racing it. That is the
 * ranking Actual Budget uses, and it is what lets "everything from this bank is
 * Overhead" coexist with "this one merchant is Groceries".
 *
 * Pure and framework-free on purpose: the same code runs in the GoCardless sync
 * (server), the CSV import (browser), the retroactive apply route and the unit
 * tests. Nothing here calls `new Date()`, `Date.now()` or `Math.random()`, so a
 * given transaction and rule set always produce the same result.
 *
 * `conditions` and `actions` are jsonb columns filled by the owner's editor, so
 * every reader goes through {@link parseConditions} / {@link parseActions},
 * which drop malformed entries rather than trusting the column.
 */

export const RULE_FIELDS = ["note", "account", "amount", "date", "kind"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_OPS = [
  "is",
  "contains",
  "not_contains",
  "regex",
  "one_of",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
] as const;
export type RuleOp = (typeof RULE_OPS)[number];

export const RULE_STAGES = ["pre", "default", "post"] as const;
export type RuleStage = (typeof RULE_STAGES)[number];

export type RuleConditionValue = string | number | string[] | [number, number];

export type RuleCondition = {
  field: RuleField;
  op: RuleOp;
  value: RuleConditionValue;
};

/** The transaction columns a rule may write. `null` clears the column. */
export type RuleActions = {
  category?: string | null;
  subscription_id?: string | null;
  project_id?: string | null;
  note?: string | null;
};

export const RULE_ACTION_KEYS = [
  "category",
  "subscription_id",
  "project_id",
  "note",
] as const;
export type RuleActionKey = (typeof RULE_ACTION_KEYS)[number];

export type TransactionRule = {
  id: string;
  user_id: string;
  name: string;
  stage: RuleStage;
  conditions: RuleCondition[];
  actions: RuleActions;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

/** The transaction shape a rule is evaluated against — anything with these
 * columns works, so an unsaved import row matches exactly like a stored row. */
export type RuleTarget = {
  note?: string | null;
  account_id?: string | null;
  amount?: number | string | null;
  occurred_on?: string | null;
  kind?: string | null;
};

/** Ids the owner actually owns. Action ids outside these sets are dropped
 * before any write, because the transactions RLS policies would reject them. */
export type OwnedIds = {
  projectIds: ReadonlySet<string>;
  subscriptionIds: ReadonlySet<string>;
};

/* ------------------------------ jsonb parsing ----------------------------- */

const FIELD_SET = new Set<string>(RULE_FIELDS);
const OP_SET = new Set<string>(RULE_OPS);
const STAGE_SET = new Set<string>(RULE_STAGES);

/** Ops whose value is a plain scalar (text or number). */
const SCALAR_OPS = new Set<RuleOp>([
  "is",
  "contains",
  "not_contains",
  "regex",
  "gt",
  "gte",
  "lt",
  "lte",
]);

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function asArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function finiteNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** One condition, or null when it cannot be trusted. */
export function parseCondition(raw: unknown): RuleCondition | null {
  const record = asRecord(raw);
  if (!record) return null;

  const field = record.field;
  const op = record.op;
  if (typeof field !== "string" || !FIELD_SET.has(field)) return null;
  if (typeof op !== "string" || !OP_SET.has(op)) return null;

  const typedField = field as RuleField;
  const typedOp = op as RuleOp;
  const rawValue = record.value;

  if (typedOp === "one_of") {
    const list = asArray(rawValue);
    if (!list) return null;
    const values = list
      .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
      .map((v) => String(v).trim())
      .filter((v) => v !== "");
    if (values.length === 0) return null;
    return { field: typedField, op: typedOp, value: values };
  }

  if (typedOp === "between") {
    const list = asArray(rawValue);
    if (!list || list.length < 2) return null;
    const low = finiteNumber(list[0]);
    const high = finiteNumber(list[1]);
    if (low === null || high === null) return null;
    return {
      field: typedField,
      op: typedOp,
      value: low <= high ? [low, high] : [high, low],
    };
  }

  if (!SCALAR_OPS.has(typedOp)) return null;

  if (typeof rawValue === "number") {
    if (!Number.isFinite(rawValue)) return null;
    return { field: typedField, op: typedOp, value: rawValue };
  }
  if (typeof rawValue !== "string") return null;
  const text = rawValue.trim();
  if (text === "") return null;
  // An unusable pattern is a malformed condition, not a silent match-all.
  if (typedOp === "regex" && safeRegex(text) === null) return null;
  return { field: typedField, op: typedOp, value: text };
}

/** Every trustworthy condition in a jsonb blob; malformed entries are dropped. */
export function parseConditions(raw: unknown): RuleCondition[] {
  const list = asArray(raw);
  if (!list) return [];
  const parsed: RuleCondition[] = [];
  for (const entry of list) {
    const condition = parseCondition(entry);
    if (condition) parsed.push(condition);
  }
  return parsed;
}

/** Actions from a jsonb blob. Unknown keys and non-text values are dropped;
 * an explicit null is kept, because clearing a column is a real action. */
export function parseActions(raw: unknown): RuleActions {
  const record = asRecord(raw);
  if (!record) return {};
  const actions: RuleActions = {};
  for (const key of RULE_ACTION_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    if (value === null) {
      actions[key] = null;
      continue;
    }
    if (typeof value !== "string") continue;
    const text = value.trim();
    actions[key] = text === "" ? null : text;
  }
  return actions;
}

/** A stored row, or null when it is too malformed to evaluate. */
export function parseRule(raw: unknown): TransactionRule | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = record.id;
  const userId = record.user_id;
  if (typeof id !== "string" || typeof userId !== "string") return null;
  const stage = typeof record.stage === "string" && STAGE_SET.has(record.stage)
    ? (record.stage as RuleStage)
    : "default";
  return {
    id,
    user_id: userId,
    name: typeof record.name === "string" ? record.name : "",
    stage,
    conditions: parseConditions(record.conditions),
    actions: parseActions(record.actions),
    sort_order: finiteNumber(record.sort_order) ?? 0,
    enabled: record.enabled !== false,
    created_at: typeof record.created_at === "string" ? record.created_at : "",
    updated_at: typeof record.updated_at === "string" ? record.updated_at : "",
  };
}

export type TransactionRuleSet = {
  rules: TransactionRule[];
  /** Rows the parser refused. Surfaced in the editor rather than hidden. */
  dropped: number;
};

export function parseRules(rows: readonly unknown[] | null | undefined): TransactionRuleSet {
  const rules: TransactionRule[] = [];
  let dropped = 0;
  for (const row of rows ?? []) {
    const rule = parseRule(row);
    if (rule) rules.push(rule);
    else dropped++;
  }
  return { rules, dropped };
}

/* -------------------------------- matching -------------------------------- */

const MAX_PATTERN_LENGTH = 200;
const regexCache = new Map<string, RegExp | null>();

/**
 * A case-insensitive RegExp for an owner-authored pattern, or null when the
 * pattern is invalid or absurdly long. Memoised, because the editor's live
 * match count re-evaluates the same pattern across every loaded transaction.
 */
export function safeRegex(pattern: string): RegExp | null {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) return null;
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(pattern, "i");
  } catch {
    compiled = null;
  }
  // Bound the cache so a long editing session cannot grow it without limit.
  if (regexCache.size > 200) regexCache.clear();
  regexCache.set(pattern, compiled);
  return compiled;
}

/**
 * The transaction's value for a rule field. `note` carries the bank's
 * merchant/remittance text — there is no separate payee column — so a rule
 * about a merchant is a rule about the note.
 */
export function fieldValue(tx: RuleTarget, field: RuleField): string | number | null {
  switch (field) {
    case "note":
      return tx.note ?? null;
    case "account":
      return tx.account_id ?? null;
    case "amount":
      return finiteNumber(tx.amount);
    case "date":
      return tx.occurred_on ?? null;
    case "kind":
      return tx.kind ?? null;
  }
}

function normalizeText(value: string | number): string {
  return String(value).trim().toLowerCase();
}

/** -1 / 0 / 1, or null when the two values cannot be compared. */
function compare(actual: string | number, expected: string | number): number | null {
  const actualNumber = typeof actual === "number" ? actual : finiteNumber(actual);
  const expectedNumber = typeof expected === "number" ? expected : finiteNumber(expected);
  if (actualNumber !== null && expectedNumber !== null) {
    if (actualNumber === expectedNumber) return 0;
    return actualNumber < expectedNumber ? -1 : 1;
  }
  if (typeof actual === "number" || typeof expected === "number") return null;
  // ISO dates (yyyy-MM-dd) order correctly as plain strings.
  const a = normalizeText(actual);
  const b = normalizeText(expected);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function matchesCondition(tx: RuleTarget, condition: RuleCondition): boolean {
  const actual = fieldValue(tx, condition.field);
  if (actual === null) return false;

  switch (condition.op) {
    case "is": {
      const value = condition.value;
      if (Array.isArray(value)) return false;
      if (typeof actual === "number" || typeof value === "number") {
        return compare(actual, value) === 0;
      }
      return normalizeText(actual) === normalizeText(value);
    }
    case "contains":
    case "not_contains": {
      const value = condition.value;
      if (Array.isArray(value)) return false;
      const hit = normalizeText(actual).includes(normalizeText(value));
      return condition.op === "contains" ? hit : !hit;
    }
    case "regex": {
      const value = condition.value;
      if (Array.isArray(value)) return false;
      const pattern = safeRegex(String(value));
      // An invalid pattern never matches; it must not throw and must not
      // silently capture every transaction.
      return pattern ? pattern.test(String(actual)) : false;
    }
    case "one_of": {
      const value = condition.value;
      if (!Array.isArray(value)) return false;
      const haystack = normalizeText(actual);
      return (value as (string | number)[]).some((v) => normalizeText(v) === haystack);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const value = condition.value;
      if (Array.isArray(value)) return false;
      const result = compare(actual, value);
      if (result === null) return false;
      if (condition.op === "gt") return result > 0;
      if (condition.op === "gte") return result >= 0;
      if (condition.op === "lt") return result < 0;
      return result <= 0;
    }
    case "between": {
      const value = condition.value;
      if (!Array.isArray(value) || value.length < 2) return false;
      const low = compare(actual, value[0] as number);
      const high = compare(actual, value[1] as number);
      if (low === null || high === null) return false;
      return low >= 0 && high <= 0;
    }
  }
}

/**
 * Every condition must hold. A disabled rule and a rule with no usable
 * condition never match — an empty draft must not capture the whole ledger.
 */
export function ruleMatches(tx: RuleTarget, rule: TransactionRule): boolean {
  if (!rule.enabled) return false;
  if (rule.conditions.length === 0) return false;
  return rule.conditions.every((condition) => matchesCondition(tx, condition));
}

/* ------------------------------- specificity ------------------------------ */

const OP_WEIGHT: Record<RuleOp, number> = {
  is: 4,
  one_of: 3,
  between: 3,
  regex: 2,
  not_contains: 1,
  contains: 1,
  gt: 1,
  gte: 1,
  lt: 1,
  lte: 1,
};

/**
 * How narrow a rule is: more conditions and tighter operators score higher.
 * Used only for ordering, so the absolute number carries no other meaning.
 */
export function ruleSpecificity(rule: TransactionRule): number {
  return rule.conditions.reduce((total, condition) => total + OP_WEIGHT[condition.op], 0);
}

const STAGE_ORDER: Record<RuleStage, number> = { pre: 0, default: 1, post: 2 };

/**
 * Evaluation order: stage, then least specific first (so the narrower rule
 * writes last and wins), then the owner's sort order, then creation time, then
 * id. Fully deterministic and free of any clock.
 */
export function sortRules(rules: readonly TransactionRule[]): TransactionRule[] {
  return [...rules].sort((a, b) => {
    const stage = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
    if (stage !== 0) return stage;
    const specificity = ruleSpecificity(a) - ruleSpecificity(b);
    if (specificity !== 0) return specificity;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/* --------------------------------- applying ------------------------------- */

/** Drop ids the owner does not own; RLS would reject them at write time. */
function sanitizeActions(actions: RuleActions, owned?: OwnedIds): RuleActions {
  if (!owned) return { ...actions };
  const safe: RuleActions = { ...actions };
  if (typeof safe.project_id === "string" && !owned.projectIds.has(safe.project_id)) {
    delete safe.project_id;
  }
  if (
    typeof safe.subscription_id === "string" &&
    !owned.subscriptionIds.has(safe.subscription_id)
  ) {
    delete safe.subscription_id;
  }
  return safe;
}

/**
 * Fold every matching rule's actions in evaluation order. Later (more specific)
 * rules overwrite earlier ones per field, so the result is the narrowest
 * instruction for each column.
 */
export function resolveRuleActions(
  tx: RuleTarget,
  rules: readonly TransactionRule[],
  owned?: OwnedIds,
): RuleActions {
  const resolved: RuleActions = {};
  for (const rule of sortRules(rules)) {
    if (!ruleMatches(tx, rule)) continue;
    const actions = sanitizeActions(rule.actions, owned);
    for (const key of RULE_ACTION_KEYS) {
      if (key in actions) resolved[key] = actions[key] ?? null;
    }
  }
  return resolved;
}

/** A transaction that already carries the columns a rule can write, so a
 * change can be diffed against what is stored. */
export type RuleApplyTarget = RuleTarget & {
  category?: string | null;
  project_id?: string | null;
  subscription_id?: string | null;
};

function currentValue(tx: RuleApplyTarget, key: RuleActionKey): string | null {
  const value = key === "note" ? tx.note : tx[key];
  return value ?? null;
}

/**
 * Only the columns the rules would actually change on an existing transaction.
 * An empty object means the rules agree with the row as stored, which is what
 * keeps a retroactive apply from issuing pointless writes.
 */
export function ruleChanges(
  tx: RuleApplyTarget,
  rules: readonly TransactionRule[],
  owned?: OwnedIds,
): RuleActions {
  const resolved = resolveRuleActions(tx, rules, owned);
  const changes: RuleActions = {};
  for (const key of RULE_ACTION_KEYS) {
    if (!(key in resolved)) continue;
    const next = resolved[key] ?? null;
    if (next !== currentValue(tx, key)) changes[key] = next;
  }
  return changes;
}

/**
 * All four rule-written columns for a new row — always all four, never only the
 * ones a rule touched. PostgREST refuses a bulk insert whose objects do not
 * share one key set, so the sync and the CSV import must produce a fixed shape
 * whether or not a rule fired for a given row.
 */
export function ruleColumnsForInsert(
  tx: RuleApplyTarget,
  rules: readonly TransactionRule[],
  owned?: OwnedIds,
): Required<RuleActions> {
  const resolved = resolveRuleActions(tx, rules, owned);
  const pick = (key: RuleActionKey): string | null =>
    key in resolved ? (resolved[key] ?? null) : currentValue(tx, key);
  return {
    category: pick("category"),
    note: pick("note"),
    project_id: pick("project_id"),
    subscription_id: pick("subscription_id"),
  };
}

/**
 * An insert-ready row with the rules applied. Used by the GoCardless sync and
 * the CSV import, where there is no stored value to diff against.
 */
export function applyRulesToRow<T extends RuleApplyTarget>(
  row: T,
  rules: readonly TransactionRule[],
  owned?: OwnedIds,
): T & Required<RuleActions> {
  return { ...row, ...ruleColumnsForInsert(row, rules, owned) };
}

/** Rules whose conditions and actions are both usable. A rule with no action
 * is a rule that does nothing, so it is skipped rather than applied. */
export function usableRules(rules: readonly TransactionRule[]): TransactionRule[] {
  return rules.filter(
    (rule) =>
      rule.enabled &&
      rule.conditions.length > 0 &&
      RULE_ACTION_KEYS.some((key) => key in rule.actions),
  );
}
