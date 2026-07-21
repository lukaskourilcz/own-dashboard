export type Updater<T> = (next: T | ((prev: T) => T)) => void;

export type Subscription = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  currency: string;
  billing_cycle: "monthly" | "yearly" | "weekly";
  category: string | null;
  next_billing_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Where a task came from. "github" = generated from a repo's NEEDED.md (carries
// the repo_* + needed_raw context below); null/"manual" = added by hand.
export type TodoSource = "github" | "manual";

export type Todo = {
  id: string;
  user_id: string;
  title: string;
  done: boolean;
  due_date: string | null;
  // Optional grouping label (e.g. a repo name for tasks imported from its
  // NEEDED.md). Null = ungrouped, shown under the default "Other" section.
  category: string | null;
  created_at: string;
  // NEEDED.md task-card context. All null for a hand-added task.
  source: TodoSource | null;
  // GitHub numeric repo id (as text) — groups tasks into per-repo cards.
  repo_id: string | null;
  repo_full_name: string | null;
  repo_owner: string | null;
  repo_name: string | null;
  repo_url: string | null;
  // The exact NEEDED.md source line — lets Refresh detect the item is still
  // present and lets "delete finished" remove precisely from the file.
  needed_raw: string | null;
  // When the task was generated. due_date is set to generated_at + 7 days so
  // the dashboard can show a time-to-finish countdown.
  generated_at: string | null;
  // Importance 1–5 (5 = highest), parsed from a NEEDED.md `[imp:N]` marker or
  // chosen by hand on a manual task. Null = unscored (drives the Tasks filter).
  importance: number | null;
};

export type Streak = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  reminder_time: string | null;
  created_at: string;
};

export type StreakLog = {
  id: string;
  streak_id: string;
  user_id: string;
  log_date: string;
  created_at: string;
};

export type Account = {
  id: string;
  user_id: string;
  name: string;
  balance: number;
  currency: string;
  // Provider account id (GoCardless) when this account is bank-synced; null for
  // hand-made accounts. Lets a sync update the same row instead of duplicating.
  external_ref: string | null;
  created_at: string;
  updated_at: string;
};

export type Transaction = {
  id: string;
  user_id: string;
  account_id: string | null;
  kind: "income" | "expense";
  amount: number;
  currency: string;
  category: string | null;
  note: string | null;
  occurred_on: string;
  // Stable dedupe key: the bank's transactionId, or a "csv:<hash>" fingerprint
  // for imported statement rows. Null for hand-added transactions.
  external_id: string | null;
  created_at: string;
};

// A keyword → category rule. When a transaction's note contains `match`
// (case-insensitively), it's auto-filed under `category` on import/sync.
export type CategoryRule = {
  id: string;
  user_id: string;
  match: string;
  category: string;
  created_at: string;
};

// A linked bank (a GoCardless "requisition"). Owned rows are readable by the
// user; the /api/bank routes write them via the service role.
export type BankConnection = {
  id: string;
  user_id: string;
  provider: string;
  requisition_id: string;
  institution_id: string;
  institution_name: string | null;
  reference: string;
  status: "created" | "linked" | "expired" | "error";
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanStatus = "idea" | "active" | "done" | "dropped";

// A plan can repeat on a fixed cadence. "none" is a one-off plan (the original
// behaviour). Recurring plans drive the dashboard tracker: each period they
// become "to do" again until marked done for that period.
export type PlanRecurrence = "none" | "weekly" | "biweekly" | "monthly";

export type Plan = {
  id: string;
  user_id: string;
  title: string;
  target_date: string | null;
  status: PlanStatus;
  recurrence: PlanRecurrence;
  // When the plan was last marked done. For recurring plans this is compared
  // against the current period window to decide whether it's still pending.
  last_completed_at: string | null;
  notes: string | null;
  linked_calendar_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  updated_at: string;
};

export type Couple = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
};

export type InviteStatus = "pending" | "accepted" | "declined";

export type CoupleInvite = {
  id: string;
  inviter_id: string;
  invitee_email: string;
  status: InviteStatus;
  created_at: string;
};

export type SharingCategory =
  | "subscriptions"
  | "todos"
  | "streaks"
  | "finances"
  | "plans"
  | "books";

export type SharingPrefs = {
  user_id: string;
  share_subscriptions: boolean;
  share_todos: boolean;
  share_streaks: boolean;
  share_finances: boolean;
  share_plans: boolean;
  share_books: boolean;
  updated_at: string;
};

export type BookStatus = "active" | "done" | "paused";

