import { describe, expect, it } from "vitest";
import {
  applyRulesToRow,
  matchesCondition,
  parseActions,
  parseConditions,
  parseRules,
  resolveRuleActions,
  ruleChanges,
  ruleMatches,
  ruleSpecificity,
  safeRegex,
  sortRules,
  usableRules,
  type RuleCondition,
  type TransactionRule,
} from "../../src/lib/transaction-rules";

const tx = {
  id: "tx1",
  note: "ALBERT 1234 PRAHA",
  account_id: "acct-1",
  amount: 412.5,
  occurred_on: "2026-03-14",
  kind: "expense",
  category: null as string | null,
  project_id: null as string | null,
  subscription_id: null as string | null,
};

function rule(partial: Partial<TransactionRule> & { id: string }): TransactionRule {
  return {
    user_id: "u1",
    name: "",
    stage: "default",
    conditions: [],
    actions: {},
    sort_order: 0,
    enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

const condition = (raw: RuleCondition): RuleCondition => raw;

describe("matchesCondition", () => {
  it("matches text case-insensitively on the note", () => {
    expect(
      matchesCondition(tx, condition({ field: "note", op: "contains", value: "albert" })),
    ).toBe(true);
    expect(
      matchesCondition(tx, condition({ field: "note", op: "contains", value: "shell" })),
    ).toBe(false);
  });

  it("supports is and not_contains", () => {
    expect(
      matchesCondition(tx, condition({ field: "kind", op: "is", value: "EXPENSE" })),
    ).toBe(true);
    expect(
      matchesCondition(
        tx,
        condition({ field: "note", op: "not_contains", value: "tesco" }),
      ),
    ).toBe(true);
    expect(
      matchesCondition(
        tx,
        condition({ field: "note", op: "not_contains", value: "albert" }),
      ),
    ).toBe(false);
  });

  it("matches one_of against any listed value", () => {
    expect(
      matchesCondition(
        tx,
        condition({ field: "account", op: "one_of", value: ["acct-9", "ACCT-1"] }),
      ),
    ).toBe(true);
    expect(
      matchesCondition(
        tx,
        condition({ field: "account", op: "one_of", value: ["acct-9"] }),
      ),
    ).toBe(false);
  });

  it("compares amounts numerically", () => {
    expect(
      matchesCondition(tx, condition({ field: "amount", op: "gt", value: 400 })),
    ).toBe(true);
    expect(
      matchesCondition(tx, condition({ field: "amount", op: "lt", value: 400 })),
    ).toBe(false);
    expect(
      matchesCondition(tx, condition({ field: "amount", op: "between", value: [400, 500] })),
    ).toBe(true);
    expect(
      matchesCondition(tx, condition({ field: "amount", op: "between", value: [500, 600] })),
    ).toBe(false);
  });

  it("compares ISO dates in order", () => {
    expect(
      matchesCondition(tx, condition({ field: "date", op: "gte", value: "2026-03-01" })),
    ).toBe(true);
    expect(
      matchesCondition(tx, condition({ field: "date", op: "lt", value: "2026-01-01" })),
    ).toBe(false);
  });

  it("matches a regular expression case-insensitively", () => {
    expect(
      matchesCondition(tx, condition({ field: "note", op: "regex", value: "^albert\\s" })),
    ).toBe(true);
  });

  it("never matches on an invalid pattern instead of throwing", () => {
    expect(safeRegex("([")).toBeNull();
    expect(() =>
      matchesCondition(tx, condition({ field: "note", op: "regex", value: "([" })),
    ).not.toThrow();
    expect(
      matchesCondition(tx, condition({ field: "note", op: "regex", value: "([" })),
    ).toBe(false);
  });

  it("never matches when the transaction has no value for the field", () => {
    expect(
      matchesCondition(
        { note: null },
        condition({ field: "note", op: "contains", value: "albert" }),
      ),
    ).toBe(false);
  });
});

describe("parseConditions", () => {
  it("drops entries with an unknown field or operator", () => {
    expect(
      parseConditions([
        { field: "payee", op: "contains", value: "albert" },
        { field: "note", op: "sounds_like", value: "albert" },
        { field: "note", op: "contains", value: "albert" },
      ]),
    ).toEqual([{ field: "note", op: "contains", value: "albert" }]);
  });

  it("drops blank, missing and wrongly shaped values", () => {
    expect(
      parseConditions([
        { field: "note", op: "contains", value: "   " },
        { field: "note", op: "contains" },
        { field: "amount", op: "between", value: [5] },
        { field: "account", op: "one_of", value: "not-an-array" },
      ]),
    ).toEqual([]);
  });

  it("orders a reversed between range and normalises one_of", () => {
    expect(
      parseConditions([
        { field: "amount", op: "between", value: [900, 100] },
        { field: "account", op: "one_of", value: [" a ", "", "b"] },
      ]),
    ).toEqual([
      { field: "amount", op: "between", value: [100, 900] },
      { field: "account", op: "one_of", value: ["a", "b"] },
    ]);
  });

  it("refuses a condition whose pattern cannot compile", () => {
    expect(parseConditions([{ field: "note", op: "regex", value: "([" }])).toEqual([]);
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(parseConditions(null)).toEqual([]);
    expect(parseConditions({ field: "note" })).toEqual([]);
    expect(parseConditions(42)).toEqual([]);
  });
});

describe("parseActions", () => {
  it("keeps known keys, trims text and preserves an explicit null", () => {
    expect(
      parseActions({
        category: " Groceries ",
        project_id: null,
        note: "",
        amount: 10,
        unknown: "x",
      }),
    ).toEqual({ category: "Groceries", project_id: null, note: null });
  });

  it("returns nothing for a malformed blob", () => {
    expect(parseActions(null)).toEqual({});
    expect(parseActions(["category"])).toEqual({});
  });
});

describe("parseRules", () => {
  it("counts rows it cannot read instead of hiding them", () => {
    const result = parseRules([
      { id: "r1", user_id: "u1", stage: "default", conditions: [], actions: {} },
      { id: 7, user_id: "u1" },
      null,
    ]);
    expect(result.rules).toHaveLength(1);
    expect(result.dropped).toBe(2);
  });

  it("falls back to the default stage for an unknown stage", () => {
    const { rules } = parseRules([
      { id: "r1", user_id: "u1", stage: "whenever", conditions: [], actions: {} },
    ]);
    expect(rules[0].stage).toBe("default");
  });
});

describe("ruleMatches", () => {
  const conditions: RuleCondition[] = [
    { field: "note", op: "contains", value: "albert" },
    { field: "amount", op: "gt", value: 100 },
  ];

  it("requires every condition to hold", () => {
    expect(ruleMatches(tx, rule({ id: "r1", conditions }))).toBe(true);
    expect(
      ruleMatches(
        tx,
        rule({
          id: "r2",
          conditions: [...conditions, { field: "kind", op: "is", value: "income" }],
        }),
      ),
    ).toBe(false);
  });

  it("never matches a disabled rule", () => {
    expect(ruleMatches(tx, rule({ id: "r1", conditions, enabled: false }))).toBe(false);
  });

  it("never matches a rule with no conditions", () => {
    expect(ruleMatches(tx, rule({ id: "r1", conditions: [] }))).toBe(false);
  });
});

describe("ruleSpecificity and sortRules", () => {
  it("scores more conditions and tighter operators higher", () => {
    const broad = rule({
      id: "broad",
      conditions: [{ field: "note", op: "contains", value: "a" }],
    });
    const tight = rule({
      id: "tight",
      conditions: [{ field: "note", op: "is", value: "a" }],
    });
    const tighter = rule({
      id: "tighter",
      conditions: [
        { field: "note", op: "is", value: "a" },
        { field: "kind", op: "is", value: "expense" },
      ],
    });
    expect(ruleSpecificity(broad)).toBeLessThan(ruleSpecificity(tight));
    expect(ruleSpecificity(tight)).toBeLessThan(ruleSpecificity(tighter));
  });

  it("orders by stage first, then least specific first", () => {
    const post = rule({
      id: "post",
      stage: "post",
      conditions: [{ field: "note", op: "is", value: "a" }],
    });
    const pre = rule({
      id: "pre",
      stage: "pre",
      conditions: [
        { field: "note", op: "is", value: "a" },
        { field: "kind", op: "is", value: "expense" },
      ],
    });
    const broad = rule({
      id: "broad",
      conditions: [{ field: "note", op: "contains", value: "a" }],
    });
    const tight = rule({
      id: "tight",
      conditions: [{ field: "note", op: "is", value: "a" }],
    });
    expect(sortRules([tight, post, broad, pre]).map((r) => r.id)).toEqual([
      "pre",
      "broad",
      "tight",
      "post",
    ]);
  });

  it("is deterministic for rules that tie on every ranked field", () => {
    const a = rule({ id: "a", conditions: [{ field: "note", op: "is", value: "x" }] });
    const b = rule({ id: "b", conditions: [{ field: "note", op: "is", value: "x" }] });
    expect(sortRules([b, a]).map((r) => r.id)).toEqual(["a", "b"]);
    expect(sortRules([a, b]).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("resolveRuleActions", () => {
  it("lets the more specific rule overwrite the broader one", () => {
    const broad = rule({
      id: "broad",
      conditions: [{ field: "note", op: "contains", value: "albert" }],
      actions: { category: "Shopping" },
    });
    const tight = rule({
      id: "tight",
      conditions: [
        { field: "note", op: "contains", value: "albert" },
        { field: "amount", op: "gt", value: 100 },
      ],
      actions: { category: "Groceries" },
    });
    expect(resolveRuleActions(tx, [tight, broad])).toEqual({ category: "Groceries" });
  });

  it("merges actions per field rather than replacing the whole set", () => {
    const first = rule({
      id: "first",
      conditions: [{ field: "note", op: "contains", value: "albert" }],
      actions: { category: "Groceries" },
    });
    const second = rule({
      id: "second",
      stage: "post",
      conditions: [{ field: "kind", op: "is", value: "expense" }],
      actions: { project_id: "p1" },
    });
    expect(
      resolveRuleActions(tx, [first, second], {
        projectIds: new Set(["p1"]),
        subscriptionIds: new Set(),
      }),
    ).toEqual({ category: "Groceries", project_id: "p1" });
  });

  it("drops a project or subscription the owner does not own", () => {
    const foreign = rule({
      id: "foreign",
      conditions: [{ field: "note", op: "contains", value: "albert" }],
      actions: { category: "Groceries", project_id: "someone-else", subscription_id: "s9" },
    });
    expect(
      resolveRuleActions(tx, [foreign], {
        projectIds: new Set(["p1"]),
        subscriptionIds: new Set(["s1"]),
      }),
    ).toEqual({ category: "Groceries" });
  });

  it("keeps an explicit null, because clearing a column is a real action", () => {
    const clearing = rule({
      id: "clear",
      conditions: [{ field: "note", op: "contains", value: "albert" }],
      actions: { category: null },
    });
    expect(resolveRuleActions(tx, [clearing])).toEqual({ category: null });
    expect(ruleChanges({ ...tx, category: "Old" }, [clearing])).toEqual({
      category: null,
    });
  });
});

describe("ruleChanges", () => {
  const filing = rule({
    id: "filing",
    conditions: [{ field: "note", op: "contains", value: "albert" }],
    actions: { category: "Groceries" },
  });

  it("returns only the columns that would actually change", () => {
    expect(ruleChanges(tx, [filing])).toEqual({ category: "Groceries" });
    expect(ruleChanges({ ...tx, category: "Groceries" }, [filing])).toEqual({});
  });

  it("returns nothing when no rule matches", () => {
    expect(ruleChanges({ ...tx, note: "Tesco" }, [filing])).toEqual({});
  });
});

describe("applyRulesToRow", () => {
  const filing = rule({
    id: "filing",
    conditions: [{ field: "note", op: "contains", value: "albert" }],
    actions: { category: "Groceries" },
  });
  const row = {
    user_id: "u1",
    account_id: null,
    kind: "expense" as const,
    amount: 412.5,
    currency: "CZK",
    category: null as string | null,
    note: "ALBERT 1234 PRAHA",
    occurred_on: "2026-03-14",
    external_id: "csv:1",
  };

  it("fills an insert-ready row without touching untouched columns", () => {
    expect(applyRulesToRow(row, [filing])).toEqual({
      ...row,
      category: "Groceries",
      project_id: null,
      subscription_id: null,
    });
  });

  it("emits the same column set whether or not a rule fired", () => {
    const matchedKeys = Object.keys(applyRulesToRow(row, [filing])).sort();
    const unmatchedKeys = Object.keys(
      applyRulesToRow({ ...row, note: "Tesco" }, [filing]),
    ).sort();
    // A bulk insert is rejected when its rows disagree on their keys.
    expect(matchedKeys).toEqual(unmatchedKeys);
    expect(matchedKeys).toContain("project_id");
  });

  it("keeps the row's own note when no rule rewrites it", () => {
    expect(applyRulesToRow(row, [filing]).note).toBe("ALBERT 1234 PRAHA");
  });
});

describe("usableRules", () => {
  it("skips disabled rules, rules without conditions and rules without actions", () => {
    const ok = rule({
      id: "ok",
      conditions: [{ field: "note", op: "contains", value: "a" }],
      actions: { category: "X" },
    });
    const noAction = rule({
      id: "no-action",
      conditions: [{ field: "note", op: "contains", value: "a" }],
    });
    const noCondition = rule({ id: "no-condition", actions: { category: "X" } });
    const off = rule({
      id: "off",
      enabled: false,
      conditions: [{ field: "note", op: "contains", value: "a" }],
      actions: { category: "X" },
    });
    expect(usableRules([ok, noAction, noCondition, off]).map((r) => r.id)).toEqual(["ok"]);
  });
});
