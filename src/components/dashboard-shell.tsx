"use client";

import dynamic from "next/dynamic";
import { OwnerQueryProvider } from "@/components/owner-query-provider";
import { OwnerSessionBoundary } from "@/components/owner-session-boundary";
import type { CareerScope } from '@/lib/career-records';
import { OwnerPreferencesProvider, useOwnerPreferences } from "@/lib/owner-preferences";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NavigationGuardProvider, pushDashboardHistory, useGuardedNavigation } from "@/components/navigation-guard";
import { DashboardDestinationBoundary } from "@/components/dashboard-destination-state";
import { MotionConfig } from "motion/react";
import { CustomizableOverview } from "@/components/overview/customizable-overview";
import { KpiCards } from "@/components/overview/kpi-cards";
import { RecurringPlans } from "@/components/overview/recurring-plans";
import { DailyFocusPanel } from "@/components/overview/daily-focus";
import { CronMonitorPanel } from "@/components/overview/cron-monitor";
import { TodayHero } from "@/components/overview/today-hero";
import { WorkAttention } from "@/components/overview/work-attention";
import { WeekView } from "@/components/calendar/week-view";
import { CommandPalette } from "@/components/command-palette";
import { MobileFab } from "@/components/mobile-fab";
import {
  PreferenceHydrator,
  type SyncedUiPreferences,
} from "@/components/preference-hydrator";
import { MobileNav, Sidebar, type NavTab } from "@/components/nav/sidebar";
import { ShellTitleProvider } from "@/components/ui/page-header";
import { AppToolbar } from "@/components/nav/app-toolbar";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmationProvider } from "@/components/ui/confirmation-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EventsResult } from "@/lib/calendar";
import type { DetectedToolsResponse } from "@/lib/stack-detection";
import type { MarketingCalendarsResponse } from "@/lib/marketing-calendars";
import { onDemandDataKeys, tabNeedsDashboardData, type DashboardDataKey } from "@/lib/dashboard-data";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { WidgetId } from "@/lib/dashboard-layout";
import { isHiddenNavTab, tabFromPath, tabToPath } from "@/lib/nav-tabs";
import { useEntityStore } from "@/lib/queries/entities";
import { buildProjectTaskIndex } from "@/lib/project-match";
import { resolveProjectRef } from "@/lib/projects";
import {
  fetchAccounts,
  fetchAiCategories,
  fetchAiLinks,
  fetchCompetitors,
  fetchCoverLetterTemplates,
  fetchSubscriptionAllocations,
  fetchLastWeekCalendar,
  fetchTodayCalendar,
  fetchWeekCalendar,
  fetchCrons,
  fetchImportantDates,
  fetchInboxItems,
  fetchInvoiceItems,
  fetchInvoiceSettings,
  fetchInvoices,
  fetchJobApplicationEvents,
  fetchJobApplications,
  fetchJobLastRun,
  fetchJobListings,
  fetchJobUserStates,
  fetchSavedJobPositions,
  fetchNotes,
  fetchNotifications,
  fetchOpportunities,
  fetchOrganizations,
  fetchPlans,
  fetchProjectCosts,
  fetchProjects,
  fetchProjectCommunications,
  fetchProjectLinks,
  fetchPrompts,
  fetchPromptLinks,
  fetchReferenceRows,
  fetchRepoLinks,
  fetchRepoNotes,
  fetchShortcuts,
  fetchSubscriptions,
  fetchTodos,
  fetchTools,
  fetchTransactions,
  fetchWeeklyReviews,
} from "@/lib/queries/fetchers";
import { qk } from "@/lib/queries/keys";
import { useDisplayCurrency, useNavCollapsed } from "@/lib/use-prefs";
import { cn } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import type {
  Account, AiCategory, AiLink, AppNotification, ClientOpportunity, Competitor, CoverLetterTemplate, Cron,
  ImportantDate, InboxItem, Invoice, InvoiceItem, InvoiceSettings,
  JobApplication, JobApplicationEvent, JobListing, JobScrapeRun, JobUserState, SavedJobPosition,
  Note, Organization, Plan, Project, ProjectCommunication, ProjectCost, ProjectLink, Prompt, PromptLink, ReferenceRow, RepoLink, RepoNote,
  Shortcut, Subscription, SubscriptionAllocation, Todo, Tool, Transaction, WeeklyReview,
} from "@/lib/types";

