import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard-shell";
import * as f from "./fixtures";

/**
 * Dev/E2E-only harness: renders the real DashboardShell with deterministic
 * fixtures so the auth-gated UI can be exercised by Playwright without a live
 * Supabase session. Returns 404 in production so it never ships.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <DashboardShell
      user={f.user}
      initialTab="overview"
      initialSubscriptions={f.subscriptions}
      initialTodos={f.todos}
      initialStreaks={f.streaks}
      initialStreakLogs={f.streakLogs}
      initialAccounts={f.accounts}
      initialTransactions={f.transactions}
      initialPlans={f.plans}
      initialBooks={f.books}
      initialBookPages={f.bookPages}
      initialNotes={f.notes}
      initialPrompts={f.prompts}
      initialRepoNotes={f.repoNotes}
      initialRepoLinks={f.repoLinks}
      initialAiLinks={f.aiLinks}
      initialAiCategories={f.aiCategories}
      initialShortcuts={f.shortcuts}
      initialReferenceRows={f.referenceRows}
      initialImportantDates={f.importantDates}
      initialInvoices={f.invoices}
      initialInvoiceItems={f.invoiceItems}
      initialInvoiceSettings={f.invoiceSettings}
      todayCalendar={f.todayCalendar}
      weekCalendar={f.weekCalendar}
      coupleCtx={f.coupleCtx}
      partnerData={f.partnerData}
      selectedCalendarIds={f.selectedCalendarIds}
      repoVisibleIds={f.repoVisibleIds}
    />
  );
}
