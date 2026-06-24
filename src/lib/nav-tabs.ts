// Canonical list of dashboard sections — the source of truth for valid tab
// ids and their URL slugs. (The sidebar's display order lives in NAV_ITEMS;
// this list is only about which ids are valid.) No "use client" and no
// client-only imports, so both the server route and client shell can use it.

export const NAV_TABS = [
  "overview",
  "calendar",
  "notes",
  "prompts",
  "shortcuts",
  "todos",
  "streaks",
  "finances",
  "invoices",
  "subscriptions",
  "plans",
  "books",
  "dates",
  "couple",
  "github",
  "costs",
  "ai",
  "settings",
] as const;

export type NavTab = (typeof NAV_TABS)[number];

export function isNavTab(value: string | undefined | null): value is NavTab {
  return value != null && (NAV_TABS as readonly string[]).includes(value);
}

/** URL path for a tab. Overview is the site root. */
export function tabToPath(tab: NavTab): string {
  return tab === "overview" ? "/" : `/${tab}`;
}

/** Resolve the active tab from an optional catch-all slug (server side). */
export function tabFromSlug(slug: string[] | undefined): NavTab {
  const first = slug?.[0];
  return isNavTab(first) ? first : "overview";
}

/** Resolve the active tab from a pathname (client side, e.g. on popstate). */
export function tabFromPath(pathname: string): NavTab {
  const seg = pathname.replace(/^\//, "").split("/")[0];
  return isNavTab(seg) ? seg : "overview";
}
