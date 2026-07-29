import { DashboardShell } from "@/components/dashboard-shell";
import { DASHBOARD_DATA_KEYS } from "@/lib/dashboard-data";
import type { Lang } from "@/lib/i18n";
import * as f from "@/lib/demo/fixtures";

/**
 * The real `DashboardShell` wired to the deterministic demo fixtures.
 *
 * Two routes render it and neither has a Supabase session:
 * `/dev-preview` (development and E2E only) and `/guest` (the public tour).
 * Keeping the prop wiring here means a new `DashboardShell` prop is added once
 * rather than drifting between the two callers.
 *
 * `isPreview` turns off preference and repository syncing, so nothing here
 * attempts a write. Anonymous writes would fail against own-only RLS anyway;
 * this keeps the UI from trying in the first place.
 */
export function DemoDashboard({
  projectRef,
  language = "cs",
}: {
  /** Opens a project workspace directly, by fixture id or slug. */
  projectRef?: string;
  language?: Lang;
}) {
  const project = projectRef
    ? f.projects.find((item) => item.id === projectRef || item.slug === projectRef)
    : undefined;

  return (
    <DashboardShell
      isPreview
      user={f.user}
      initialTab={project ? "projects" : "home"}
      initialProjectId={project?.id}
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
      initialNavigationProjects={f.projects}
      initialProjectCommunications={f.projectCommunications}
      initialAgentTasks={f.agentTasks}
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
      initialPreferences={{
        language,
        theme: "light",
        display_currency: "CZK",
        hidden_navigation: [],
        navigation_order: [],
        navigation_collapsed: false,
        dashboard_layout: [
          "today-hero",
          "todos",
          "kpi",
          "work-attention",
          "subscriptions",
          "calendar",
          "goals",
        ],
        tasks_per_category: 5,
        cv_url_cs: "",
        cv_url_en: "",
        hidden_project_tabs: [],
        sync_available: true,
      }}
    />
  );
}
