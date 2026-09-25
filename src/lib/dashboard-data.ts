import type { NavTab } from "@/lib/nav-tabs";

/**
 * Entity payloads needed to render each dashboard destination.
 *
 * The catch-all route uses this map for server-side seeding and the client
 * shell uses the same map to enable lazy React Query fetches after in-shell
 * navigation. Keeping one map prevents the server and client data boundaries
 * from drifting apart.
 */
export const DASHBOARD_DATA_KEYS = [
  "subscriptions",
  "todos",
  "accounts",
  "transactions",
  "plans",
  "notes",
  "prompts",
  "promptLinks",
  "repoNotes",
  "repoLinks",
  "aiLinks",
  "aiCategories",
  "projectLinks",
  "tools",
  "shortcuts",
  "referenceRows",
  "importantDates",
  "invoices",
  "invoiceItems",
  "invoiceSettings",
  "projects",
  "projectCommunications",
  "projectCosts",
  "crons",
  "subscriptionAllocations",
  "competitors",
  "organizations",
  "opportunities",
  "inboxItems",
  "notifications",
  "weeklyReviews",
  "jobListings",
  "jobUserStates",
  "savedJobPositions",
  "jobApplications",
  "jobApplicationEvents",
  "coverLetterTemplates",
  "jobLastRun",
  "todayCalendar",
  "weekCalendar",
  "lastWeekCalendar",
] as const;

export type DashboardDataKey = (typeof DASHBOARD_DATA_KEYS)[number];

const TAB_DATA: Record<NavTab, readonly DashboardDataKey[]> = {
  home: [
    "subscriptions",
    "todos",
    "plans",
    "importantDates",
    "projects",
    "opportunities",
    // The hero's follow-up column covers both pipelines: a client opportunity
    // and a job application both have a date you promised yourself. The
    // scraped listings and their user state stay out; Home shows what is due,
    // not the job board.
    "jobApplications",
    "todayCalendar",
  ],
  inbox: ["inboxItems", "notifications"],
  work: [
    "todos",
    "importantDates",
    "invoices",
    "projects",
    "projectCosts",
    "crons",
    "organizations",
    "opportunities",
    "weeklyReviews",
    "jobApplications",
    // Weekly planning measures last week's calendar time by channel; no other
    // destination reads a finished week.
    "lastWeekCalendar",
  ],
  // A project workspace renders every related record, including the
  // subscription allocations behind its Finance tab and the competitor
  // research behind its Competition tab.
  projects: [
    "subscriptions",
    "subscriptionAllocations",
    "todos",
    "transactions",
    "notes",
    "prompts",
    "repoNotes",
    "repoLinks",
    "importantDates",
    "invoices",
    "invoiceItems",
    "projects",
    "projectCommunications",
    "projectCosts",
    "crons",
    "competitors",
    "organizations",
    "opportunities",
    "inboxItems",
    "aiLinks",
    "aiCategories",
    "projectLinks",
    "promptLinks",
  ],
  competition: ["projects", "competitors"],
  // Opportunities and Career load nothing on entry; see ON_DEMAND_TAB_DATA.
  opportunities: [],
  clients: [
    "todos",
    "notes",
    "importantDates",
    "invoices",
    "invoiceItems",
    "projects",
    "organizations",
    "opportunities",
  ],
  career: ["jobLastRun"],
  // "transactions" so a paid invoice can name the bank payment that settled it.
  invoices: ["invoices", "invoiceItems", "invoiceSettings", "transactions", "projects", "organizations"],
  // The Money overview renders development finance only, so it carries no
  // invoices; its child routes below do, because the unmatched-payments card
  // measures an incoming payment against the invoice it is meant to settle and
  // an invoice has no total column to read instead.
  money: [
    "subscriptions",
    "subscriptionAllocations",
    "accounts",
    "transactions",
    "projects",
    "projectCosts",
    "crons",
  ],
  accounts: ["subscriptions", "subscriptionAllocations", "accounts", "transactions", "invoices", "invoiceItems", "projects", "projectCosts", "crons"],
  transactions: ["subscriptions", "subscriptionAllocations", "accounts", "transactions", "invoices", "invoiceItems", "projects", "projectCosts", "crons"],
  subscriptions: ["subscriptions", "subscriptionAllocations", "projects"],
  categories: ["subscriptions", "subscriptionAllocations", "accounts", "transactions", "invoices", "invoiceItems", "projects", "projectCosts", "crons"],
  tasks: ["todos", "projects", "organizations"],
  calendar: ["weekCalendar"],
  goals: ["plans"],
  dates: ["importantDates", "projects", "organizations"],
  notes: ["notes", "projects", "organizations", "opportunities", "jobApplications"],
  prompts: ["prompts", "promptLinks", "projects", "aiLinks", "aiCategories", "projectLinks"],
  tools: ["tools", "aiLinks", "aiCategories", "projects", "projectLinks", "subscriptions"],
  links: ["aiLinks", "aiCategories", "projectLinks", "projects", "tools"],
  references: ["shortcuts", "referenceRows"],
  settings: ["projects"],
};

/**
 * Data a destination loads only after the owner presses "Check for new
 * offers" (Zkontrolovat nové nabídky). Until then the destination makes no
 * request of its own; afterwards nothing refetches until the next press.
 */
const ON_DEMAND_TAB_DATA: Partial<Record<NavTab, readonly DashboardDataKey[]>> = {
  career: [
    "jobListings",
    "jobUserStates",
    "savedJobPositions",
    "jobApplications",
    "jobApplicationEvents",
    "coverLetterTemplates",
  ],
  opportunities: ["projects", "organizations", "opportunities"],
};

export function dashboardDataKeysForTab(tab: NavTab): ReadonlySet<DashboardDataKey> {
  return new Set(TAB_DATA[tab]);
}

/**
 * Data the browser always fetches itself, even for the destination the server
 * renders. Last week's calendar is the owner's own Monday-to-Monday, and the
 * server's clock (UTC on Vercel) cannot know where that starts.
 */
const CLIENT_ONLY_DATA_KEYS: ReadonlySet<DashboardDataKey> = new Set(["lastWeekCalendar"]);

/** What the server loads and seeds for a destination: its data minus the client-only keys. */
export function serverDataKeysForTab(tab: NavTab): ReadonlySet<DashboardDataKey> {
  return new Set(TAB_DATA[tab].filter((key) => !CLIENT_ONLY_DATA_KEYS.has(key)));
}

export function onDemandDataKeys(tab: NavTab): readonly DashboardDataKey[] {
  return ON_DEMAND_TAB_DATA[tab] ?? [];
}

/** Whether `key` is loaded for `tab`: always, or once the owner asked. */
export function tabNeedsDashboardData(
  tab: NavTab,
  key: DashboardDataKey,
  activated = false,
): boolean {
  return TAB_DATA[tab].includes(key) || (activated && onDemandDataKeys(tab).includes(key));
}
