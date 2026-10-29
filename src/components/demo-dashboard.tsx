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
  liveMarketingImport = false,
  liveMarketingState = false,
  liveRepositories = false,
  liveProjectRecords = false,
  liveMusic = false,
  liveAccounts = false,
  livePlanning = false,
  livePlanRecords = false,
  liveTasks = false,
  liveCategories = false,
  liveMonitoring = false,
  liveCareer = false,
  liveCareerRecords = false,
  livePreferences = false,
  liveExports = false,
  liveSession = false,
  liveCalendar = false,
  liveOrganizations = false,
  liveCompetitors = false,
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
  /** Isolated fake-backend calendar-import checks; never enabled in the public tour. */
  liveMarketingImport?: boolean;
  /** Isolated fake-backend state reads; publishing and other writes stay disabled. */
  liveMarketingState?: boolean;
  /** Dev/E2E-only mocked repository interactions; disabled in the public tour. */
  liveRepositories?: boolean;
  /** Dev/E2E-only mocked project collection/write boundaries. */
  liveProjectRecords?: boolean;
  /** Isolated fake-backend Music tests only; the public tour remains read-only. */
  liveMusic?: boolean;
  /** Isolated fake-backend account control checks only. */
  liveAccounts?: boolean;
  /** Isolated fake-backend weekly planning checks only. */
  livePlanning?: boolean;
  /** Isolated fake-backend Goals/Home plan checks only. */
  livePlanRecords?: boolean;
  /** Isolated fake-backend Tasks write/read checks only. */
  liveTasks?: boolean;
  /** Isolated fake-backend category mutation checks only. */
  liveCategories?: boolean;
  /** Dev/E2E-only mocked history reads; disabled in the public tour. */
  liveMonitoring?: boolean;
  /** Isolated fake-backend Career refresh contract only. */
  liveCareer?: boolean;
  /** Isolated fake-backend complete Career reads and activation. */
  liveCareerRecords?: boolean;
  /** Dev/E2E-only mocked preference reads/writes; disabled in the public tour. */
  livePreferences?: boolean;
  /** Isolated fake-backend downloads only; no preference/provider calls. */
  liveExports?: boolean;
  /** Actual SDK session-change checks on the isolated fake backend only. */
  liveSession?: boolean;
  /** Dev/E2E-only mocked Google Calendar reads; disabled in the public tour. */
  liveCalendar?: boolean;
  /** Isolated fake-backend organization record checks only. */
  liveOrganizations?: boolean;
  /** Isolated fake-backend Competition read checks only. */
  liveCompetitors?: boolean;
  /** The IG TIPS deep-link search, as `/ig-tips?q=` passes it. */
  initialTipQuery?: string | null;
}) {
  const project = projectRef ? resolveProjectRef(f.projects, projectRef) : undefined;
  // The isolated live-repository harness reads its mocked owned records,
  // rather than marking the tour's empty note/link fixtures as confirmed.
  const initialDataKeys = DASHBOARD_DATA_KEYS.filter(key => (!liveRepositories || (key !== "repoNotes" && key !== "repoLinks"))
    && (!liveProjectRecords || !["projects", "projectCosts", "crons", "todos"].includes(key))
    && (!livePlanning || key !== "weeklyReviews")
    && (!livePlanRecords || key !== "plans")
    && (!liveTasks || key !== "todos")
    && (!liveOrganizations || key !== "organizations")
    && (!liveCompetitors || key !== "competitors")
    && (!liveCareerRecords || !["jobListings", "jobUserStates", "savedJobPositions", "jobApplications", "jobApplicationEvents", "coverLetterTemplates", "jobLastRun"].includes(key)));

  return (
    <DashboardShell
      isPreview
      previewRepositoryIntegration={liveRepositories}
      previewProjectIntegration={liveProjectRecords}
      previewMarketingImportIntegration={liveMarketingImport}
      previewMarketingStateIntegration={liveMarketingState}
      previewMusicIntegration={liveMusic}
      previewAccountIntegration={liveAccounts}
      previewPlanIntegration={livePlanRecords}
      previewPlanningIntegration={livePlanning}
      previewTaskIntegration={liveTasks}
      previewMonitoringIntegration={liveMonitoring}
      previewCareerIntegration={liveCareer}
      previewCareerRecordsIntegration={liveCareerRecords}
      previewPreferencesIntegration={livePreferences}
      previewExportIntegration={liveExports}
      previewSessionIntegration={liveSession}
      previewCalendarIntegration={liveCalendar}
      previewOrganizationIntegration={liveOrganizations}
      previewCompetitorIntegration={liveCompetitors}
      user={liveMarketingState || liveMarketingImport || liveAccounts || liveMusic || livePlanRecords || livePlanning || liveTasks || liveCategories || liveOrganizations || liveCompetitors || liveExports || liveSession || liveCareer ? { ...f.user, id: "11111111-1111-4111-8111-111111111111" } : f.user}
      initialTab={project ? "projects" : initialTab ?? "home"}
      initialProjectId={project?.id}
      initialProjectTab={initialProjectTab}
      initialTipQuery={initialTipQuery}
      initialDataKeys={initialDataKeys}
      initialSubscriptions={f.subscriptions}
      initialTodos={liveTasks ? [] : f.todos}
      initialAccounts={f.accounts}
      initialTransactions={f.transactions}
      initialPlans={livePlanRecords ? [] : f.plans}
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
      initialCompetitors={liveCompetitors ? [] : f.competitors}
      initialOrganizations={liveOrganizations ? [] : f.organizations}
      initialOpportunities={f.opportunities}
      initialInboxItems={f.inboxItems}
      initialNotifications={f.notifications}
      initialWeeklyReviews={livePlanning ? [] : f.weeklyReviews}
      initialJobListings={liveCareer ? [] : f.jobListings}
      initialJobUserStates={liveCareerRecords ? [] : f.jobUserStates}
      initialSavedJobPositions={liveCareerRecords ? [] : f.savedJobPositions}
      initialJobApplications={liveCareerRecords ? [] : f.jobApplications}
      initialJobApplicationEvents={liveCareerRecords ? [] : f.jobApplicationEvents}
      initialCoverLetterTemplates={liveCareerRecords ? [] : f.coverLetterTemplates}
      initialJobLastRun={liveCareerRecords ? null : f.jobLastRun}
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
