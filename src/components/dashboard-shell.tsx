"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { CalendarPanel } from "@/components/panels/calendar-panel";
import { ClientsPanel } from "@/components/panels/clients-panel";
import { FinancesPanel } from "@/components/panels/finances-panel";
import { InboxPanel } from "@/components/panels/inbox-panel";
import { ImportantDatesPanel } from "@/components/panels/important-dates-panel";
import { InvoicesPanel } from "@/components/panels/invoices-panel";
import { JobsPanel } from "@/components/panels/jobs-panel";
import { NotesPanel } from "@/components/panels/notes-panel";
import { OpportunitiesPanel } from "@/components/panels/opportunities-panel";
import { PlansPanel } from "@/components/panels/plans-panel";
import { ProjectsPanel } from "@/components/panels/projects-panel";
import { CompetitionPanel } from "@/components/panels/competition-panel";
import { DevFinancePanel } from "@/components/panels/dev-finance-panel";
import { PromptsPanel } from "@/components/panels/prompts-panel";
import { SettingsPanel } from "@/components/panels/settings-panel";
import { ShortcutsPanel } from "@/components/panels/shortcuts-panel";
import { SubscriptionsPanel } from "@/components/panels/subscriptions-panel";
import { TodosPanel } from "@/components/panels/todos-panel";
import { ToolsPanel } from "@/components/panels/tools-panel";
import { WorkOverviewPanel } from "@/components/panels/work-overview-panel";
import { AiPanel } from "@/components/panels/ai-panel";
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
import { AppToolbar } from "@/components/nav/app-toolbar";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmationProvider } from "@/components/ui/confirmation-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EventsResult } from "@/lib/calendar";
import { onDemandDataKeys, tabNeedsDashboardData, type DashboardDataKey } from "@/lib/dashboard-data";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { WidgetId } from "@/lib/dashboard-layout";
import { isHiddenNavTab, tabFromPath, tabToPath } from "@/lib/nav-tabs";
import { useEntityStore } from "@/lib/queries/entities";
import { taskBelongsToProject } from "@/lib/project-match";
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

type Props = {
  isPreview?: boolean;
  initialProjectId?: string;
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
};

// `g` then a letter. Inbox and References are hidden from navigation, so
// they have no chord (`g i` and `g r` do nothing).
const TAB_CHORDS: Record<string, NavTab> = {
  h: "home", w: "work", p: "projects", q: "competition", o: "opportunities",
  c: "clients", j: "career", f: "invoices", m: "money", a: "accounts",
  x: "transactions", s: "subscriptions", t: "tasks", l: "calendar",
  g: "goals", d: "dates", n: "notes", k: "tools",
};

