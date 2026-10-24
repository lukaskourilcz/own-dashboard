import { DashboardShell } from "@/components/dashboard-shell";
import { DASHBOARD_DATA_KEYS } from "@/lib/dashboard-data";
import type { Lang } from "@/lib/i18n";
import type { NavTab } from "@/lib/nav-tabs";
import * as f from "@/lib/demo/fixtures";
import { resolveProjectRef } from "@/lib/projects";

/**
 * The real `DashboardShell` wired to the deterministic demo fixtures.
 *
 * Two routes render it:
 * `/dev-preview` (development and E2E only) and `/guest` (the public tour).
 * Keeping the prop wiring here means a new `DashboardShell` prop is added once
 * rather than drifting between the two callers.
 *
 * `isPreview` turns off preference and repository syncing. The public tour
 * additionally isolates its cache and blocks live requests in GuestBoundary,
 * including when the owner already has a session. Dev-preview remains the
 * deterministic interaction harness for mocked mutation tests.
 */
export function DemoDashboard({
  projectRef,
  initialProjectTab,
  initialTab,
  language = "cs",
  liveMarketingCalendars = false,
  liveRepositories = false,
  liveProjectRecords = false,
  liveMusic = false,
  livePlanning = false,
  liveMonitoring = false,
  livePreferences = false,
  liveCalendar = false,
  initialTipQuery = null,
}: {
  /** Opens a project workspace directly, by fixture id or slug. */
  projectRef?: string;
  initialProjectTab?: string;
  /** Opens a destination directly, as its URL would. */
  initialTab?: NavTab;
  language?: Lang;
  /**
   * Read the marketing calendars through /api/marketing/calendars instead of
   * the fixture. Only the preview harness sets it, so Playwright can stand in
   * for that endpoint; the public tour always shows the fixture.
   */
  liveMarketingCalendars?: boolean;
  /** Dev/E2E-only mocked repository interactions; disabled in the public tour. */
  liveRepositories?: boolean;
  /** Dev/E2E-only mocked project collection/write boundaries. */
  liveProjectRecords?: boolean;
  /** Isolated fake-backend Music tests only; the public tour remains read-only. */
  liveMusic?: boolean;
  /** Isolated fake-backend weekly planning checks only. */
  livePlanning?: boolean;
  /** Dev/E2E-only mocked history reads; disabled in the public tour. */
  liveMonitoring?: boolean;
  /** Dev/E2E-only mocked preference reads/writes; disabled in the public tour. */
  livePreferences?: boolean;
  /** Dev/E2E-only mocked Google Calendar reads; disabled in the public tour. */
  liveCalendar?: boolean;
  /** The IG TIPS deep-link search, as `/ig-tips?q=` passes it. */
  initialTipQuery?: string | null;
}) {
  const project = projectRef ? resolveProjectRef(f.projects, projectRef) : undefined;
  // The isolated live-repository harness reads its mocked owned records,
  // rather than marking the tour's empty note/link fixtures as confirmed.
  const initialDataKeys = DASHBOARD_DATA_KEYS.filter(key => (!liveRepositories || (key !== "repoNotes" && key !== "repoLinks"))
    && (!liveProjectRecords || !["projects", "projectCosts", "crons", "todos"].includes(key))
    && (!livePlanning || key !== "weeklyReviews"));

  return (
    <DashboardShell
      isPreview
      previewRepositoryIntegration={liveRepositories}
      previewProjectIntegration={liveProjectRecords}
      previewMusicIntegration={liveMusic}
      previewPlanningIntegration={livePlanning}
      previewMonitoringIntegration={liveMonitoring}
      previewPreferencesIntegration={livePreferences}
      previewCalendarIntegration={liveCalendar}
      user={livePlanning ? { ...f.user, id: "11111111-1111-4111-8111-111111111111" } : f.user}
      initialTab={project ? "projects" : initialTab ?? "home"}
      initialProjectId={project?.id}
      initialProjectTab={initialProjectTab}
      initialTipQuery={initialTipQuery}
      initialDataKeys={initialDataKeys}
      initialSubscriptions={f.subscriptions}
      initialTodos={f.todos}
      initialAccounts={f.accounts}
      initialTransactions={f.transactions}
      initialPlans={f.plans}
      initialNotes={f.notes}
      initialPrompts={f.prompts}
      initialPromptLinks={f.promptLinks}
      initialRepoNotes={f.repoNotes}
      initialRepoLinks={f.repoLinks}
      initialAiLinks={f.aiLinks}
      initialAiCategories={f.aiCategories}
      initialProjectLinks={f.projectLinks}
      initialTools={f.tools}
      initialShortcuts={f.shortcuts}
      initialReferenceRows={f.referenceRows}
      initialImportantDates={f.importantDates}
      initialInvoices={f.invoices}
      initialInvoiceItems={f.invoiceItems}
      initialInvoiceSettings={f.invoiceSettings}
      initialProjects={f.projects}
      initialNavigationProjects={f.projects}
      initialProjectCommunications={f.projectCommunications}
      initialProjectCosts={f.projectCosts}
      initialCrons={f.crons}
      initialSubscriptionAllocations={f.subscriptionAllocations}
      initialCompetitors={f.competitors}
      initialOrganizations={f.organizations}
      initialOpportunities={f.opportunities}
      initialInboxItems={f.inboxItems}
      initialNotifications={f.notifications}
      initialWeeklyReviews={livePlanning ? [] : f.weeklyReviews}
      initialJobListings={f.jobListings}
      initialJobUserStates={f.jobUserStates}
      initialSavedJobPositions={f.savedJobPositions}
      initialJobApplications={f.jobApplications}
      initialJobApplicationEvents={f.jobApplicationEvents}
      initialCoverLetterTemplates={f.coverLetterTemplates}
      initialJobLastRun={f.jobLastRun}
      todayCalendar={f.todayCalendar}
      weekCalendar={f.weekCalendar}
      lastWeekCalendar={f.lastWeekCalendar}
      selectedCalendarIds={f.selectedCalendarIds}
      repoVisibleIds={f.repoVisibleIds}
      previewDetectedTools={f.detectedTools}
      previewMarketingCalendars={liveMarketingCalendars ? undefined : f.marketingCalendars}
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
        show_czech_career: false,
        hidden_project_tabs: [],
        sync_available: true,
      }}
    />
  );
}
