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
] as const;

export type DashboardDataKey = (typeof DASHBOARD_DATA_KEYS)[number];

/**
 * A project workspace (reached from Projects or Works) renders every related
 * record, including the subscription allocations behind its Finance tab, the
 * competitor research behind its Competition tab and the scored resource
 * library behind its Links tab.
 */
const PROJECT_WORKSPACE_DATA: readonly DashboardDataKey[] = [
  "subscriptions",
  "subscriptionAllocations",
  "todos",
  "transactions",
  "notes",
  "prompts",
  "repoNotes",
  "repoLinks",
  "aiLinks",
  "aiCategories",
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
  "notifications",
];

const TAB_DATA: Record<NavTab, readonly DashboardDataKey[]> = {
  home: [
    "subscriptions",
    "todos",
    "plans",
    "importantDates",
    "projects",
    "opportunities",
    "inboxItems",
    "notifications",
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
    "notifications",
    "weeklyReviews",
    "jobApplications",
  ],
  projects: PROJECT_WORKSPACE_DATA,
  works: PROJECT_WORKSPACE_DATA,
  competition: ["projects", "competitors", "notifications"],
  opportunities: ["projects", "organizations", "opportunities", "notifications"],
  clients: [
    "todos",
    "notes",
    "importantDates",
    "invoices",
    "invoiceItems",
    "projects",
    "organizations",
    "opportunities",
    "notifications",
  ],
  career: [
    "notifications",
    "jobListings",
    "jobUserStates",
    "savedJobPositions",
    "jobApplications",
    "jobApplicationEvents",
    "coverLetterTemplates",
    "jobLastRun",
  ],
  invoices: ["invoices", "invoiceItems", "invoiceSettings", "projects", "organizations", "notifications"],
  money: [
    "subscriptions",
    "subscriptionAllocations",
    "accounts",
    "transactions",
    "projects",
    "projectCosts",
    "crons",
    "notifications",
  ],
  accounts: ["subscriptions", "subscriptionAllocations", "accounts", "transactions", "projects", "projectCosts", "crons", "notifications"],
  transactions: ["subscriptions", "subscriptionAllocations", "accounts", "transactions", "projects", "projectCosts", "crons", "notifications"],
  subscriptions: ["subscriptions", "subscriptionAllocations", "projects", "notifications"],
  categories: ["subscriptions", "subscriptionAllocations", "accounts", "transactions", "projects", "projectCosts", "crons", "notifications"],
  tasks: ["todos", "projects", "organizations", "notifications"],
  calendar: ["notifications", "weekCalendar"],
  goals: ["plans", "notifications"],
  dates: ["importantDates", "projects", "organizations", "notifications"],
  notes: ["notes", "projects", "organizations", "opportunities", "jobApplications", "notifications"],
  prompts: ["prompts", "projects", "notifications"],
  links: ["aiLinks", "aiCategories", "notifications"],
  references: ["shortcuts", "referenceRows", "notifications"],
  settings: ["projects", "notifications"],
};

export function dashboardDataKeysForTab(tab: NavTab): ReadonlySet<DashboardDataKey> {
  return new Set(TAB_DATA[tab]);
}

export function tabNeedsDashboardData(tab: NavTab, key: DashboardDataKey): boolean {
  return TAB_DATA[tab].includes(key);
}