export type Book = {
  id: string;
  couple_id: string | null;
  user_id: string;
  title: string;
  target_pages: number | null;
  status: BookStatus;
  started_on: string | null;
  created_at: string;
};

export type BookPage = {
  id: string;
  book_id: string;
  user_id: string;
  log_date: string;
  pages: number;
  note: string | null;
  created_at: string;
};

export type Note = {
  id: string;
  user_id: string;
  title: string;
  // BlockNote document — array of Block objects with nested children.
  // Stored opaquely; only the editor reads its shape.
  content: unknown;
  // Flattened plain text — derived from `content` on every save. Used for
  // client-side full-text search and indexed via tsvector server-side.
  plain_text: string;
  tags: string[];
  is_pinned: boolean;
  // Drag-to-reorder anchor. Higher = earlier in the list within its
  // is_pinned bucket.
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type RecurrenceUnit = "yearly" | "monthly";

export type ImportantDate = {
  id: string;
  user_id: string;
  couple_id: string | null;
  title: string;
  the_date: string;
  is_recurring: boolean;
  recurrence_unit: RecurrenceUnit | null;
  emoji: string | null;
  notes: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Invoices (Faktury) — Czech-format invoicing, inspired by fakturoid.cz.
// ---------------------------------------------------------------------------

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";
export type PaymentMethod = "bank" | "cash" | "card";

/**
 * Per-user supplier (Dodavatel) details + invoicing defaults. One row per
 * user; prefills every new invoice. Snapshotted onto each invoice at creation
 * so a later edit here never rewrites already-issued documents.
 */
export type InvoiceSettings = {
  user_id: string;
  supplier_name: string;
  supplier_address: string | null;
  supplier_city: string | null;
  supplier_zip: string | null;
  supplier_country: string;
  supplier_ico: string | null;
  supplier_dic: string | null;
  is_vat_payer: boolean;
  bank_account: string | null;
  iban: string | null;
  default_due_days: number;
  default_currency: string;
  footer_note: string | null;
  logo: string | null;
  updated_at: string;
};

export type Invoice = {
  id: string;
  user_id: string;
  number: string;
  variable_symbol: string | null;
  constant_symbol: string | null;
  issue_date: string;
  due_date: string;
  taxable_supply_date: string | null;
  payment_method: PaymentMethod;
  currency: string;
  status: InvoiceStatus;
  paid_on: string | null;
  round_total: boolean;
  // Buyer (Odběratel)
  buyer_name: string;
  buyer_address: string | null;
  buyer_city: string | null;
  buyer_zip: string | null;
  buyer_country: string;
  buyer_ico: string | null;
  buyer_dic: string | null;
  // Supplier (Dodavatel) — snapshot, locked at creation
  supplier_name: string;
  supplier_address: string | null;
  supplier_city: string | null;
  supplier_zip: string | null;
  supplier_country: string;
  supplier_ico: string | null;
  supplier_dic: string | null;
  supplier_is_vat_payer: boolean;
  bank_account: string | null;
  iban: string | null;
  note: string | null;
  footer_note: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceItem = {
  id: string;
  invoice_id: string;
  user_id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number; // per unit, without VAT
  vat_rate: number; // percent: 21, 12, 0
  position: number;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Prompts — a personal library of reusable prompt texts, shown as copyable
// cards (name + a short preview). Personal; own-only RLS.
// ---------------------------------------------------------------------------

export type Prompt = {
  id: string;
  user_id: string;
  name: string;
  body: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Repo notes — quick notes attached to a GitHub repo (keyed by its numeric id,
// stored as text). One row per note entry; each is its own editable/deletable
// field, autosaved as you type and ordered by sort_order. A "Save to GitHub"
// action joins a repo's entries with `---` dividers and writes them to a
// markdown file in the repo. Own-only RLS.
// ---------------------------------------------------------------------------

export type RepoNote = {
  id: string;
  user_id: string;
  repo_id: string;
  repo_full_name: string;
  body: string;
  // Ordering anchor within a repo. Lower = earlier; new notes append to the end.
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Repo links — an optional custom URL pinned to a repo's card (e.g. the
// deployed site). One row per repo per user; displayed with the scheme and
// leading "www." stripped. Own-only RLS.
// ---------------------------------------------------------------------------

export type RepoLink = {
  id: string;
  user_id: string;
  repo_id: string;
  repo_full_name: string;
  url: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Projects — an active side-project (usually one per GitHub repo) with its
// recurring monthly running costs, free-form notes, and (for pipeline
// projects like aifirst) a set of managed crons. Own-only RLS.
// ---------------------------------------------------------------------------

export type Project = {
  id: string;
  user_id: string;
  name: string;
  // Stable handle used by the cron registry API (e.g. "aifirst").
  slug: string;
  repo_full_name: string | null;
  url: string | null;
  notes: string;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// One monthly cost line for a project (Supabase, Vercel, AI API calls, …).
// `amount` is the monthly figure in `currency`; yearly is derived (× 12).
export type ProjectCost = {
  id: string;
  user_id: string;
  project_id: string;
  label: string;
  amount: number;
  currency: string;
  note: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// A dashboard-managed cron. AI-API-call crons carry cost info: the estimated
// monthly spend is cost_per_run × runs_per_month.
export type Cron = {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  schedule: string;
  description: string;
  endpoint: string;
  is_ai_call: boolean;
  cost_per_run: number;
  currency: string;
  runs_per_month: number;
  enabled: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// AI links — a catalogue of AI sites/tools the user discovered, shown as a
// table of link + description, grouped under user-defined categories
// (DESIGN, SECURITY, IDEAS, …). Personal; own-only RLS.
// ---------------------------------------------------------------------------

export type AiCategory = {
  id: string;
  user_id: string;
  name: string;
  // Ordering anchor for the category sections. Lower = earlier.
  sort_order: number;
  created_at: string;
};

// A user-managed spend category, shared by the Subscriptions and Finances
// sections. The category value stored on each row stays a plain string; this is
// just the pick-list that powers the selector.
export type SpendCategory = {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

// Cost tier of an AI link, rendered as a colored badge: free = green,
// freemium (free tier + paid) = yellow, paid = red. Null = no badge.
export type AiPricing = "free" | "freemium" | "paid";

export type AiLink = {
  id: string;
  user_id: string;
  // Null = "Uncategorized". On category delete the FK nulls out, so a link is
  // never lost — it just falls back to the Uncategorized group.
  category_id: string | null;
  title: string;
  url: string;
  description: string | null;
  pricing: AiPricing | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Jobs — daily-scraped remote-friendly European job listings (global rows,
// written by the cron with the service role) plus the user's application
// tracker: applications with cover letters, an append-only event history,
// reusable cover-letter templates, and per-listing triage state.
// ---------------------------------------------------------------------------

export type JobRole = "frontend" | "fullstack" | "software";

export type JobListing = {
  id: string;
  source: string;
  external_id: string;
  title: string;
  company: string | null;
  url: string;
  location: string | null;
  role: JobRole;
  remote: boolean;
  salary: string | null;
  tags: string[];
  seniority: string | null;
  // Plain-text description snippet (HTML stripped, capped) when the source
  // exposes one; null on boards that don't. Feeds tech-stack fit matching.
  description: string | null;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

export type JobUserStateValue = "shortlisted" | "hidden";

export type JobUserState = {
  id: string;
  user_id: string;
  listing_id: string;
  state: JobUserStateValue;
  created_at: string;
};

export type JobApplicationStatus =
  | "applied"
  | "interviewing"
  | "offer"
  | "rejected"
  | "withdrawn";

export type JobApplication = {
  id: string;
  user_id: string;
  // Soft link to the scraped listing; null once the listing is pruned. The
  // fields below are snapshots taken at apply time, so history survives.
  listing_id: string | null;
  title: string;
  company: string | null;
  url: string | null;
  source: string | null;
  location: string | null;
  cover_letter: string;
  status: JobApplicationStatus;
  applied_on: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type JobApplicationEventKind = "applied" | "status" | "note";

export type JobApplicationEvent = {
  id: string;
  user_id: string;
  application_id: string;
  kind: JobApplicationEventKind;
  detail: string | null;
  created_at: string;
};

export type CoverLetterTemplate = {
  id: string;
  user_id: string;
  name: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type JobScrapeRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  inserted: number;
  refreshed: number;
  pruned: number;
  sources: Record<string, { count: number; error?: string }>;
};

// ---------------------------------------------------------------------------
// Shortcuts — commands/snippets kept one click away, shown in a grid. Each
// cell copies its command on click; the description is shown as its tooltip.
// Own-only RLS.
// ---------------------------------------------------------------------------

export type Shortcut = {
  id: string;
  user_id: string;
  command: string;
  description: string | null;
  // Ordering anchor in the grid. Lower = earlier.
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Reference rows — editable cheatsheet tables in the Shortcuts section. `kind`
// groups rows into a table; c1/c2/c3 are that table's (1–3) columns. Own RLS.
// ---------------------------------------------------------------------------

export type ReferenceKind = "git" | "subst" | "translated";

export type ReferenceRow = {
  id: string;
  user_id: string;
  kind: ReferenceKind;
  c1: string;
  c2: string;
  c3: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};
