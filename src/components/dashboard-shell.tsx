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
import { PromptsPanel } from "@/components/panels/prompts-panel";
import { SettingsPanel } from "@/components/panels/settings-panel";
import { ShortcutsPanel } from "@/components/panels/shortcuts-panel";
import { SubscriptionsPanel } from "@/components/panels/subscriptions-panel";
import { TodosPanel } from "@/components/panels/todos-panel";
import { WorkOverviewPanel } from "@/components/panels/work-overview-panel";
import { AiPanel } from "@/components/panels/ai-panel";
import { CustomizableOverview } from "@/components/overview/customizable-overview";
import { KpiCards } from "@/components/overview/kpi-cards";
import { QuickAdd } from "@/components/overview/quick-add";
import { RecurringPlans } from "@/components/overview/recurring-plans";
import { TasksOverview } from "@/components/overview/tasks-overview";
import { TodayHero } from "@/components/overview/today-hero";
import { WorkAttention } from "@/components/overview/work-attention";
import { WeekView } from "@/components/calendar/week-view";
import { CommandPalette } from "@/components/command-palette";
import { MobileFab } from "@/components/mobile-fab";
import { MobileNav, Sidebar, type NavTab } from "@/components/nav/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EventsResult } from "@/lib/calendar";
import { tabNeedsDashboardData, type DashboardDataKey } from "@/lib/dashboard-data";
import type { WidgetId } from "@/lib/dashboard-layout";
import { tabFromPath, tabToPath } from "@/lib/nav-tabs";
import { useEntityStore } from "@/lib/queries/entities";
import {
  fetchAccounts,
  fetchAiCategories,
  fetchAiLinks,
  fetchCoverLetterTemplates,
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
  fetchNotes,
  fetchNotifications,
  fetchOpportunities,
  fetchOrganizations,
  fetchPlans,
  fetchProjectCosts,
  fetchProjects,
  fetchPrompts,
  fetchReferenceRows,
  fetchRepoLinks,
  fetchRepoNotes,
  fetchShortcuts,
  fetchSubscriptions,
  fetchTodos,
  fetchTransactions,
  fetchWeeklyReviews,
} from "@/lib/queries/fetchers";
import { qk } from "@/lib/queries/keys";
import { useDisplayCurrency, useNavCollapsed } from "@/lib/use-prefs";
import { cn } from "@/lib/utils";
import { isActionableNotification } from "@/lib/notifications";
import type {
  Account, AiCategory, AiLink, AppNotification, ClientOpportunity, CoverLetterTemplate, Cron,
  ImportantDate, InboxItem, Invoice, InvoiceItem, InvoiceSettings,
  JobApplication, JobApplicationEvent, JobListing, JobScrapeRun, JobUserState,
  Note, Organization, Plan, Project, ProjectCost, Prompt, ReferenceRow, RepoLink, RepoNote,
  Shortcut, Subscription, Todo, Transaction, WeeklyReview,
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
  initialRepoNotes: RepoNote[];
  initialRepoLinks: RepoLink[];
  initialAiLinks: AiLink[];
  initialAiCategories: AiCategory[];
  initialShortcuts: Shortcut[];
  initialReferenceRows: ReferenceRow[];
  initialImportantDates: ImportantDate[];
  initialInvoices: Invoice[];
  initialInvoiceItems: InvoiceItem[];
  initialInvoiceSettings: InvoiceSettings | null;
  initialProjects: Project[];
  initialProjectCosts: ProjectCost[];
  initialCrons: Cron[];
  initialOrganizations: Organization[];
  initialOpportunities: ClientOpportunity[];
  initialInboxItems: InboxItem[];
  initialNotifications: AppNotification[];
  initialWeeklyReviews: WeeklyReview[];
  initialJobListings: JobListing[];
  initialJobUserStates: JobUserState[];
  initialJobApplications: JobApplication[];
  initialJobApplicationEvents: JobApplicationEvent[];
  initialCoverLetterTemplates: CoverLetterTemplate[];
  initialJobLastRun: JobScrapeRun | null;
  todayCalendar: EventsResult;
  weekCalendar: EventsResult;
  selectedCalendarIds: string[];
  repoVisibleIds: string[];
};

const TAB_CHORDS: Record<string, NavTab> = {
  h: "home", i: "inbox", w: "work", p: "projects", o: "opportunities",
  c: "clients", j: "career", f: "invoices", m: "money", a: "accounts",
  x: "transactions", s: "subscriptions", t: "tasks", l: "calendar",
  g: "goals", d: "dates", n: "notes", r: "references",
};

