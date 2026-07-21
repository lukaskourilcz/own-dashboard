import type { QueryKey } from "@tanstack/react-query";

/**
 * Centralised React Query keys. Module-level constants → stable references, so
 * hooks can depend on them without re-subscribing every render.
 */
export const qk = {
  // Dashboard entities (seeded from the server load, mutated in place).
  subscriptions: ["subscriptions"] as const,
  todos: ["todos"] as const,
  accounts: ["accounts"] as const,
  transactions: ["transactions"] as const,
  plans: ["plans"] as const,
  organizations: ["organizations"] as const,
  opportunities: ["opportunities"] as const,
  inboxItems: ["inboxItems"] as const,
  notifications: ["notifications"] as const,
  weeklyReviews: ["weeklyReviews"] as const,
  notes: ["notes"] as const,
  prompts: ["prompts"] as const,
  repoNotes: ["repoNotes"] as const,
  repoLinks: ["repoLinks"] as const,
  projects: ["projects"] as const,
  projectCosts: ["projectCosts"] as const,
  crons: ["crons"] as const,
  aiLinks: ["aiLinks"] as const,
  aiCategories: ["aiCategories"] as const,
  spendCategories: ["spendCategories"] as const,
  shortcuts: ["shortcuts"] as const,
  referenceRows: ["referenceRows"] as const,
  importantDates: ["importantDates"] as const,
  invoices: ["invoices"] as const,
  invoiceItems: ["invoiceItems"] as const,
  invoiceSettings: ["invoiceSettings"] as const,
  jobListings: ["jobListings"] as const,
  jobUserStates: ["jobUserStates"] as const,
  jobApplications: ["jobApplications"] as const,
  jobApplicationEvents: ["jobApplicationEvents"] as const,
  coverLetterTemplates: ["coverLetterTemplates"] as const,
  jobLastRun: ["jobLastRun"] as const,
  bankConnections: ["bankConnections"] as const,
  categoryRules: ["categoryRules"] as const,
  // Network-backed.
  repos: ["github", "repos"] as const,
  calendarList: ["calendar", "list"] as const,
  calendarToday: ["calendar", "events", "today"] as const,
  calendarWeek: ["calendar", "events", "week"] as const,
} satisfies Record<string, QueryKey>;
