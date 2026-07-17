"use client";

import { createClient } from "@/lib/supabase/client";
import type {
  Account,
  AiCategory,
  AiLink,
  BankConnection,
  Book,
  BookPage,
  CoverLetterTemplate,
  ImportantDate,
  Invoice,
  InvoiceItem,
  InvoiceSettings,
  JobApplication,
  JobApplicationEvent,
  JobListing,
  JobScrapeRun,
  JobUserState,
  Note,
  Plan,
  Prompt,
  ReferenceRow,
  RepoLink,
  RepoNote,
  Shortcut,
  Streak,
  StreakLog,
  Subscription,
  Todo,
  Transaction,
} from "@/lib/types";

/**
 * Client-side Supabase fetchers used as React Query `queryFn`s, so an
 * `invalidateQueries` after a mutation refetches the canonical rows. Each
 * mirrors the matching server load in `dashboard/page.tsx`. RLS already scopes
 * results to the current user (and shared rows for books/important_dates), so
 * the explicit user filter is omitted — matching the server's effective set.
 */

export async function fetchTodos(): Promise<Todo[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Todo[];
}

export async function fetchSubscriptions(): Promise<Subscription[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Subscription[];
}

export async function fetchStreaks(): Promise<Streak[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("streaks")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Streak[];
}

export async function fetchStreakLogs(): Promise<StreakLog[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("streak_logs").select("*");
  if (error) throw error;
  return (data ?? []) as StreakLog[];
}

export async function fetchAccounts(): Promise<Account[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Account[];
}

export async function fetchTransactions(): Promise<Transaction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .order("occurred_on", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as Transaction[];
}

export async function fetchBankConnections(): Promise<BankConnection[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("bank_connections")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BankConnection[];
}

export async function fetchPlans(): Promise<Plan[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Plan[];
}

export async function fetchBooks(): Promise<Book[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Book[];
}

export async function fetchBookPages(): Promise<BookPage[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("book_pages")
    .select("*")
    .order("log_date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as BookPage[];
}

export async function fetchImportantDates(): Promise<ImportantDate[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("important_dates")
    .select("*")
    .order("the_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ImportantDate[];
}

export async function fetchNotes(): Promise<Note[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Note[];
}

export async function fetchInvoices(): Promise<Invoice[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .order("issue_date", { ascending: false })
    .order("number", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Invoice[];
}

export async function fetchInvoiceItems(): Promise<InvoiceItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("invoice_items")
    .select("*")
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as InvoiceItem[];
}

export async function fetchInvoiceSettings(): Promise<InvoiceSettings | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("invoice_settings")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as InvoiceSettings | null;
}

export async function fetchPrompts(): Promise<Prompt[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("prompts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Prompt[];
}

export async function fetchRepoNotes(): Promise<RepoNote[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("repo_notes")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RepoNote[];
}

export async function fetchRepoLinks(): Promise<RepoLink[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("repo_links").select("*");
  if (error) throw error;
  return (data ?? []) as RepoLink[];
}

export async function fetchAiLinks(): Promise<AiLink[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ai_links")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AiLink[];
}

export async function fetchAiCategories(): Promise<AiCategory[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ai_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AiCategory[];
}

export async function fetchShortcuts(): Promise<Shortcut[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shortcuts")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Shortcut[];
}

export async function fetchReferenceRows(): Promise<ReferenceRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("reference_rows")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ReferenceRow[];
}

// Listings are global rows (RLS: any signed-in user reads; only the scraper
// writes), so there's no user filter — mirrors the server load.
export async function fetchJobListings(): Promise<JobListing[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("job_listings")
    .select("*")
    .order("first_seen_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as JobListing[];
}

export async function fetchJobUserStates(): Promise<JobUserState[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("job_user_state").select("*");
  if (error) throw error;
  return (data ?? []) as JobUserState[];
}

export async function fetchJobApplications(): Promise<JobApplication[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("job_applications")
    .select("*")
    .order("applied_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as JobApplication[];
}

export async function fetchJobApplicationEvents(): Promise<
  JobApplicationEvent[]
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("job_application_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as JobApplicationEvent[];
}

export async function fetchCoverLetterTemplates(): Promise<
  CoverLetterTemplate[]
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("cover_letter_templates")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CoverLetterTemplate[];
}

export async function fetchJobLastRun(): Promise<JobScrapeRun | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("job_scrape_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as JobScrapeRun | null;
}