export function DashboardShell(props: Props) {
  const { user } = props;
  const [tab, setTabState] = useState<NavTab>(props.initialTab);
  const seededData = useMemo(() => new Set(props.initialDataKeys), [props.initialDataKeys]);
  const dataOptions = useCallback((key: DashboardDataKey) => ({
    seeded: seededData.has(key),
    enabled: tabNeedsDashboardData(tab, key),
  }), [seededData, tab]);
  const setTab = useCallback((next: NavTab) => {
    setTabState(next);
    const path = tabToPath(next);
    if (typeof window !== "undefined" && window.location.pathname !== path) window.history.pushState(null, "", path);
  }, []);
  useEffect(() => { const onPop = () => setTabState(tabFromPath(window.location.pathname)); window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
  const { collapsed: navCollapsed } = useNavCollapsed();
  const [subscriptions, setSubscriptions] = useEntityStore(qk.subscriptions, props.initialSubscriptions, fetchSubscriptions, dataOptions("subscriptions"));
  const [todos, setTodos] = useEntityStore(qk.todos, props.initialTodos, fetchTodos, dataOptions("todos"));
  const [accounts, setAccounts] = useEntityStore(qk.accounts, props.initialAccounts, fetchAccounts, dataOptions("accounts"));
  const [transactions, setTransactions] = useEntityStore(qk.transactions, props.initialTransactions, fetchTransactions, dataOptions("transactions"));
  const [plans, setPlans] = useEntityStore(qk.plans, props.initialPlans, fetchPlans, dataOptions("plans"));
  const [notes, setNotes] = useEntityStore(qk.notes, props.initialNotes, fetchNotes, dataOptions("notes"));
  const [prompts, setPrompts] = useEntityStore(qk.prompts, props.initialPrompts, fetchPrompts, dataOptions("prompts"));
  const [repoNotes, setRepoNotes] = useEntityStore(qk.repoNotes, props.initialRepoNotes, fetchRepoNotes, dataOptions("repoNotes"));
  const [repoLinks, setRepoLinks] = useEntityStore(qk.repoLinks, props.initialRepoLinks, fetchRepoLinks, dataOptions("repoLinks"));
  const [aiLinks, setAiLinks] = useEntityStore(qk.aiLinks, props.initialAiLinks, fetchAiLinks, dataOptions("aiLinks"));
  const [aiCategories, setAiCategories] = useEntityStore(qk.aiCategories, props.initialAiCategories, fetchAiCategories, dataOptions("aiCategories"));
  const [shortcuts, setShortcuts] = useEntityStore(qk.shortcuts, props.initialShortcuts, fetchShortcuts, dataOptions("shortcuts"));
  const [referenceRows, setReferenceRows] = useEntityStore(qk.referenceRows, props.initialReferenceRows, fetchReferenceRows, dataOptions("referenceRows"));
  const [importantDates, setImportantDates] = useEntityStore(qk.importantDates, props.initialImportantDates, fetchImportantDates, dataOptions("importantDates"));
  const [invoices, setInvoices] = useEntityStore(qk.invoices, props.initialInvoices, fetchInvoices, dataOptions("invoices"));
  const [invoiceItems, setInvoiceItems] = useEntityStore(qk.invoiceItems, props.initialInvoiceItems, fetchInvoiceItems, dataOptions("invoiceItems"));
  const [invoiceSettings, setInvoiceSettings] = useEntityStore<InvoiceSettings | null>(qk.invoiceSettings, props.initialInvoiceSettings, fetchInvoiceSettings, dataOptions("invoiceSettings"));
  const [projects, setProjects] = useEntityStore(qk.projects, props.initialProjects, fetchProjects, dataOptions("projects"));
  const [projectCosts, setProjectCosts] = useEntityStore(qk.projectCosts, props.initialProjectCosts, fetchProjectCosts, dataOptions("projectCosts"));
  const [crons, setCrons] = useEntityStore(qk.crons, props.initialCrons, fetchCrons, dataOptions("crons"));
  const [organizations, setOrganizations] = useEntityStore(qk.organizations, props.initialOrganizations, fetchOrganizations, dataOptions("organizations"));
  const [opportunities, setOpportunities] = useEntityStore(qk.opportunities, props.initialOpportunities, fetchOpportunities, dataOptions("opportunities"));
  const [inboxItems, setInboxItems] = useEntityStore(qk.inboxItems, props.initialInboxItems, fetchInboxItems, dataOptions("inboxItems"));
  const [notifications, setNotifications] = useEntityStore(qk.notifications, props.initialNotifications, fetchNotifications, dataOptions("notifications"));
  const [weeklyReviews, setWeeklyReviews] = useEntityStore(qk.weeklyReviews, props.initialWeeklyReviews, fetchWeeklyReviews, dataOptions("weeklyReviews"));
  const [jobListings] = useEntityStore(qk.jobListings, props.initialJobListings, fetchJobListings, dataOptions("jobListings"));
  const [jobUserStates, setJobUserStates] = useEntityStore(qk.jobUserStates, props.initialJobUserStates, fetchJobUserStates, dataOptions("jobUserStates"));
  const [jobApplications, setJobApplications] = useEntityStore(qk.jobApplications, props.initialJobApplications, fetchJobApplications, dataOptions("jobApplications"));
  const [jobApplicationEvents, setJobApplicationEvents] = useEntityStore(qk.jobApplicationEvents, props.initialJobApplicationEvents, fetchJobApplicationEvents, dataOptions("jobApplicationEvents"));
  const [coverLetterTemplates, setCoverLetterTemplates] = useEntityStore(qk.coverLetterTemplates, props.initialCoverLetterTemplates, fetchCoverLetterTemplates, dataOptions("coverLetterTemplates"));
  const [jobLastRun] = useEntityStore<JobScrapeRun | null>(qk.jobLastRun, props.initialJobLastRun, fetchJobLastRun, dataOptions("jobLastRun"));
  const [todayCalendar] = useEntityStore(qk.calendarToday, props.todayCalendar, fetchTodayCalendar, dataOptions("todayCalendar"));
  const [weekCalendar] = useEntityStore(qk.calendarWeek, props.weekCalendar, fetchWeekCalendar, dataOptions("weekCalendar"));
  const { currency: displayCurrency, setCurrency: setDisplayCurrency } = useDisplayCurrency();
  const [calendarPrefill, setCalendarPrefill] = useState<{ title: string; nonce: number } | null>(null);
  const handleCalendarTitle = useCallback((title: string) => { setCalendarPrefill({ title, nonce: Date.now() }); setTab("calendar"); }, [setTab]);

  const lastG = useRef(0);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "g") { lastG.current = Date.now(); return; }
      if (Date.now() - lastG.current < 1500 && TAB_CHORDS[event.key]) { setTab(TAB_CHORDS[event.key]); lastG.current = 0; event.preventDefault(); return; }
      if (event.key === "n") { setTab("home"); requestAnimationFrame(() => document.getElementById("quick-add-input")?.focus()); event.preventDefault(); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [setTab]);
  const focusQuickAdd = useCallback(() => document.getElementById("quick-add-input")?.focus(), []);
  const financePanel = <FinancesPanel accounts={accounts} setAccounts={setAccounts} transactions={transactions} setTransactions={setTransactions} subscriptions={subscriptions} projects={projects} projectCosts={projectCosts} crons={crons} displayCurrency={displayCurrency} />;

  return <MotionConfig reducedMotion="user"><TooltipProvider><ToastProvider>
    <CommandPalette setTab={setTab} onFocusQuickAdd={focusQuickAdd} />
    <MobileFab onClick={() => { setTab("home"); requestAnimationFrame(focusQuickAdd); }} />
    <div className="min-h-screen bg-background">
      <Sidebar tab={tab} setTab={setTab} user={{ name: user.name, email: user.email, avatar_url: user.avatar_url }} unreadNotifications={notifications.filter((item) => isActionableNotification(item)).length} />
      <main className={cn("transition-[padding] duration-200 ease-out", navCollapsed ? "md:pl-16" : "md:pl-60")}><div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <MobileNav tab={tab} setTab={setTab} />
        <AnimatePresence mode="wait"><motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
          {tab === "home" && <CustomizableOverview nodes={{
            "today-hero": <TodayHero userName={user.name} userEmail={user.email} calendar={todayCalendar} todos={todos} opportunities={opportunities} importantDates={importantDates} />,
            "quick-add": <QuickAdd setTodos={setTodos} setInboxItems={setInboxItems} onCalendarTitle={handleCalendarTitle} />,
            kpi: <KpiCards subscriptions={subscriptions} todos={todos} projects={projects} displayCurrency={displayCurrency} />,
            todos: <TasksOverview todos={todos} onOpenAll={() => setTab("tasks")} />,
            "work-attention": <WorkAttention opportunities={opportunities} onOpen={() => setTab("opportunities")} />,
            subscriptions: <SubscriptionsPanel subs={subscriptions} setSubs={setSubscriptions} projects={projects} displayCurrency={displayCurrency} compact />,
            calendar: <CalendarPanel compact />,
            goals: <RecurringPlans plans={plans} setPlans={setPlans} />,
          } satisfies Record<WidgetId, React.ReactNode>} />}
          {tab === "inbox" && <InboxPanel items={inboxItems} setItems={setInboxItems} notifications={notifications} setNotifications={setNotifications} />}
          {tab === "work" && <WorkOverviewPanel projects={projects} opportunities={opportunities} organizations={organizations} invoices={invoices} jobApplications={jobApplications} importantDates={importantDates} todos={todos} costs={projectCosts} crons={crons} reviews={weeklyReviews} setReviews={setWeeklyReviews} />}
          {tab === "projects" && <ProjectsPanel projects={projects} setProjects={setProjects} costs={projectCosts} setCosts={setProjectCosts} crons={crons} setCrons={setCrons} displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} initialVisibleIds={props.repoVisibleIds} initialProjectId={props.initialProjectId} todos={todos} notes={notes} invoices={invoices} invoiceItems={invoiceItems} subscriptions={subscriptions} transactions={transactions} organizations={organizations} opportunities={opportunities} importantDates={importantDates} prompts={prompts} inboxItems={inboxItems} repoNotes={repoNotes} setRepoNotes={setRepoNotes} repoLinks={repoLinks} setRepoLinks={setRepoLinks} syncRepositories={!props.isPreview} />}
          {tab === "opportunities" && <OpportunitiesPanel opportunities={opportunities} setOpportunities={setOpportunities} organizations={organizations} setOrganizations={setOrganizations} setProjects={setProjects} />}
          {tab === "clients" && <ClientsPanel organizations={organizations} setOrganizations={setOrganizations} projects={projects} opportunities={opportunities} invoices={invoices} invoiceItems={invoiceItems} todos={todos} notes={notes} importantDates={importantDates} displayCurrency={displayCurrency} />}
          {tab === "career" && <JobsPanel listings={jobListings} userStates={jobUserStates} setUserStates={setJobUserStates} applications={jobApplications} setApplications={setJobApplications} events={jobApplicationEvents} setEvents={setJobApplicationEvents} templates={coverLetterTemplates} setTemplates={setCoverLetterTemplates} lastRun={jobLastRun} userId={user.id} />}
          {tab === "invoices" && <InvoicesPanel invoices={invoices} setInvoices={setInvoices} items={invoiceItems} setItems={setInvoiceItems} settings={invoiceSettings} setSettings={setInvoiceSettings} userId={user.id} displayCurrency={displayCurrency} organizations={organizations} projects={projects} />}
          {(tab === "money" || tab === "accounts" || tab === "transactions" || tab === "categories") && financePanel}
          {tab === "subscriptions" && <SubscriptionsPanel subs={subscriptions} setSubs={setSubscriptions} projects={projects} displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} />}
          {tab === "tasks" && <TodosPanel todos={todos} projects={projects} organizations={organizations} />}
          {tab === "calendar" && <div className="grid gap-4 lg:grid-cols-2"><CalendarPanel key={calendarPrefill?.nonce ?? "idle"} initialTitle={calendarPrefill?.title} /><WeekView calendar={weekCalendar} selectedCalendarIds={props.selectedCalendarIds} /></div>}
          {tab === "goals" && <PlansPanel plans={plans} setPlans={setPlans} />}
          {tab === "dates" && <ImportantDatesPanel dates={importantDates} setDates={setImportantDates} userId={user.id} projects={projects} organizations={organizations} />}
          {tab === "notes" && <NotesPanel notes={notes} setNotes={setNotes} projects={projects} />}
          {tab === "prompts" && <PromptsPanel prompts={prompts} setPrompts={setPrompts} projects={projects} />}
          {tab === "links" && <AiPanel aiLinks={aiLinks} setAiLinks={setAiLinks} aiCategories={aiCategories} setAiCategories={setAiCategories} />}
          {tab === "references" && <ShortcutsPanel shortcuts={shortcuts} setShortcuts={setShortcuts} referenceRows={referenceRows} setReferenceRows={setReferenceRows} />}
          {tab === "settings" && <SettingsPanel syncPreferences={!props.isPreview} />}
        </motion.div></AnimatePresence>
      </div></main>
    </div>
  </ToastProvider></TooltipProvider></MotionConfig>;
}
