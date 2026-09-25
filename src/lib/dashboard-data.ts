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
  "repoNotes",
  "repoLinks",
  "aiLinks",
  "aiCategories",
  "projectLinks",
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
  ],
  projects: [
    "subscriptions",
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
    "organizations",
    "opportunities",
    "inboxItems",
    "aiLinks",
    "aiCategories",
    "projectLinks",
  ],
  opportunities: ["projects", "organizations", "opportunities"],
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
  career: [
    "jobListings",
    "jobUserStates",
    "savedJobPositions",
    "jobApplications",
    "jobApplicationEvents",
    "coverLetterTemplates",
    "jobLastRun",
  ],
  invoices: ["invoices", "invoiceItems", "invoiceSettings", "projects", "organizations"],
  money: [
    "subscriptions",
    "accounts",
    "transactions",
    "projects",
    "projectCosts",
    "crons",
  ],
  accounts: ["subscriptions", "accounts", "transactions", "projects", "projectCosts", "crons"],
  transactions: ["subscriptions", "accounts", "transactions", "projects", "projectCosts", "crons"],
  subscriptions: ["subscriptions", "projects"],
  categories: ["subscriptions", "accounts", "transactions", "projects", "projectCosts", "crons"],
  tasks: ["todos", "projects", "organizations"],
  calendar: ["weekCalendar"],
  goals: ["plans"],
  dates: ["importantDates", "projects", "organizations"],
  notes: ["notes", "projects", "organizations", "opportunities", "jobApplications"],
  prompts: ["prompts", "projects"],
  links: ["aiLinks", "aiCategories", "projectLinks", "projects"],
  references: ["shortcuts", "referenceRows"],
  settings: ["projects"],
};

export function dashboardDataKeysForTab(tab: NavTab): ReadonlySet<DashboardDataKey> {
  return new Set(TAB_DATA[tab]);
}

export function tabNeedsDashboardData(tab: NavTab, key: DashboardDataKey): boolean {
  return TAB_DATA[tab].includes(key);
}
