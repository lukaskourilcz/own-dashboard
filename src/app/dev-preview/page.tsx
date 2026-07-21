import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard-shell";
import { DASHBOARD_DATA_KEYS } from "@/lib/dashboard-data";
import * as f from "./fixtures";

/**
 * Dev/E2E-only harness: renders the real DashboardShell with deterministic
 * fixtures so the auth-gated UI can be exercised by Playwright without a live
 * Supabase session. Returns 404 in production so it never ships.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { project } = await searchParams;
  const previewProject = project ? f.projects.find((item) => item.id === project || item.slug === project) : undefined;

  return (
    <DashboardShell
      isPreview
      user={f.user}
      initialTab={previewProject ? "projects" : "home"}
      initialProjectId={previewProject?.id}
      initialDataKeys={[...DASHBOARD_DATA_KEYS]}
      initialSubscriptions={f.subscriptions}
      initialTodos={f.todos}
      initialAccounts={f.accounts}
      initialTransactions={f.transactions}
      initialPlans={f.plans}
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
      initialProjects={f.projects}
      initialProjectCosts={f.projectCosts}
      initialCrons={f.crons}
      initialOrganizations={f.organizations}
      initialOpportunities={f.opportunities}
      initialInboxItems={f.inboxItems}
      initialNotifications={f.notifications}
      initialWeeklyReviews={f.weeklyReviews}
      initialJobListings={f.jobListings}
      initialJobUserStates={f.jobUserStates}
      initialJobApplications={f.jobApplications}
      initialJobApplicationEvents={f.jobApplicationEvents}
      initialCoverLetterTemplates={f.coverLetterTemplates}
      initialJobLastRun={f.jobLastRun}
      todayCalendar={f.todayCalendar}
      weekCalendar={f.weekCalendar}
      selectedCalendarIds={f.selectedCalendarIds}
      repoVisibleIds={f.repoVisibleIds}
    />
  );
}