export function DashboardShell(props: Props) {
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
    enabled: tabNeedsDashboardData(tab, key, activatedTabs.has(tab)),
    onDemand: onDemandDataKeys(tab).includes(key),
  }), [seededData, tab, activatedTabs]);
  const setTab = useCallback((next: NavTab) => {
    setTabState(next);
    setSelectedProjectId(null);
    const path = tabToPath(next);
    if (typeof window !== "undefined" && window.location.pathname !== path) window.history.pushState(null, "", path);
  }, []);
  const { collapsed: navCollapsed } = useNavCollapsed();
  const [subscriptions, setSubscriptions] = useEntityStore(qk.subscriptions, props.initialSubscriptions, fetchSubscriptions, dataOptions("subscriptions"));
  const [todos] = useEntityStore(qk.todos, props.initialTodos, fetchTodos, dataOptions("todos"));
  const [accounts, setAccounts] = useEntityStore(qk.accounts, props.initialAccounts, fetchAccounts, dataOptions("accounts"));
  const [transactions, setTransactions] = useEntityStore(qk.transactions, props.initialTransactions, fetchTransactions, dataOptions("transactions"));
  const [plans, setPlans] = useEntityStore(qk.plans, props.initialPlans, fetchPlans, dataOptions("plans"));
  const [notes, setNotes] = useEntityStore(qk.notes, props.initialNotes, fetchNotes, dataOptions("notes"));
  const [prompts, setPrompts] = useEntityStore(qk.prompts, props.initialPrompts, fetchPrompts, dataOptions("prompts"));
  const [promptLinks, setPromptLinks] = useEntityStore(qk.promptLinks, props.initialPromptLinks, fetchPromptLinks, dataOptions("promptLinks"));
  const [repoNotes, setRepoNotes] = useEntityStore(qk.repoNotes, props.initialRepoNotes, fetchRepoNotes, dataOptions("repoNotes"));
  const [repoLinks, setRepoLinks] = useEntityStore(qk.repoLinks, props.initialRepoLinks, fetchRepoLinks, dataOptions("repoLinks"));
  const [aiLinks, setAiLinks] = useEntityStore(qk.aiLinks, props.initialAiLinks, fetchAiLinks, dataOptions("aiLinks"));
  const [aiCategories, setAiCategories] = useEntityStore(qk.aiCategories, props.initialAiCategories, fetchAiCategories, dataOptions("aiCategories"));
  const [projectLinks, setProjectLinks] = useEntityStore(qk.projectLinks, props.initialProjectLinks, fetchProjectLinks, dataOptions("projectLinks"));
  const [tools, setTools] = useEntityStore(qk.tools, props.initialTools, fetchTools, dataOptions("tools"));
  // A Tools card's "Show in Links" opens the library at that link's card.
  const [focusLinkId, setFocusLinkId] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useEntityStore(qk.shortcuts, props.initialShortcuts, fetchShortcuts, dataOptions("shortcuts"));
  const [referenceRows, setReferenceRows] = useEntityStore(qk.referenceRows, props.initialReferenceRows, fetchReferenceRows, dataOptions("referenceRows"));
  const [importantDates, setImportantDates] = useEntityStore(qk.importantDates, props.initialImportantDates, fetchImportantDates, dataOptions("importantDates"));
  const [invoices, setInvoices] = useEntityStore(qk.invoices, props.initialInvoices, fetchInvoices, dataOptions("invoices"));
  const [invoiceItems, setInvoiceItems] = useEntityStore(qk.invoiceItems, props.initialInvoiceItems, fetchInvoiceItems, dataOptions("invoiceItems"));
  const [invoiceSettings, setInvoiceSettings] = useEntityStore<InvoiceSettings | null>(qk.invoiceSettings, props.initialInvoiceSettings, fetchInvoiceSettings, dataOptions("invoiceSettings"));
  const [projects, setProjects] = useEntityStore(qk.projects, props.initialProjects, fetchProjects, dataOptions("projects"));
  const activeProjects = useMemo(
    () => projects.filter((project) => project.is_active),
    [projects],
  );
  const openProject = useCallback(
    (project: Pick<Project, "id" | "slug">) => {
      setTabState("projects");
      setSelectedProjectId(project.id);
      const path = `/projects/${encodeURIComponent(project.slug)}`;
      if (window.location.pathname !== path) {
        window.history.pushState(null, "", path);
      }
    },
    [],
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
      projects.length > 0
        ? activeProjects
        : props.initialNavigationProjects.filter((project) => project.is_active),
    [activeProjects, projects.length, props.initialNavigationProjects],
  );
  const operationalTodos = useMemo(() => {
    const activeIds = new Set(activeProjects.map((project) => project.id));
    return todos.filter((todo) => {
      if (todo.is_global) return true;
      if (todo.project_id) return activeIds.has(todo.project_id);
      if (todo.repo_full_name || todo.repo_id) {
        return activeProjects.some((project) => taskBelongsToProject(todo, project));
      }
      return true;
    });
  }, [activeProjects, todos]);
  const [projectCommunications, setProjectCommunications] = useEntityStore(qk.projectCommunications, props.initialProjectCommunications, fetchProjectCommunications, dataOptions("projectCommunications"));
  const [projectCosts, setProjectCosts] = useEntityStore(qk.projectCosts, props.initialProjectCosts, fetchProjectCosts, dataOptions("projectCosts"));
  const [crons, setCrons] = useEntityStore(qk.crons, props.initialCrons, fetchCrons, dataOptions("crons"));
  const [subscriptionAllocations, setSubscriptionAllocations] = useEntityStore(qk.subscriptionAllocations, props.initialSubscriptionAllocations, fetchSubscriptionAllocations, dataOptions("subscriptionAllocations"));
  const [competitors, setCompetitors] = useEntityStore(qk.competitors, props.initialCompetitors, fetchCompetitors, dataOptions("competitors"));
  const [organizations, setOrganizations] = useEntityStore(qk.organizations, props.initialOrganizations, fetchOrganizations, dataOptions("organizations"));
  const [opportunities, setOpportunities] = useEntityStore(qk.opportunities, props.initialOpportunities, fetchOpportunities, dataOptions("opportunities"));
  const [inboxItems, setInboxItems] = useEntityStore(qk.inboxItems, props.initialInboxItems, fetchInboxItems, dataOptions("inboxItems"));
  const [notifications, setNotifications] = useEntityStore(qk.notifications, props.initialNotifications, fetchNotifications, dataOptions("notifications"));
  const [weeklyReviews, setWeeklyReviews] = useEntityStore(qk.weeklyReviews, props.initialWeeklyReviews, fetchWeeklyReviews, dataOptions("weeklyReviews"));
  const [jobListings] = useEntityStore(qk.jobListings, props.initialJobListings, fetchJobListings, dataOptions("jobListings"));
  const [jobUserStates, setJobUserStates] = useEntityStore(qk.jobUserStates, props.initialJobUserStates, fetchJobUserStates, dataOptions("jobUserStates"));
  const [savedJobPositions, setSavedJobPositions] = useEntityStore(qk.savedJobPositions, props.initialSavedJobPositions, fetchSavedJobPositions, dataOptions("savedJobPositions"));
  const [jobApplications, setJobApplications] = useEntityStore(qk.jobApplications, props.initialJobApplications, fetchJobApplications, dataOptions("jobApplications"));
  const [jobApplicationEvents, setJobApplicationEvents] = useEntityStore(qk.jobApplicationEvents, props.initialJobApplicationEvents, fetchJobApplicationEvents, dataOptions("jobApplicationEvents"));
  const [coverLetterTemplates, setCoverLetterTemplates] = useEntityStore(qk.coverLetterTemplates, props.initialCoverLetterTemplates, fetchCoverLetterTemplates, dataOptions("coverLetterTemplates"));
  const [jobLastRun] = useEntityStore<JobScrapeRun | null>(qk.jobLastRun, props.initialJobLastRun, fetchJobLastRun, dataOptions("jobLastRun"));
  const [todayCalendar] = useEntityStore(qk.calendarToday, props.todayCalendar, fetchTodayCalendar, dataOptions("todayCalendar"));
  const [weekCalendar] = useEntityStore(qk.calendarWeek, props.weekCalendar, fetchWeekCalendar, dataOptions("weekCalendar"));
  const [lastWeekCalendar] = useEntityStore(qk.calendarLastWeek, props.lastWeekCalendar, fetchLastWeekCalendar, dataOptions("lastWeekCalendar"));
  const { currency: displayCurrency, setCurrency: setDisplayCurrency } = useDisplayCurrency();

  // "Check for new offers": fetch the destination's on-demand data now, then
  // mark it active so its stores read from the fresh cache. The fixture
  // preview already holds every record, so it only flips the flag.
  const qc = useQueryClient();
  const activateTab = useCallback(async (target: NavTab) => {
    if (!props.isPreview) {
      const loaders: Partial<Record<DashboardDataKey, [QueryKey, () => Promise<unknown>]>> = {
        jobListings: [qk.jobListings, fetchJobListings],
        jobUserStates: [qk.jobUserStates, fetchJobUserStates],
        savedJobPositions: [qk.savedJobPositions, fetchSavedJobPositions],
        jobApplications: [qk.jobApplications, fetchJobApplications],
        jobApplicationEvents: [qk.jobApplicationEvents, fetchJobApplicationEvents],
        coverLetterTemplates: [qk.coverLetterTemplates, fetchCoverLetterTemplates],
        projects: [qk.projects, fetchProjects],
        organizations: [qk.organizations, fetchOrganizations],
        opportunities: [qk.opportunities, fetchOpportunities],
      };
      await Promise.all(onDemandDataKeys(target).map((key) => {
        const loader = loaders[key];
        return loader
          ? qc.fetchQuery({ queryKey: loader[0], queryFn: loader[1], staleTime: 0 }).catch(() => undefined)
          : undefined;
      }));
    }
    setActivatedTabs((previous) => (previous.has(target) ? previous : new Set(previous).add(target)));
  }, [props.isPreview, qc]);

  const lastG = useRef(0);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "g") { lastG.current = Date.now(); return; }
      if (Date.now() - lastG.current < 1500 && TAB_CHORDS[event.key]) { setTab(TAB_CHORDS[event.key]); lastG.current = 0; event.preventDefault(); return; }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [setTab]);
  const selectedProjectName = useMemo(
    () => projects.find((project) => project.id === selectedProjectId)?.name,
    [projects, selectedProjectId],
  );
  const financePanel = <FinancesPanel accounts={accounts} setAccounts={setAccounts} transactions={transactions} setTransactions={setTransactions} subscriptions={subscriptions} projects={activeProjects} projectCosts={projectCosts} crons={crons} invoices={invoices} invoiceItems={invoiceItems} displayCurrency={displayCurrency} />;

  return <MotionConfig reducedMotion="user"><TooltipProvider><ToastProvider><ConfirmationProvider>
    {!props.isPreview && (
      <PreferenceHydrator preferences={props.initialPreferences} />
    )}
    <CommandPalette setTab={setTab} />
    <MobileFab />
    <a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:translate-y-0">{t.nav.skipToContent}</a>
    <div className="mac-desktop">
      <div className="mac-window">
      <Sidebar tab={tab} setTab={setTab} projects={activeNavigationProjects} onOpenProject={openProject} user={{ name: user.name, email: user.email, avatar_url: user.avatar_url }} syncPreferences={!props.isPreview} />
      <main id="main-content" data-section={tab} className={cn("min-w-0 overflow-x-clip pb-20 transition-[padding] duration-200 ease-out md:h-full md:pb-0", navCollapsed ? "md:pl-[var(--rail-width)]" : "md:pl-[var(--sidebar-width)]")}>
        <AppToolbar
          tab={tab}
          projectName={selectedProjectName}
        />
        <div className="mac-content mac-content-scroll min-w-0 px-4 py-4 md:px-6 md:py-5">
        <MobileNav tab={tab} setTab={setTab} />
        <AnimatePresence mode="wait"><motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          {isHiddenNavTab(tab) && <p className="mb-3 text-xs text-foreground-subtle">{t.nav.hiddenFromNavigation}</p>}
          {tab === "home" && <CustomizableOverview syncPreferences={!props.isPreview} nodes={{
            "today-hero": <TodayHero userName={user.name} userEmail={user.email} calendar={todayCalendar} todos={operationalTodos} opportunities={opportunities} jobApplications={jobApplications} importantDates={importantDates} />,
            kpi: <KpiCards subscriptions={subscriptions} todos={operationalTodos} projects={activeProjects} displayCurrency={displayCurrency} />,
            todos: <DailyFocusPanel todos={operationalTodos} isPreview={props.isPreview} />,
            crons: <CronMonitorPanel isPreview={props.isPreview} />,
            "work-attention": <WorkAttention opportunities={opportunities} onOpen={() => setTab("opportunities")} />,
            subscriptions: <SubscriptionsPanel subs={subscriptions} setSubs={setSubscriptions} projects={activeProjects} displayCurrency={displayCurrency} compact />,
            calendar: <CalendarPanel compact />,
            goals: <RecurringPlans plans={plans} setPlans={setPlans} />,
          } satisfies Record<WidgetId, React.ReactNode>} />}
          {tab === "inbox" && <InboxPanel items={inboxItems} setItems={setInboxItems} notifications={notifications} setNotifications={setNotifications} />}
          {tab === "work" && <WorkOverviewPanel projects={activeProjects} opportunities={opportunities} organizations={organizations} invoices={invoices} jobApplications={jobApplications} importantDates={importantDates} todos={operationalTodos} costs={projectCosts} crons={crons} reviews={weeklyReviews} setReviews={setWeeklyReviews} lastWeekCalendar={lastWeekCalendar} isPreview={props.isPreview} />}
          {tab === "projects" && <ProjectsPanel projects={projects} setProjects={setProjects} costs={projectCosts} setCosts={setProjectCosts} crons={crons} setCrons={setCrons} displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} initialVisibleIds={props.repoVisibleIds} selectedProjectId={selectedProjectId ?? undefined} onOpenProject={openProject} onBackToProjects={() => setTab("projects")} todos={todos} notes={notes} setNotes={setNotes} invoices={invoices} invoiceItems={invoiceItems} subscriptions={subscriptions} subscriptionAllocations={subscriptionAllocations} transactions={transactions} organizations={organizations} opportunities={opportunities} importantDates={importantDates} prompts={prompts} inboxItems={inboxItems} repoNotes={repoNotes} setRepoNotes={setRepoNotes} repoLinks={repoLinks} setRepoLinks={setRepoLinks} communications={projectCommunications} setCommunications={setProjectCommunications} aiLinks={aiLinks} aiCategories={aiCategories} projectLinks={projectLinks} setProjectLinks={setProjectLinks} promptLinks={promptLinks} competitors={competitors} setCompetitors={setCompetitors} syncRepositories={!props.isPreview} isPreview={props.isPreview} />}
          {tab === "competition" && <CompetitionPanel projects={projects} competitors={competitors} setCompetitors={setCompetitors} onOpenProject={openProject} />}
          {tab === "opportunities" && <OpportunitiesPanel activated={activatedTabs.has("opportunities")} onActivate={() => activateTab("opportunities")} userId={user.id} isPreview={props.isPreview} opportunities={opportunities} setOpportunities={setOpportunities} organizations={organizations} setOrganizations={setOrganizations} setProjects={setProjects} />}
          {tab === "clients" && <ClientsPanel organizations={organizations} setOrganizations={setOrganizations} projects={activeProjects} opportunities={opportunities} invoices={invoices} invoiceItems={invoiceItems} todos={operationalTodos} notes={notes} importantDates={importantDates} displayCurrency={displayCurrency} />}
          {tab === "career" && <JobsPanel activated={activatedTabs.has("career")} onActivate={() => activateTab("career")} isPreview={props.isPreview} listings={jobListings} userStates={jobUserStates} setUserStates={setJobUserStates} savedPositions={savedJobPositions} setSavedPositions={setSavedJobPositions} applications={jobApplications} setApplications={setJobApplications} events={jobApplicationEvents} setEvents={setJobApplicationEvents} templates={coverLetterTemplates} setTemplates={setCoverLetterTemplates} lastRun={jobLastRun} userId={user.id} />}
          {tab === "invoices" && <InvoicesPanel invoices={invoices} setInvoices={setInvoices} items={invoiceItems} setItems={setInvoiceItems} settings={invoiceSettings} setSettings={setInvoiceSettings} userId={user.id} displayCurrency={displayCurrency} organizations={organizations} projects={activeProjects} transactions={transactions} />}
          {tab === "money" && <DevFinancePanel subscriptions={subscriptions} allocations={subscriptionAllocations} transactions={transactions} projects={projects} projectCosts={projectCosts} crons={crons} displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} onOpenSubscriptions={() => setTab("subscriptions")} onOpenProject={openProject} />}
          {(tab === "accounts" || tab === "transactions" || tab === "categories") && financePanel}
          {tab === "subscriptions" && <SubscriptionsPanel subs={subscriptions} setSubs={setSubscriptions} projects={activeProjects} allocations={subscriptionAllocations} setAllocations={setSubscriptionAllocations} displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} />}
          {tab === "tasks" && <TodosPanel todos={operationalTodos} projects={activeProjects} organizations={organizations} />}
          {tab === "calendar" && <div className="grid gap-4 lg:grid-cols-2"><CalendarPanel /><WeekView calendar={weekCalendar} selectedCalendarIds={props.selectedCalendarIds} /></div>}
          {tab === "goals" && <PlansPanel plans={plans} setPlans={setPlans} />}
          {tab === "dates" && <ImportantDatesPanel dates={importantDates} setDates={setImportantDates} userId={user.id} projects={activeProjects} organizations={organizations} />}
          {tab === "notes" && <NotesPanel notes={notes} setNotes={setNotes} projects={activeProjects} />}
          {tab === "prompts" && <PromptsPanel prompts={prompts} setPrompts={setPrompts} promptLinks={promptLinks} setPromptLinks={setPromptLinks} projects={activeProjects} aiLinks={aiLinks} aiCategories={aiCategories} projectLinks={projectLinks} />}
          {tab === "tools" && <ToolsPanel tools={tools} setTools={setTools} aiLinks={aiLinks} aiCategories={aiCategories} projects={activeProjects} projectLinks={projectLinks} setProjectLinks={setProjectLinks} subscriptions={subscriptions} displayCurrency={displayCurrency} onShowInLibrary={(linkId) => { setFocusLinkId(linkId); setTab("links"); }} />}
          {tab === "links" && <AiPanel aiLinks={aiLinks} setAiLinks={setAiLinks} aiCategories={aiCategories} setAiCategories={setAiCategories} projectLinks={projectLinks} setProjectLinks={setProjectLinks} projects={projects} tools={tools} focusLinkId={focusLinkId} onFocusHandled={() => setFocusLinkId(null)} />}
          {tab === "references" && <ShortcutsPanel shortcuts={shortcuts} setShortcuts={setShortcuts} referenceRows={referenceRows} setReferenceRows={setReferenceRows} />}
          {tab === "settings" && <SettingsPanel projects={projects} setProjects={setProjects} syncPreferences={!props.isPreview} preferencesSyncAvailable={props.initialPreferences.sync_available} />}
        </motion.div></AnimatePresence>
      </div></main>
      </div>
    </div>
  </ConfirmationProvider></ToastProvider></TooltipProvider></MotionConfig>;
}
