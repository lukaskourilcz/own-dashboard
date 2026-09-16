import { describe, expect, it } from "vitest";
import {
  categorizeNote,
  legacyRuleToTransactionRule,
} from "../../src/lib/category-rules";

const rules = [
  { match: "albert", category: "Groceries" },
  { match: "shell", category: "Fuel" },
  { match: "netflix", category: "Subscriptions" },
];

describe("categorizeNote", () => {
  it("matches case-insensitively on a substring of the note", () => {
    expect(categorizeNote("ALBERT 1234 PRAHA", rules)).toBe("Groceries");
    expect(categorizeNote("Shell CZ Brno", rules)).toBe("Fuel");
  });

  it("returns the first matching rule when several could apply", () => {
    const r = [
      { match: "albert heijn", category: "Groceries NL" },
      { match: "albert", category: "Groceries" },
    ];
    expect(categorizeNote("ALBERT HEIJN AMSTERDAM", r)).toBe("Groceries NL");
  });

  it("returns null when nothing matches", () => {
    expect(categorizeNote("Random merchant", rules)).toBeNull();
  });

  it("returns null for an empty or missing note", () => {
    expect(categorizeNote("", rules)).toBeNull();
    expect(categorizeNote(null, rules)).toBeNull();
    expect(categorizeNote(undefined, rules)).toBeNull();
  });

  it("ignores blank rule patterns", () => {
    expect(categorizeNote("anything", [{ match: "  ", category: "X" }])).toBeNull();
  });
});

describe("legacyRuleToTransactionRule", () => {
  it("turns a keyword rule into one 'note contains' rule in the default stage", () => {
    const converted = legacyRuleToTransactionRule({ match: " Albert ", category: "Groceries" }, 3);
    expect(converted.stage).toBe("default");
    expect(converted.conditions).toEqual([
      { field: "note", op: "contains", value: "Albert" },
    ]);
    expect(converted.actions).toEqual({ category: "Groceries" });
    expect(converted.sort_order).toBe(3);
  });

  it("disables a blank keyword so it cannot capture everything", () => {
    expect(legacyRuleToTransactionRule({ match: "  ", category: "X" }, 0).enabled).toBe(false);
  });
});
