// Canonical professional information architecture. The app intentionally keeps
// its existing catch-all SPA shell; these ids are both the client view keys and
// the canonical URL slugs.
export const NAV_TABS = [
  "home",
  "inbox",
  "work",
  "projects",
  "opportunities",
  "clients",
  "agents",
  "career",
  "invoices",
  "money",
  "accounts",
  "transactions",
  "subscriptions",
  "categories",
  "tasks",
  "calendar",
  "goals",
  "dates",
  "notes",
  "prompts",
  "links",
  "references",
  "settings",
] as const;

export type NavTab = (typeof NAV_TABS)[number];

/** Old bookmarks that still have a meaningful professional destination. */
export const LEGACY_ROUTE_ALIASES = {
  overview: "home",
  todos: "tasks",
  plans: "goals",
  jobs: "career",
  finances: "money",
  github: "projects",
  repositories: "projects",
  costs: "projects",
  scaling: "projects",
  ai: "links",
  "ai-links": "links",
  shortcuts: "references",
  tugedr: "opportunities",
} as const satisfies Record<string, NavTab>;

export function isNavTab(value: string | undefined | null): value is NavTab {
  return value != null && (NAV_TABS as readonly string[]).includes(value);
}

export function isNavPathSegment(value: string | undefined | null): boolean {
  return (
    isNavTab(value) ||
    (value != null && value in LEGACY_ROUTE_ALIASES)
  );
}

/** The only nested dashboard route is a canonical project workspace. */
export function isDashboardSlug(slug: string[] | undefined): boolean {
  if (!slug || slug.length === 0) return true;
  if (slug.length === 1) return isNavPathSegment(slug[0]);
  return slug.length === 2 && slug[0] === "projects" && slug[1].trim().length > 0;
}

export function tabToPath(tab: NavTab): string {
  return tab === "home" ? "/" : `/${tab}`;
}

export function tabFromSlug(slug: string[] | undefined): NavTab {
  const first = slug?.[0];
  if (isNavTab(first)) return first;
  if (first && first in LEGACY_ROUTE_ALIASES) {
    return LEGACY_ROUTE_ALIASES[first as keyof typeof LEGACY_ROUTE_ALIASES];
  }
  return "home";
}

export function tabFromPath(pathname: string): NavTab {
  const segment = pathname.replace(/^\//, "").split("/")[0];
  return tabFromSlug(segment ? [segment] : undefined);
}

export function isLegacyRouteSegment(value: string | undefined): boolean {
  return value != null && value in LEGACY_ROUTE_ALIASES;
}