// Keep destination code out of the initial shell; initial panels still render on the server.
const CalendarPanel = dynamic(() => import("@/components/panels/calendar-panel").then(module => module.CalendarPanel), { loading: DestinationLoading });
const ClientsPanel = dynamic(() => import("@/components/panels/clients-panel").then(module => module.ClientsPanel), { loading: DestinationLoading });
const FinancesPanel = dynamic(() => import("@/components/panels/finances-panel").then(module => module.FinancesPanel), { loading: DestinationLoading });
const InboxPanel = dynamic(() => import("@/components/panels/inbox-panel").then(module => module.InboxPanel), { loading: DestinationLoading });
const ImportantDatesPanel = dynamic(() => import("@/components/panels/important-dates-panel").then(module => module.ImportantDatesPanel), { loading: DestinationLoading });
const InvoicesPanel = dynamic(() => import("@/components/panels/invoices-panel").then(module => module.InvoicesPanel), { loading: DestinationLoading });
const JobsPanel = dynamic(() => import("@/components/panels/jobs-panel").then(module => module.JobsPanel), { loading: DestinationLoading });
const NotesPanel = dynamic(() => import("@/components/panels/notes-panel").then(module => module.NotesPanel), { loading: DestinationLoading });
const OpportunitiesPanel = dynamic(() => import("@/components/panels/opportunities-panel").then(module => module.OpportunitiesPanel), { loading: DestinationLoading });
const PlansPanel = dynamic(() => import("@/components/panels/plans-panel").then(module => module.PlansPanel), { loading: DestinationLoading });
const ProjectsPanel = dynamic(() => import("@/components/panels/projects-panel").then(module => module.ProjectsPanel), { loading: DestinationLoading });
const CompetitionPanel = dynamic(() => import("@/components/panels/competition-panel").then(module => module.CompetitionPanel), { loading: DestinationLoading });
const DevFinancePanel = dynamic(() => import("@/components/panels/dev-finance-panel").then(module => module.DevFinancePanel), { loading: DestinationLoading });
const PromptsPanel = dynamic(() => import("@/components/panels/prompts-panel").then(module => module.PromptsPanel), { loading: DestinationLoading });
const SettingsPanel = dynamic(() => import("@/components/panels/settings-panel").then(module => module.SettingsPanel), { loading: DestinationLoading });
const ShortcutsPanel = dynamic(() => import("@/components/panels/shortcuts-panel").then(module => module.ShortcutsPanel), { loading: DestinationLoading });
const SubscriptionsPanel = dynamic(() => import("@/components/panels/subscriptions-panel").then(module => module.SubscriptionsPanel), { loading: DestinationLoading });
const TodosPanel = dynamic(() => import("@/components/panels/todos-panel").then(module => module.TodosPanel), { loading: DestinationLoading });
const ToolsPanel = dynamic(() => import("@/components/panels/tools-panel").then(module => module.ToolsPanel), { loading: DestinationLoading });
const WorkOverviewPanel = dynamic(() => import("@/components/panels/work-overview-panel").then(module => module.WorkOverviewPanel), { loading: DestinationLoading });
const AiPanel = dynamic(() => import("@/components/panels/ai-panel").then(module => module.AiPanel), { loading: DestinationLoading });
const MarketingPanel = dynamic(() => import("@/components/panels/marketing-panel").then(module => module.MarketingPanel), { loading: DestinationLoading });
const WorkflowsPanel = dynamic(() => import("@/components/panels/workflows-panel").then(module => module.WorkflowsPanel), { loading: DestinationLoading });
const IgTipsPanel = dynamic(() => import("@/components/panels/ig-tips-panel").then(module => module.IgTipsPanel), { loading: DestinationLoading });

function DestinationLoading() {
  const t = useDict();
  return <p role="status" className="py-6 text-sm text-foreground-muted">{t.common.loading}</p>;
}

type Props = {
  initialTimezone?: string | null;
  isPreview?: boolean;
  /** Only the isolated dev/E2E harness enables mocked repository endpoints. */
  previewRepositoryIntegration?: boolean;
  previewProjectIntegration?: boolean;
  previewMusicIntegration?: boolean;
  previewAccountIntegration?: boolean;
  previewMarketingImportIntegration?: boolean;
  previewMarketingStateIntegration?: boolean;
  previewCampaignActivationIntegration?: boolean;
  previewPlanningIntegration?: boolean;
  previewPlanIntegration?: boolean;
  previewTaskIntegration?: boolean;
  previewMonitoringIntegration?: boolean;
  previewCareerIntegration?: boolean;
  previewCareerRecordsIntegration?: boolean;
  previewPreferencesIntegration?: boolean;
  previewExportIntegration?: boolean;
  previewSessionIntegration?: boolean;
  previewCalendarIntegration?: boolean;
  /** Isolated fake-backend organization read/write checks only. */
  previewOrganizationIntegration?: boolean;
  /** Isolated fake-backend competition record checks only. */
  previewCompetitorIntegration?: boolean;
  initialProjectId?: string;
  initialProjectTab?: string;
  /** `/ig-tips?q=<title>`: the tip search to open IG TIPS with. */
  initialTipQuery?: string | null;
  user: { id: string; email: string; name: string | null; avatar_url: string | null };
  initialTab: NavTab;
  initialDataKeys: DashboardDataKey[];
  initialSubscriptions: Subscription[];
  initialTodos: Todo[];
  initialAccounts: Account[];
  initialTransactions: Transaction[];
  initialPlans: Plan[];
  initialNotes: Note[];
  initialPrompts: Prompt[];
  initialPromptLinks: PromptLink[];
  initialRepoNotes: RepoNote[];
  initialRepoLinks: RepoLink[];
  initialAiLinks: AiLink[];
  initialAiCategories: AiCategory[];
  initialProjectLinks: ProjectLink[];
  initialTools: Tool[];
  initialShortcuts: Shortcut[];
  initialReferenceRows: ReferenceRow[];
  initialImportantDates: ImportantDate[];
  initialInvoices: Invoice[];
  initialInvoiceItems: InvoiceItem[];
  initialInvoiceSettings: InvoiceSettings | null;
  initialProjects: Project[];
  initialNavigationProjects: Pick<
    Project,
    "id" | "name" | "slug" | "is_active" | "engagement"
  >[];
  initialProjectCommunications: ProjectCommunication[];
  initialProjectCosts: ProjectCost[];
  initialCrons: Cron[];
  initialSubscriptionAllocations: SubscriptionAllocation[];
  initialCompetitors: Competitor[];
  initialOrganizations: Organization[];
  initialOpportunities: ClientOpportunity[];
  initialInboxItems: InboxItem[];
  initialNotifications: AppNotification[];
  initialWeeklyReviews: WeeklyReview[];
  initialJobListings: JobListing[];
  initialJobUserStates: JobUserState[];
  initialSavedJobPositions: SavedJobPosition[];
  initialJobApplications: JobApplication[];
  initialJobApplicationEvents: JobApplicationEvent[];
  initialCoverLetterTemplates: CoverLetterTemplate[];
  initialJobLastRun: JobScrapeRun | null;
  todayCalendar: EventsResult;
  weekCalendar: EventsResult;
  lastWeekCalendar: EventsResult;
  selectedCalendarIds: string[];
  repoVisibleIds: string[];
  initialPreferences: SyncedUiPreferences;
  /** Fixture detection for the preview; the live Tools panel reads GitHub. */
  previewDetectedTools?: DetectedToolsResponse;
  /** Fixture marketing calendars for the preview; the live app reads GitHub. */
  previewMarketingCalendars?: MarketingCalendarsResponse;
};

