/**
 * Dashboard (overview) widget layout — framework-free constants and helpers.
 *
 * The overview tab is user-customizable: widgets can be reordered, removed, and
 * re-added. A layout is just an ordered list of widget ids, persisted
 * client-side (see use-dashboard-layout.ts) following the same localStorage
 * approach as the other device-local UI prefs in use-prefs.ts.
 *
 * This module holds only data + pure logic so it can be unit-tested and shared
 * safely across the server/client boundary.
 */

export type WidgetId =
  | "today-hero"
  | "quick-add"
  | "kpi"
  | "todos"
  | "streaks"
  | "subscriptions"
  | "calendar"
  | "plans";

/** Every widget the overview knows how to render, in canonical order. */
export const WIDGET_IDS: readonly WidgetId[] = [
  "today-hero",
  "quick-add",
  "kpi",
  "todos",
  "streaks",
  "subscriptions",
  "calendar",
  "plans",
];

/**
 * The layout shown until the user customizes anything. Tasks sit right under
 * the greeting hero — the largest, first thing you act on — with the lighter
 * quick-add / KPI cards below.
 */
export const DEFAULT_LAYOUT: readonly WidgetId[] = [
  "today-hero",
  "todos",
  "kpi",
  "quick-add",
  "streaks",
  "subscriptions",
  "calendar",
  "plans",
];

const KNOWN = new Set<WidgetId>(WIDGET_IDS);

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && KNOWN.has(value as WidgetId);
}

/**
 * Coerce arbitrary persisted/user input into a valid layout: keep only known
 * widget ids, drop duplicates, preserve order. Returns a fresh array, falling
 * back to the default layout when the input is not an array.
 */
export function normalizeLayout(input: unknown): WidgetId[] {
  if (!Array.isArray(input)) return [...DEFAULT_LAYOUT];
  const seen = new Set<WidgetId>();
  const out: WidgetId[] = [];
  for (const item of input) {
    if (isWidgetId(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/**
 * Widget ids not currently in the layout — the "available to add" set, in
 * canonical order.
 */
export function availableWidgets(layout: readonly WidgetId[]): WidgetId[] {
  const present = new Set(layout);
  return WIDGET_IDS.filter((id) => !present.has(id));
}

/** Append a widget if it's known and not already present. Returns a fresh array. */
export function withWidget(
  layout: readonly WidgetId[],
  id: WidgetId,
): WidgetId[] {
  if (!isWidgetId(id) || layout.includes(id)) return [...layout];
  return [...layout, id];
}

/** Remove a widget. Returns a fresh array. */
export function withoutWidget(
  layout: readonly WidgetId[],
  id: WidgetId,
): WidgetId[] {
  return layout.filter((w) => w !== id);
}

/**
 * Move the widget at index `from` to index `to` (both clamped into range).
 * Returns a fresh array; a no-op move returns an equivalent copy.
 */
export function moveWidget(
  layout: readonly WidgetId[],
  from: number,
  to: number,
): WidgetId[] {
  const next = [...layout];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(to, next.length - 1));
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}
