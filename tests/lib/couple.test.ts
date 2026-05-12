import { describe, expect, it } from "vitest";
import { partnerSharesCategory } from "@/lib/couple";
import type { SharingPrefs } from "@/lib/types";

function prefs(overrides: Partial<SharingPrefs> = {}): SharingPrefs {
  return {
    user_id: "u",
    share_subscriptions: false,
    share_todos: false,
    share_streaks: false,
    share_finances: false,
    share_plans: false,
    share_books: false,
    updated_at: "",
    ...overrides,
  };
}

describe("partnerSharesCategory", () => {
  it("returns false when prefs are null", () => {
    expect(partnerSharesCategory(null, "todos")).toBe(false);
  });

  it("reads the matching flag for each category", () => {
    expect(
      partnerSharesCategory(prefs({ share_subscriptions: true }), "subscriptions"),
    ).toBe(true);
    expect(partnerSharesCategory(prefs({ share_todos: true }), "todos")).toBe(
      true,
    );
    expect(
      partnerSharesCategory(prefs({ share_streaks: true }), "streaks"),
    ).toBe(true);
    expect(
      partnerSharesCategory(prefs({ share_finances: true }), "finances"),
    ).toBe(true);
    expect(partnerSharesCategory(prefs({ share_plans: true }), "plans")).toBe(
      true,
    );
    expect(partnerSharesCategory(prefs({ share_books: true }), "books")).toBe(
      true,
    );
  });

  it("returns false when the matching flag is off", () => {
    expect(
      partnerSharesCategory(prefs({ share_todos: true }), "streaks"),
    ).toBe(false);
  });
});