// `g` then a letter. Inbox and References are hidden from navigation, so
// they have no chord (`g i` and `g r` do nothing).
const TAB_CHORDS: Record<string, NavTab> = {
  h: "home", w: "work", p: "projects", q: "competition", o: "opportunities",
  c: "clients", j: "career", f: "invoices", m: "money", a: "accounts",
  x: "transactions", s: "subscriptions", t: "tasks", l: "calendar",
  g: "goals", d: "dates", n: "notes", k: "tools",
};

const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

export function DashboardShell(props: Props) {
  return (
    <OwnerPreferencesProvider
      ownerId={props.user.id}
      initial={!props.isPreview && props.initialPreferences.sync_available ? {
        cv_url_cs: props.initialPreferences.cv_url_cs,
        cv_url_en: props.initialPreferences.cv_url_en,
        show_czech_career: props.initialPreferences.show_czech_career === true,
      } : undefined}
    >
      <OwnerQueryProvider ownerId={props.user.id}>
        <OwnerSessionBoundary enabled={!props.isPreview || props.previewSessionIntegration === true}>
          <NavigationGuardProvider><DashboardShellContent {...props} /></NavigationGuardProvider>
        </OwnerSessionBoundary>
      </OwnerQueryProvider>
    </OwnerPreferencesProvider>
  );
}

