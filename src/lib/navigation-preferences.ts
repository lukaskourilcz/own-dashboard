import { LEGACY_ROUTE_ALIASES, NAV_TABS, isHiddenNavTab, type NavTab } from "@/lib/nav-tabs";
const eligible = new Set<string>(NAV_TABS.filter(id => id !== "home" && id !== "settings" && !isHiddenNavTab(id)));
/** Only current navigation destinations or meaningful legacy aliases survive. */
export function normalizeNavPreferenceIds(input: unknown): NavTab[] {
  if (!Array.isArray(input)) return [];
  const result = new Set<NavTab>();
  for (const item of input) {
    if (typeof item !== "string") continue;
    const current = Object.hasOwn(LEGACY_ROUTE_ALIASES, item) ? LEGACY_ROUTE_ALIASES[item as keyof typeof LEGACY_ROUTE_ALIASES] : item;
    if (eligible.has(current)) result.add(current as NavTab);
  }
  return [...result];
}
