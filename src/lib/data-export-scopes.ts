export const exportScopes = ["legacy", "financial", "professional", "knowledge", "projects", "notes", "prompts", "career", "full"] as const;
export type ExportScope = (typeof exportScopes)[number];

export const exportTables: Record<Exclude<ExportScope, "legacy" | "full">, readonly string[]> = {
  financial: ["accounts", "bank_connections", "transactions", "subscriptions", "invoices", "invoice_items", "invoice_settings", "project_costs", "spend_categories", "subscription_allocations", "transaction_rules", "transaction_category_rules"],
  professional: ["organizations", "client_opportunities", "freelance_platforms", "opportunity_events", "projects", "project_costs", "competitors", "crons", "todos", "plans", "important_dates", "career_companies", "saved_job_positions", "job_applications", "job_user_state", "job_application_events", "cover_letter_templates", "weekly_reviews", "inbox_items", "notifications", "notification_log"],
  knowledge: ["notes", "prompts", "prompt_links", "ai_links", "ai_categories", "project_links", "tools", "shortcuts", "reference_rows", "repo_notes", "repo_links"],
  projects: ["projects", "project_costs", "project_links", "competitors", "crons", "todos", "notes", "prompts", "important_dates", "subscriptions", "subscription_allocations", "transactions", "invoices"],
  notes: ["notes"],
  prompts: ["prompts", "prompt_links"],
  career: ["career_companies", "saved_job_positions", "job_applications", "job_user_state", "job_application_events", "cover_letter_templates"],
};