function DashboardShellContent(props: Props) {
  const ownerScope = useOwnerPreferences();
  const competitorKey = useMemo(() => [...qk.competitors, props.user.id], [props.user.id]);
  // A confirmed row write changes React Query's data/error state, but does not
  // confirm the rest of a previously failed collection refresh. Only a complete
  // successful read clears this owner-scoped warning across destination changes.
  const [competitorReadFailedFor, setCompetitorReadFailedFor] = useState<string | null>(null);
  const loadCompetitors = useCallback(async (context?: { signal: AbortSignal }) => {
    if (!ownerScope || ownerScope.ownerId !== props.user.id) throw new Error("Competition unavailable");
    const captured = ownerScope.capture(), signal = context ? AbortSignal.any([captured.signal, context.signal]) : captured.signal;
    try {
      const rows = await fetchCompetitors({ ownerId: captured.ownerId, signal });
      if (!signal.aborted) setCompetitorReadFailedFor(previous => previous === captured.ownerId ? null : previous);
      return rows;
    } catch (error) {
      if (!signal.aborted) setCompetitorReadFailedFor(captured.ownerId);
      throw error;
    }
  }, [ownerScope, props.user.id]);
  const organizationKey = useMemo(() => [...qk.organizations, props.user.id], [props.user.id]);
  const loadOrganizations = useCallback((context?: { signal: AbortSignal }) => {
    if (!ownerScope || ownerScope.ownerId !== props.user.id) throw new Error("Organizations unavailable");
    const captured = ownerScope.capture();
    return fetchOrganizations({ ownerId: captured.ownerId, signal: context ? AbortSignal.any([captured.signal, context.signal]) : captured.signal });
  }, [ownerScope, props.user.id]);
  const loadPlans = useCallback((context?: { signal: AbortSignal }) => {
    if (!ownerScope || ownerScope.ownerId !== props.user.id) throw new Error("Plans unavailable");
    const captured = ownerScope.capture();
    return fetchPlans({ ownerId: captured.ownerId, signal: context ? AbortSignal.any([captured.signal, context.signal]) : captured.signal });
  }, [ownerScope, props.user.id]);
  const careerLoaders = useMemo(() => {
    function bind<T>(fetcher: (scope: CareerScope) => Promise<T>) {
      return (context?: { signal: AbortSignal }) => {
        if (!ownerScope || ownerScope.ownerId !== props.user.id) throw new Error("Career unavailable");
        const captured = ownerScope.capture();
        return fetcher({ ownerId: captured.ownerId, signal: context ? AbortSignal.any([captured.signal, context.signal]) : captured.signal });
      };
    }
    return { jobListings: bind(fetchJobListings), jobUserStates: bind(fetchJobUserStates), savedJobPositions: bind(fetchSavedJobPositions), jobApplications: bind(fetchJobApplications), jobApplicationEvents: bind(fetchJobApplicationEvents), coverLetterTemplates: bind(fetchCoverLetterTemplates), jobLastRun: bind(fetchJobLastRun) };
  }, [ownerScope, props.user.id]);
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const requestNavigation = useGuardedNavigation();
  const { user } = props;
  const t = useDict();
  const [tab, setTabState] = useState<NavTab>(props.initialTab);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    props.initialProjectId ?? null,
  );
  const seededData = useMemo(() => new Set(props.initialDataKeys), [props.initialDataKeys]);
  // Career and Opportunities load their data only after "Check for new
  // offers". The flag lives for this page session; a reload asks again.
  const [activatedTabs, setActivatedTabs] = useState<ReadonlySet<NavTab>>(() => new Set());
  const dataOptions = useCallback((key: DashboardDataKey) => ({
    seeded: seededData.has(key),
    enabled: (!props.isPreview || (props.previewCareerRecordsIntegration && ["jobListings", "jobUserStates", "savedJobPositions", "jobApplications", "jobApplicationEvents", "coverLetterTemplates", "jobLastRun"].includes(key)) || (props.previewOrganizationIntegration && key === "organizations") || (props.previewCompetitorIntegration && key === "competitors") || (props.previewPlanIntegration && key === "plans") || (props.previewPlanningIntegration && key === "weeklyReviews") || (props.previewTaskIntegration && key === "todos") || (props.previewCalendarIntegration && ["todayCalendar", "weekCalendar", "lastWeekCalendar"].includes(key)) || (props.previewRepositoryIntegration && ["repoNotes", "repoLinks"].includes(key)) || (props.previewProjectIntegration && ["projects", "projectCosts", "crons", "todos"].includes(key))) && tabNeedsDashboardData(tab, key, activatedTabs.has(tab)),
    onDemand: onDemandDataKeys(tab).includes(key),
  }), [seededData, tab, activatedTabs, props.isPreview, props.previewCalendarIntegration, props.previewRepositoryIntegration, props.previewProjectIntegration, props.previewPlanningIntegration, props.previewPlanIntegration, props.previewTaskIntegration, props.previewOrganizationIntegration, props.previewCompetitorIntegration, props.previewCareerRecordsIntegration]);
  const setTab = useCallback((next: NavTab) => {
    if (next === tab && selectedProjectId === null) return;
    requestNavigation(() => {
    setTabState(next);
    setSelectedProjectId(null);
    const path = tabToPath(next);
    if (typeof window !== "undefined" && window.location.pathname !== path) pushDashboardHistory(path);
    });
  }, [requestNavigation, tab, selectedProjectId]);
  const { collapsed: navCollapsed } = useNavCollapsed();
  const [subscriptions, setSubscriptions, subscriptionsStatus] = useEntityStore(qk.subscriptions, props.initialSubscriptions, fetchSubscriptions, dataOptions("subscriptions"));
  const [todos, , todosStatus] = useEntityStore(qk.todos, props.initialTodos, fetchTodos, dataOptions("todos"));
  const [accounts, setAccounts, accountsStatus] = useEntityStore(qk.accounts, props.initialAccounts, fetchAccounts, dataOptions("accounts"));
  const [transactions, setTransactions, transactionsStatus] = useEntityStore(qk.transactions, props.initialTransactions, fetchTransactions, dataOptions("transactions"));
  const [plans, setPlans, plansStatus] = useEntityStore(qk.plans, props.initialPlans, loadPlans, dataOptions("plans"));
  const [notes, setNotes, notesStatus] = useEntityStore(qk.notes, props.initialNotes, fetchNotes, dataOptions("notes"));
  const [prompts, setPrompts, promptsStatus] = useEntityStore(qk.prompts, props.initialPrompts, fetchPrompts, dataOptions("prompts"));
  const [promptLinks, setPromptLinks, promptLinksStatus] = useEntityStore(qk.promptLinks, props.initialPromptLinks, fetchPromptLinks, dataOptions("promptLinks"));
  const [repoNotes, setRepoNotes, repoNotesStatus] = useEntityStore(qk.repoNotes, props.initialRepoNotes, fetchRepoNotes, dataOptions("repoNotes"));
  const [repoLinks, setRepoLinks, repoLinksStatus] = useEntityStore(qk.repoLinks, props.initialRepoLinks, fetchRepoLinks, dataOptions("repoLinks"));
  const [aiLinks, setAiLinks, aiLinksStatus] = useEntityStore(qk.aiLinks, props.initialAiLinks, fetchAiLinks, dataOptions("aiLinks"));
  const [aiCategories, setAiCategories, aiCategoriesStatus] = useEntityStore(qk.aiCategories, props.initialAiCategories, fetchAiCategories, dataOptions("aiCategories"));
  const [projectLinks, setProjectLinks, projectLinksStatus] = useEntityStore(qk.projectLinks, props.initialProjectLinks, fetchProjectLinks, dataOptions("projectLinks"));
  const [tools, setTools, toolsStatus] = useEntityStore(qk.tools, props.initialTools, fetchTools, dataOptions("tools"));
  // A Tools card's "Show in Links" opens the library at that link's card.
  const [focusLinkId, setFocusLinkId] = useState<string | null>(null);
  // `/ig-tips?q=` applies once, on the IG TIPS panel the page opened with.
  const [tipQuery, setTipQuery] = useState<string | null>(props.initialTipQuery ?? null);
  const clearTipQuery = useCallback(() => setTipQuery(null), []);
  const [shortcuts, setShortcuts, shortcutsStatus] = useEntityStore(qk.shortcuts, props.initialShortcuts, fetchShortcuts, dataOptions("shortcuts"));
  const [referenceRows, setReferenceRows, referenceRowsStatus] = useEntityStore(qk.referenceRows, props.initialReferenceRows, fetchReferenceRows, dataOptions("referenceRows"));
  const [importantDates, setImportantDates, importantDatesStatus] = useEntityStore(qk.importantDates, props.initialImportantDates, fetchImportantDates, dataOptions("importantDates"));
  const [invoices, setInvoices, invoicesStatus] = useEntityStore(qk.invoices, props.initialInvoices, fetchInvoices, dataOptions("invoices"));
  const [invoiceItems, setInvoiceItems, invoiceItemsStatus] = useEntityStore(qk.invoiceItems, props.initialInvoiceItems, fetchInvoiceItems, dataOptions("invoiceItems"));
  const [invoiceSettings, setInvoiceSettings, invoiceSettingsStatus] = useEntityStore<InvoiceSettings | null>(qk.invoiceSettings, props.initialInvoiceSettings, fetchInvoiceSettings, dataOptions("invoiceSettings"));
  const [projects, setProjects, projectsStatus] = useEntityStore(qk.projects, props.initialProjects, fetchProjects, dataOptions("projects"));
  const activeProjects = useMemo(
    () => projects.filter((project) => project.is_active),
    [projects],
  );
  const openProject = useCallback(
    (project: Pick<Project, "id" | "slug">) => {
      requestNavigation(() => {
      setTabState("projects");
      setSelectedProjectId(project.id);
      const path = `/projects/${encodeURIComponent(project.slug)}`;
      if (window.location.pathname !== path) {
        pushDashboardHistory(path);
      }
      });
    },
    [requestNavigation],
  );
  useEffect(() => {
    const onPop = () => {
      const nextTab = tabFromPath(window.location.pathname);
      setTabState(nextTab);
      const segments = window.location.pathname.split("/").filter(Boolean);
      if (nextTab === "projects" && segments[1]) {
        let key = segments[1];
        try {
          key = decodeURIComponent(key);
        } catch {
          // Keep the raw segment; the canonical server boundary handles
          // malformed/unknown direct routes as 404.
        }
        setSelectedProjectId(resolveProjectRef(projects, key)?.id ?? null);
      } else {
        setSelectedProjectId(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [projects]);
  const activeNavigationProjects = useMemo(
    () =>
      projectsStatus.ready
        ? activeProjects
        : props.initialNavigationProjects.filter((project) => project.is_active),
    [activeProjects, projectsStatus.ready, props.initialNavigationProjects],
  );
  const projectTaskIndex = useMemo(() => buildProjectTaskIndex(projects, todos), [projects, todos]);
  const operationalTodos = useMemo(() => todos.filter(todo => {
    if (todo.is_global) return true;
    if (todo.project_id || todo.repo_full_name || todo.repo_id) return projectTaskIndex.byTodo.get(todo.id)?.is_active === true;
    return true;
  }), [projectTaskIndex, todos]);

  const [projectCommunications, setProjectCommunications, projectCommunicationsStatus] = useEntityStore(qk.projectCommunications, props.initialProjectCommunications, fetchProjectCommunications, dataOptions("projectCommunications"));
  const [projectCosts, setProjectCosts, projectCostsStatus] = useEntityStore(qk.projectCosts, props.initialProjectCosts, fetchProjectCosts, dataOptions("projectCosts"));
  const [crons, setCrons, cronsStatus] = useEntityStore(qk.crons, props.initialCrons, fetchCrons, dataOptions("crons"));
  const [subscriptionAllocations, setSubscriptionAllocations, subscriptionAllocationsStatus] = useEntityStore(qk.subscriptionAllocations, props.initialSubscriptionAllocations, fetchSubscriptionAllocations, dataOptions("subscriptionAllocations"));
  const [competitors, setCompetitors, competitorsStatus] = useEntityStore(competitorKey, props.initialCompetitors, loadCompetitors, { ...dataOptions("competitors"), retry: false });
  const [organizations, setOrganizations, organizationsStatus] = useEntityStore(organizationKey, props.initialOrganizations, loadOrganizations, { ...dataOptions("organizations"), retry: false });
  const [opportunities, setOpportunities, opportunitiesStatus] = useEntityStore(qk.opportunities, props.initialOpportunities, fetchOpportunities, dataOptions("opportunities"));
  const [inboxItems, setInboxItems, inboxItemsStatus] = useEntityStore(qk.inboxItems, props.initialInboxItems, fetchInboxItems, dataOptions("inboxItems"));
  const [notifications, setNotifications, notificationsStatus] = useEntityStore(qk.notifications, props.initialNotifications, fetchNotifications, dataOptions("notifications"));
  const [weeklyReviews, setWeeklyReviews, weeklyReviewsStatus] = useEntityStore(qk.weeklyReviews, props.initialWeeklyReviews, fetchWeeklyReviews, dataOptions("weeklyReviews"));
  const [jobListings, , jobListingsStatus] = useEntityStore(qk.jobListings, props.initialJobListings, careerLoaders.jobListings, { ...dataOptions("jobListings"), retry: false });
  const [jobUserStates, setJobUserStates, jobUserStatesStatus] = useEntityStore(qk.jobUserStates, props.initialJobUserStates, careerLoaders.jobUserStates, { ...dataOptions("jobUserStates"), retry: false });
  const [savedJobPositions, setSavedJobPositions, savedJobPositionsStatus] = useEntityStore(qk.savedJobPositions, props.initialSavedJobPositions, careerLoaders.savedJobPositions, { ...dataOptions("savedJobPositions"), retry: false });
  const [jobApplications, setJobApplications, jobApplicationsStatus] = useEntityStore(qk.jobApplications, props.initialJobApplications, careerLoaders.jobApplications, { ...dataOptions("jobApplications"), retry: false });
  const [jobApplicationEvents, setJobApplicationEvents, jobApplicationEventsStatus] = useEntityStore(qk.jobApplicationEvents, props.initialJobApplicationEvents, careerLoaders.jobApplicationEvents, { ...dataOptions("jobApplicationEvents"), retry: false });
  const [coverLetterTemplates, setCoverLetterTemplates, coverLetterTemplatesStatus] = useEntityStore(qk.coverLetterTemplates, props.initialCoverLetterTemplates, careerLoaders.coverLetterTemplates, { ...dataOptions("coverLetterTemplates"), retry: false });
  const [jobLastRun, , jobLastRunStatus] = useEntityStore<JobScrapeRun | null>(qk.jobLastRun, props.initialJobLastRun, careerLoaders.jobLastRun, { ...dataOptions("jobLastRun"), onDemand: true, retry: false });
  const [todayCalendar, , todayCalendarStatus] = useEntityStore(qk.calendarToday, props.todayCalendar, fetchTodayCalendar, dataOptions("todayCalendar"));
  const [weekCalendar, , weekCalendarStatus] = useEntityStore(qk.calendarWeek, props.weekCalendar, fetchWeekCalendar, dataOptions("weekCalendar"));
  const [lastWeekCalendar, , lastWeekCalendarStatus] = useEntityStore(qk.calendarLastWeek, props.lastWeekCalendar, fetchLastWeekCalendar, dataOptions("lastWeekCalendar"));
  const { currency: displayCurrency, setCurrency: setDisplayCurrency } = useDisplayCurrency();

  // "Check for new offers": fetch the destination's on-demand data now, then
  // mark it active so its stores read from the fresh cache. The fixture
  // preview already holds every record, so it only flips the flag.
  const qc = useQueryClient();
  const activateTab = useCallback(async (target: NavTab, parent?: AbortSignal) => {
    parent?.throwIfAborted();
    if (!props.isPreview || (props.previewCareerRecordsIntegration && target === "career")) {
      const loaders: Partial<Record<DashboardDataKey, [QueryKey, (context?: { signal: AbortSignal }) => Promise<unknown>]>> = {
        jobListings: [qk.jobListings, careerLoaders.jobListings],
        jobUserStates: [qk.jobUserStates, careerLoaders.jobUserStates],
        savedJobPositions: [qk.savedJobPositions, careerLoaders.savedJobPositions],
        jobApplications: [qk.jobApplications, careerLoaders.jobApplications],
        jobApplicationEvents: [qk.jobApplicationEvents, careerLoaders.jobApplicationEvents],
        coverLetterTemplates: [qk.coverLetterTemplates, careerLoaders.coverLetterTemplates],
        projects: [qk.projects, fetchProjects],
        organizations: [organizationKey, loadOrganizations],
        opportunities: [qk.opportunities, fetchOpportunities],
      };
      const results = await Promise.allSettled(onDemandDataKeys(target).map((key) => {
        const loader = loaders[key];
        return loader
          ? qc.fetchQuery({ queryKey: loader[0], queryFn: context => loader[1]({ signal: parent ? AbortSignal.any([context.signal,parent]) : context.signal }), staleTime: 0, ...((key === "organizations" || target === "career") ? { retry: false } : {}) })
          : undefined;
      }));
      // Do not turn a failed private-letter load into an apparently empty
      // workspace: keep the manual retry available and surface the failure.
      if (results.some(result => result.status === "rejected")) {
        throw new Error("Could not load destination records");
      }
    }
    parent?.throwIfAborted();
    setActivatedTabs((previous) => (previous.has(target) ? previous : new Set(previous).add(target)));
  }, [props.isPreview, props.previewCareerRecordsIntegration, organizationKey, loadOrganizations, careerLoaders, qc]);

  const entityStatuses = {
    subscriptions: subscriptionsStatus,
    todos: todosStatus,
    accounts: accountsStatus,
    transactions: transactionsStatus,
    plans: plansStatus,
    notes: notesStatus,
    prompts: promptsStatus,
    promptLinks: promptLinksStatus,
    repoNotes: repoNotesStatus,
    repoLinks: repoLinksStatus,
    aiLinks: aiLinksStatus,
    aiCategories: aiCategoriesStatus,
    projectLinks: projectLinksStatus,
    tools: toolsStatus,
    shortcuts: shortcutsStatus,
    referenceRows: referenceRowsStatus,
    importantDates: importantDatesStatus,
    invoices: invoicesStatus,
    invoiceItems: invoiceItemsStatus,
    invoiceSettings: invoiceSettingsStatus,
    projects: projectsStatus,
    projectCommunications: projectCommunicationsStatus,
    projectCosts: projectCostsStatus,
    crons: cronsStatus,
    subscriptionAllocations: subscriptionAllocationsStatus,
    competitors: competitorsStatus,
    organizations: organizationsStatus,
    opportunities: opportunitiesStatus,
    inboxItems: inboxItemsStatus,
    notifications: notificationsStatus,
    weeklyReviews: weeklyReviewsStatus,
    jobListings: jobListingsStatus,
    jobUserStates: jobUserStatesStatus,
    savedJobPositions: savedJobPositionsStatus,
    jobApplications: jobApplicationsStatus,
    jobApplicationEvents: jobApplicationEventsStatus,
    coverLetterTemplates: coverLetterTemplatesStatus,
    jobLastRun: jobLastRunStatus,
    todayCalendar: todayCalendarStatus,
    weekCalendar: weekCalendarStatus,
    lastWeekCalendar: lastWeekCalendarStatus,
  };
  const requiredStatuses = Object.entries(entityStatuses).filter(([key]) => tabNeedsDashboardData(tab, key as DashboardDataKey, activatedTabs.has(tab)));

  const lastG = useRef<number | null>(null);
  useEffect(() => {
    const reset = () => { lastG.current = null; };
    const handler = (event: KeyboardEvent) => {
      const previous = lastG.current; reset();
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest('input,textarea,select,[role="dialog"],[role="combobox"],[role="listbox"],[role="menu"],[role="textbox"]')
        || (target instanceof HTMLElement && target.isContentEditable)) return;
      const now = performance.now();
      // Resolve the second key first: g,g is the Goals chord, not another
      // prefix. Every intervening/ignored key or focus change cancels it.
      if (previous !== null && now >= previous && now - previous < 1500 && TAB_CHORDS[event.key]) {
        event.preventDefault(); setTab(TAB_CHORDS[event.key]); return;
      }
      if (event.key === "g") lastG.current = now;
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("focusin", reset);
    return () => { reset(); window.removeEventListener("keydown", handler); window.removeEventListener("focusin", reset); };
  }, [setTab]);
  const selectedProjectName = useMemo(
    () => projects.find((project) => project.id === selectedProjectId)?.name,
    [projects, selectedProjectId],
  );
  const financePanel = <FinancesPanel view={tab === "accounts" || tab === "transactions" || tab === "categories" ? tab : "overview"} accounts={accounts} setAccounts={setAccounts} transactions={transactions} setTransactions={setTransactions} subscriptions={subscriptions} projects={activeProjects} projectCosts={projectCosts} crons={crons} invoices={invoices} invoiceItems={invoiceItems} displayCurrency={displayCurrency} />;

  return <>
    {!hydrated && <p role="status" className="fixed right-4 top-4 z-50 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground">{t.common.loading}</p>}
    <div data-dashboard-ready={hydrated} inert={!hydrated} aria-busy={!hydrated} className={hydrated ? undefined : "cursor-progress opacity-60"}>
    <MotionConfig reducedMotion="user"><TooltipProvider><ToastProvider><ConfirmationProvider>
    {!props.isPreview && (
      <PreferenceHydrator preferences={props.initialPreferences} />
    )}
    <CommandPalette setTab={setTab} />
    <MobileFab />
    <a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:translate-y-0">{t.nav.skipToContent}</a>
    <div className="mac-desktop">
      <div className="mac-window">
      <Sidebar tab={tab} setTab={setTab} projects={activeNavigationProjects} onOpenProject={openProject} user={{ name: user.name, email: user.email, avatar_url: user.avatar_url }} syncPreferences={!props.isPreview} />
      <main id="main-content" data-section={tab} className={cn("min-w-0 overflow-x-clip pb-[var(--mobile-navigation-clearance)] transition-[padding] duration-200 ease-out motion-reduce:transition-none md:h-full md:pb-0", navCollapsed ? "md:pl-[var(--rail-width)]" : "md:pl-[var(--sidebar-width)]")}>
        <AppToolbar
          tab={tab}
          projectName={selectedProjectName}
          onBack={() => setTab("projects")}
        />
        <div className="mac-content mac-content-scroll min-w-0 px-4 py-4 md:px-6 md:py-5">
        <MobileNav tab={tab} setTab={setTab} />
        <ShellTitleProvider><div key={tab} className="page-frame">
          {isHiddenNavTab(tab) && <p className="mb-3 text-xs text-foreground-subtle">{t.nav.hiddenFromNavigation}</p>}
          <DashboardDestinationBoundary statuses={requiredStatuses.map(([, status]) => status)} onRetry={() => void qc.refetchQueries({ type: "active", predicate: query => query.state.dataUpdatedAt === 0 })}>
          {tab === "home" && <CustomizableOverview syncPreferences={!props.isPreview} nodes={{
            "today-hero": <TodayHero userName={user.name} userEmail={user.email} calendar={todayCalendar} todos={operationalTodos} opportunities={opportunities} jobApplications={jobApplications} importantDates={importantDates} />,
            kpi: <KpiCards subscriptions={subscriptions} todos={operationalTodos} projects={activeProjects} displayCurrency={displayCurrency} />,
            todos: <DailyFocusPanel todos={operationalTodos} isPreview={props.isPreview} timeZone={props.initialTimezone ?? "Europe/Prague"} />,
            crons: <CronMonitorPanel isPreview={props.isPreview && !props.previewMonitoringIntegration} />,
            "work-attention": <WorkAttention opportunities={opportunities} onOpen={() => setTab("opportunities")} />,
            subscriptions: <SubscriptionsPanel subs={subscriptions} setSubs={setSubscriptions} projects={activeProjects} displayCurrency={displayCurrency} compact />,
            calendar: <CalendarPanel compact />,
            goals: <RecurringPlans plans={plans} setPlans={setPlans} />,
          } satisfies Record<WidgetId, React.ReactNode>} />}
          {tab === "inbox" && <InboxPanel items={inboxItems} setItems={setInboxItems} notifications={notifications} setNotifications={setNotifications} />}
          {tab === "work" && <WorkOverviewPanel ownerId={user.id} previewPlanningIntegration={props.previewPlanningIntegration} onOpenProject={openProject} onOpenTab={setTab} taskIndex={projectTaskIndex} repositoryIntegrationEnabled={!props.isPreview || props.previewRepositoryIntegration === true} projects={activeProjects} opportunities={opportunities} organizations={organizations} invoices={invoices} jobApplications={jobApplications} importantDates={importantDates} todos={operationalTodos} costs={projectCosts} crons={crons} reviews={weeklyReviews} setReviews={setWeeklyReviews} reviewsStatus={weeklyReviewsStatus} lastWeekCalendar={lastWeekCalendar} lastWeekCalendarStatus={lastWeekCalendarStatus} isPreview={props.isPreview} previewMarketingCalendars={props.previewMarketingCalendars} />}
          {tab === "projects" && <ProjectsPanel previewAccountIntegration={props.previewAccountIntegration} previewMusicIntegration={props.previewMusicIntegration} previewSourceSettingsIntegration={props.previewProjectIntegration} taskIndex={projectTaskIndex} initialProjectTab={props.initialProjectTab} projects={projects} setProjects={setProjects} costs={projectCosts} setCosts={setProjectCosts} crons={crons} setCrons={setCrons} displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} initialVisibleIds={props.repoVisibleIds} repositoryPreferencesAvailable={props.initialPreferences.sync_available} selectedProjectId={selectedProjectId ?? undefined} onOpenProject={openProject} todos={todos} notes={notes} setNotes={setNotes} invoices={invoices} invoiceItems={invoiceItems} subscriptions={subscriptions} subscriptionAllocations={subscriptionAllocations} transactions={transactions} organizations={organizations} opportunities={opportunities} importantDates={importantDates} prompts={prompts} inboxItems={inboxItems} repoNotes={repoNotes} setRepoNotes={setRepoNotes} repoLinks={repoLinks} setRepoLinks={setRepoLinks} communications={projectCommunications} setCommunications={setProjectCommunications} aiLinks={aiLinks} aiCategories={aiCategories} projectLinks={projectLinks} setProjectLinks={setProjectLinks} promptLinks={promptLinks} competitors={competitors} setCompetitors={setCompetitors} competitorsRefreshFailed={competitorsStatus.refreshFailed || competitorReadFailedFor === props.user.id} syncRepositories={!props.isPreview || props.previewRepositoryIntegration === true} isPreview={props.isPreview} />}
          {tab === "competition" && <CompetitionPanel refreshFailed={competitorsStatus.refreshFailed || competitorReadFailedFor === props.user.id} projects={projects} competitors={competitors} setCompetitors={setCompetitors} onOpenProject={openProject} />}
          {tab === "opportunities" && <OpportunitiesPanel activated={activatedTabs.has("opportunities")} onActivate={() => activateTab("opportunities")} userId={user.id} isPreview={props.isPreview} opportunities={opportunities} setOpportunities={setOpportunities} organizations={organizations} setOrganizations={setOrganizations} setProjects={setProjects} />}
          {tab === "clients" && <ClientsPanel organizations={organizations} setOrganizations={setOrganizations} refreshFailed={organizationsStatus.refreshFailed} projects={activeProjects} opportunities={opportunities} invoices={invoices} invoiceItems={invoiceItems} todos={operationalTodos} notes={notes} importantDates={importantDates} displayCurrency={displayCurrency} />}
          {tab === "career" && <JobsPanel timeZone={props.initialTimezone ?? "Europe/Prague"} activated={activatedTabs.has("career")} onActivate={signal => activateTab("career", signal)} isPreview={props.isPreview && !props.previewCareerIntegration} listings={jobListings} userStates={jobUserStates} setUserStates={setJobUserStates} savedPositions={savedJobPositions} setSavedPositions={setSavedJobPositions} applications={jobApplications} setApplications={setJobApplications} events={jobApplicationEvents} setEvents={setJobApplicationEvents} templates={coverLetterTemplates} setTemplates={setCoverLetterTemplates} lastRun={jobLastRun} userId={user.id} />}
          {tab === "invoices" && <InvoicesPanel invoices={invoices} setInvoices={setInvoices} items={invoiceItems} setItems={setInvoiceItems} settings={invoiceSettings} setSettings={setInvoiceSettings} userId={user.id} displayCurrency={displayCurrency} organizations={organizations} projects={activeProjects} transactions={transactions} />}
          {tab === "money" && <DevFinancePanel subscriptions={subscriptions} allocations={subscriptionAllocations} transactions={transactions} projects={projects} projectCosts={projectCosts} crons={crons} displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} onOpenSubscriptions={() => setTab("subscriptions")} onOpenProject={openProject} />}
          {(tab === "accounts" || tab === "transactions" || tab === "categories") && financePanel}
          {tab === "subscriptions" && <SubscriptionsPanel subs={subscriptions} setSubs={setSubscriptions} projects={activeProjects} allocations={subscriptionAllocations} setAllocations={setSubscriptionAllocations} allocationsReady={subscriptionAllocationsStatus.ready} displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} />}
          {tab === "tasks" && <TodosPanel ownerId={user.id} taskIndex={projectTaskIndex} todos={operationalTodos} projects={activeProjects} organizations={organizations} />}
          {tab === "calendar" && <div className="space-y-4"><CalendarPanel /><WeekView calendar={weekCalendar} selectedCalendarIds={props.selectedCalendarIds} /></div>}
          {tab === "goals" && <PlansPanel plans={plans} setPlans={setPlans} />}
          {tab === "dates" && <ImportantDatesPanel dates={importantDates} setDates={setImportantDates} userId={user.id} projects={activeProjects} organizations={organizations} />}
          {tab === "notes" && <NotesPanel notes={notes} setNotes={setNotes} projects={activeProjects} />}
          {tab === "prompts" && <PromptsPanel prompts={prompts} setPrompts={setPrompts} promptLinks={promptLinks} setPromptLinks={setPromptLinks} projects={activeProjects} aiLinks={aiLinks} aiCategories={aiCategories} projectLinks={projectLinks} />}
          {tab === "tools" && <ToolsPanel tools={tools} setTools={setTools} aiLinks={aiLinks} aiCategories={aiCategories} projects={activeProjects} projectLinks={projectLinks} setProjectLinks={setProjectLinks} subscriptions={subscriptions} displayCurrency={displayCurrency} onShowInLibrary={(linkId) => { setFocusLinkId(linkId); setTab("links"); }} previewDetectedTools={props.previewDetectedTools} />}
          {tab === "links" && <AiPanel aiLinks={aiLinks} setAiLinks={setAiLinks} aiCategories={aiCategories} setAiCategories={setAiCategories} projectLinks={projectLinks} setProjectLinks={setProjectLinks} projects={projects} tools={tools} focusLinkId={focusLinkId} onFocusHandled={() => setFocusLinkId(null)} />}
          {tab === "marketing" && <MarketingPanel liveCampaignActivation={props.previewCampaignActivationIntegration} liveState={props.previewMarketingStateIntegration} liveCalendarImport={props.previewMarketingImportIntegration} isPreview={props.isPreview} onOpenKnowledge={() => setTab("ig-tips")} />}
          {tab === "workflows" && <WorkflowsPanel onNavigate={setTab} />}
          {tab === "ig-tips" && <IgTipsPanel aiLinks={aiLinks} setAiLinks={setAiLinks} aiLinksStatus={aiLinksStatus} projectLinks={projectLinks} setProjectLinks={setProjectLinks} projects={projects} previewMarketingCalendars={props.previewMarketingCalendars} initialQuery={tipQuery} onDeepLinkHandled={clearTipQuery} />}
          {tab === "references" && <ShortcutsPanel shortcuts={shortcuts} setShortcuts={setShortcuts} referenceRows={referenceRows} setReferenceRows={setReferenceRows} />}
          {tab === "settings" && <SettingsPanel exportsAvailable={!props.isPreview || props.previewExportIntegration === true} projects={projects} setProjects={setProjects} projectsStatus={projectsStatus} syncPreferences={!props.isPreview || props.previewPreferencesIntegration} preferencesSyncAvailable={props.initialPreferences.sync_available} />}
          </DashboardDestinationBoundary>
        </div></ShellTitleProvider>
      </div></main>
      </div>
    </div>
  </ConfirmationProvider></ToastProvider></TooltipProvider></MotionConfig>
    </div>
  </>;
}
