import { describe, it, expect } from "vitest";
import {
  availableWidgets,
  DEFAULT_LAYOUT,
  isWidgetId,
  moveWidget,
  normalizeLayout,
  WIDGET_IDS,
  withWidget,
  withoutWidget,
  type WidgetId,
} from "@/lib/dashboard-layout";

describe("isWidgetId", () => {
  it("accepts known ids and rejects everything else", () => {
    expect(isWidgetId("todos")).toBe(true);
    expect(isWidgetId("calendar")).toBe(true);
    expect(isWidgetId("nope")).toBe(false);
    expect(isWidgetId(42)).toBe(false);
    expect(isWidgetId(null)).toBe(false);
    expect(isWidgetId(undefined)).toBe(false);
  });
});

describe("normalizeLayout", () => {
  it("falls back to the default layout for non-arrays", () => {
    expect(normalizeLayout(null)).toEqual([...DEFAULT_LAYOUT]);
    expect(normalizeLayout("todos")).toEqual([...DEFAULT_LAYOUT]);
    expect(normalizeLayout(undefined)).toEqual([...DEFAULT_LAYOUT]);
  });

  it("drops unknown ids while preserving order", () => {
    expect(normalizeLayout(["calendar", "bogus", "todos"])).toEqual([
      "calendar",
      "todos",
    ]);
  });

  it("removes duplicates, keeping the first occurrence", () => {
    expect(normalizeLayout(["todos", "todos", "kpi", "todos"])).toEqual([
      "todos",
      "kpi",
    ]);
  });

  it("returns an empty array when nothing is valid", () => {
    expect(normalizeLayout(["x", 1, {}])).toEqual([]);
  });

  it("returns a fresh array (does not alias the input)", () => {
    const input: unknown[] = ["todos"];
    const out = normalizeLayout(input);
    expect(out).not.toBe(input);
  });
});

describe("availableWidgets", () => {
  it("returns ids not present, in canonical order", () => {
    expect(availableWidgets(["kpi", "todos"])).toEqual(
      WIDGET_IDS.filter((id) => id !== "kpi" && id !== "todos"),
    );
  });

  it("returns nothing when the default layout is complete", () => {
    expect(availableWidgets(DEFAULT_LAYOUT)).toEqual([]);
  });

  it("returns everything for an empty layout", () => {
    expect(availableWidgets([])).toEqual([...WIDGET_IDS]);
  });
});

describe("withWidget", () => {
  it("appends an absent widget", () => {
    expect(withWidget(["kpi"], "todos")).toEqual(["kpi", "todos"]);
  });

  it("is a no-op when the widget is already present", () => {
    const layout: WidgetId[] = ["kpi", "todos"];
    expect(withWidget(layout, "todos")).toEqual(["kpi", "todos"]);
  });

  it("does not mutate the input", () => {
    const layout: WidgetId[] = ["kpi"];
    withWidget(layout, "todos");
    expect(layout).toEqual(["kpi"]);
  });
});

describe("withoutWidget", () => {
  it("removes the widget", () => {
    expect(withoutWidget(["kpi", "todos", "calendar"], "todos")).toEqual([
      "kpi",
      "calendar",
    ]);
  });

  it("is a no-op when the widget is absent", () => {
    expect(withoutWidget(["kpi"], "todos")).toEqual(["kpi"]);
  });
});

describe("moveWidget", () => {
  const base: WidgetId[] = ["kpi", "todos", "work-attention", "calendar"];

  it("moves an item forward", () => {
    expect(moveWidget(base, 0, 2)).toEqual([
      "todos",
      "work-attention",
      "kpi",
      "calendar",
    ]);
  });

  it("moves an item backward", () => {
    expect(moveWidget(base, 3, 1)).toEqual([
      "kpi",
      "calendar",
      "todos",
      "work-attention",
    ]);
  });

  it("clamps an out-of-range target", () => {
    expect(moveWidget(base, 0, 99)).toEqual([
      "todos",
      "work-attention",
      "calendar",
      "kpi",
    ]);
  });

  it("returns an unchanged copy for an out-of-range source", () => {
    const out = moveWidget(base, 99, 0);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });

  it("does not mutate the input", () => {
    moveWidget(base, 0, 2);
    expect(base).toEqual(["kpi", "todos", "work-attention", "calendar"]);
  });
});
