"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { CalendarPanel } from "@/components/panels/calendar-panel";
import { SubscriptionsPanel } from "@/components/panels/subscriptions-panel";
import { TodosPanel } from "@/components/panels/todos-panel";
import { StreaksPanel } from "@/components/panels/streaks-panel";
import { FinancesPanel } from "@/components/panels/finances-panel";
import { InvoicesPanel } from "@/components/panels/invoices-panel";
import { PlansPanel } from "@/components/panels/plans-panel";
import { CouplePanel } from "@/components/panels/couple-panel";
import { BooksPanel } from "@/components/panels/books-panel";
import { NotesPanel } from "@/components/panels/notes-panel";
import { PromptsPanel } from "@/components/panels/prompts-panel";
import { ShortcutsPanel } from "@/components/panels/shortcuts-panel";
import { ImportantDatesPanel } from "@/components/panels/important-dates-panel";
import { ReposPanel } from "@/components/panels/repos-panel";
import { AiPanel } from "@/components/panels/ai-panel";
import { SettingsPanel } from "@/components/panels/settings-panel";
import { KpiCards } from "@/components/overview/kpi-cards";
import { QuickAdd } from "@/components/overview/quick-add";
import { TodayHero } from "@/components/overview/today-hero";
import { CustomizableOverview } from "@/components/overview/customizable-overview";
import type { WidgetId } from "@/lib/dashboard-layout";
import { WeekView } from "@/components/calendar/week-view";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar, MobileNav, type NavTab } from "@/components/nav/sidebar";
import { tabFromPath, tabToPath } from "@/lib/nav-tabs";
import { CommandPalette } from "@/components/command-palette";
import { MobileFab } from "@/components/mobile-fab";
import { PartnerTicker } from "@/components/realtime/partner-ticker";
import { useDisplayCurrency, useNavCollapsed } from "@/lib/use-prefs";
import { useEntityStore } from "@/lib/queries/entities";
import {
  fetchAccounts,
  fetchAiCategories,
  fetchAiLinks,
  fetchBookPages,
  fetchBooks,
  fetchImportantDates,
  fetchInvoiceItems,
  fetchInvoiceSettings,
  fetchInvoices,
  fetchNotes,
  fetchPlans,
  fetchPrompts,
  fetchRepoNotes,
  fetchRepoLinks,
  fetchShortcuts,
  fetchStreakLogs,
  fetchStreaks,
  fetchSubscriptions,
  fetchTodos,
  fetchTransactions,
} from "@/lib/queries/fetchers";
import { qk } from "@/lib/queries/keys";
import { cn } from "@/lib/utils";
import type {
  Account,
  AiCategory,
  AiLink,
  Book,
  BookPage,
  ImportantDate,
  Invoice,
  InvoiceItem,
  InvoiceSettings,
  Note,
  Plan,
  Prompt,
  RepoLink,
  RepoNote,
  Shortcut,
  Streak,
  StreakLog,
  Subscription,
  Todo,
  Transaction,
} from "@/lib/types";
import type { EventsResult } from "@/lib/calendar";
import { partnerDisplayName, type CoupleContext, type PartnerData } from "@/lib/couple";

type Props = {
  user: { id: string; email: string; name: string | null; avatar_url: string | null };
  initialTab: NavTab;
  initialSubscriptions: Subscription[];
  initialTodos: Todo[];
  initialStreaks: Streak[];
  initialStreakLogs: StreakLog[];
  initialAccounts: Account[];
  initialTransactions: Transaction[];
  initialPlans: Plan[];
  initialBooks: Book[];
  initialBookPages: BookPage[];
  initialNotes: Note[];
  initialPrompts: Prompt[];
  initialRepoNotes: RepoNote[];
  initialRepoLinks: RepoLink[];
  initialAiLinks: AiLink[];
  initialAiCategories: AiCategory[];
  initialShortcuts: Shortcut[];
  initialImportantDates: ImportantDate[];
  initialInvoices: Invoice[];
  initialInvoiceItems: InvoiceItem[];
  initialInvoiceSettings: InvoiceSettings | null;
  todayCalendar: EventsResult;
  weekCalendar: EventsResult;
  coupleCtx: CoupleContext;
  partnerData: PartnerData | null;
  selectedCalendarIds: string[];
  repoVisibleIds: string[];
};

const TAB_CHORDS: Record<string, NavTab> = {
  o: "overview",
  c: "calendar",
  s: "streaks",
  t: "todos",
  f: "finances",
  i: "invoices",
  p: "plans",
  u: "couple",
  b: "books",
  n: "notes",
  m: "prompts",
  k: "shortcuts",
  d: "dates",
  r: "github",
  a: "ai",
};

export function DashboardShell({
  user,
  initialTab,
  initialSubscriptions,
  initialTodos,
  initialStreaks,
  initialStreakLogs,
  initialAccounts,
  initialTransactions,
  initialPlans,
  initialBooks,
  initialBookPages,
  initialNotes,
  initialPrompts,
  initialRepoNotes,
  initialRepoLinks,
  initialAiLinks,
  initialAiCategories,
  initialShortcuts,
  initialImportantDates,
  initialInvoices,
  initialInvoiceItems,
  initialInvoiceSettings,
  todayCalendar,
  weekCalendar,
  coupleCtx,
  partnerData,
  selectedCalendarIds,
  repoVisibleIds,
}: Props) {
  const [tab, setTabState] = useState<NavTab>(initialTab);
  // Reflect the active section in the URL (/dashboard/<section>) using the
  // History API — no server round-trip, so the SPA feel is preserved. Deep
  // links and refresh are resolved by the route on the server.
  const setTab = useCallback((next: NavTab) => {
    setTabState(next);
    const path = tabToPath(next);
    if (typeof window !== "undefined" && window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
  }, []);
  // Keep the active tab in sync with browser back/forward.
  useEffect(() => {
    const onPop = () =>
      setTabState(tabFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const { collapsed: navCollapsed } = useNavCollapsed();
  // Entity state now lives in the React Query cache (seeded from the server
  // load). Each useEntityStore returns the same [data, setter] shape the panels
  // already consume, so their code is unchanged — only the store moved.
  const [subscriptions, setSubscriptions] = useEntityStore(
    qk.subscriptions,
    initialSubscriptions,
    fetchSubscriptions,
  );
  const [todos, setTodos] = useEntityStore(qk.todos, initialTodos, fetchTodos);
  const [streaks, setStreaks] = useEntityStore(
    qk.streaks,
    initialStreaks,
    fetchStreaks,
  );
  const [streakLogs, setStreakLogs] = useEntityStore(
    qk.streakLogs,
    initialStreakLogs,
    fetchStreakLogs,
  );
  const [accounts, setAccounts] = useEntityStore(
    qk.accounts,
    initialAccounts,
    fetchAccounts,
  );
  const [transactions, setTransactions] = useEntityStore(
    qk.transactions,
    initialTransactions,
    fetchTransactions,
  );
  const [plans, setPlans] = useEntityStore(qk.plans, initialPlans, fetchPlans);
  const [books, setBooks] = useEntityStore(qk.books, initialBooks, fetchBooks);
  const [bookPages, setBookPages] = useEntityStore(
    qk.bookPages,
    initialBookPages,
    fetchBookPages,
  );
  const [notes, setNotes] = useEntityStore(qk.notes, initialNotes, fetchNotes);
  const [prompts, setPrompts] = useEntityStore(
    qk.prompts,
    initialPrompts,
    fetchPrompts,
  );
  const [repoNotes, setRepoNotes] = useEntityStore(
    qk.repoNotes,
    initialRepoNotes,
    fetchRepoNotes,
  );
  const [repoLinks, setRepoLinks] = useEntityStore(
    qk.repoLinks,
    initialRepoLinks,
    fetchRepoLinks,
  );
  const [aiLinks, setAiLinks] = useEntityStore(
    qk.aiLinks,
    initialAiLinks,
    fetchAiLinks,
  );
  const [aiCategories, setAiCategories] = useEntityStore(
    qk.aiCategories,
    initialAiCategories,
    fetchAiCategories,
  );
  const [shortcuts, setShortcuts] = useEntityStore(
    qk.shortcuts,
    initialShortcuts,
    fetchShortcuts,
  );
  const [importantDates, setImportantDates] = useEntityStore(
    qk.importantDates,
    initialImportantDates,
    fetchImportantDates,
  );
  const [invoices, setInvoices] = useEntityStore(
    qk.invoices,
    initialInvoices,
    fetchInvoices,
  );
  const [invoiceItems, setInvoiceItems] = useEntityStore(
    qk.invoiceItems,
    initialInvoiceItems,
    fetchInvoiceItems,
  );
  const [invoiceSettings, setInvoiceSettings] =
    useEntityStore<InvoiceSettings | null>(
      qk.invoiceSettings,
      initialInvoiceSettings,
      fetchInvoiceSettings,
    );
  const { currency: displayCurrency, setCurrency: setDisplayCurrency } =
    useDisplayCurrency();
  const [calendarPrefill, setCalendarPrefill] = useState<{
    title: string;
    nonce: number;
  } | null>(null);

  const handleCalendarTitle = useCallback(
    (title: string) => {
      setCalendarPrefill({ title, nonce: Date.now() });
      setTab("calendar");
    },
    [setTab],
  );

  const partnerName = partnerDisplayName(coupleCtx.partnerProfile);
  const partnerTodos = partnerData?.todos ?? [];
  const partnerStreaks = partnerData?.streaks ?? [];
  const partnerStreakLogs = partnerData?.streakLogs ?? [];

  // g+<letter> jumps tabs; n focuses the overview quick-add. Chord times out at 1.5s.
  const lastG = useRef(0);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "g") {
        lastG.current = Date.now();
        return;
      }
      if (Date.now() - lastG.current < 1500 && TAB_CHORDS[e.key]) {
        lastG.current = 0;
        setTab(TAB_CHORDS[e.key]);
        e.preventDefault();
        return;
      }
      if (e.key === "n") {
        setTab("overview");
        e.preventDefault();
        requestAnimationFrame(() => {
          document.getElementById("quick-add-input")?.focus();
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setTab]);

  const incomingInvites = coupleCtx.incomingInvites.length;

  const focusQuickAdd = useCallback(() => {
    document.getElementById("quick-add-input")?.focus();
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
      <ToastProvider>
        <CommandPalette setTab={setTab} onFocusQuickAdd={focusQuickAdd} />
        <MobileFab
          onClick={() => {
            setTab("overview");
            requestAnimationFrame(focusQuickAdd);
          }}
        />
        {coupleCtx.partnerId && (
          <PartnerTicker
            partnerId={coupleCtx.partnerId}
            partnerName={partnerName}
          />
        )}
        <div className="min-h-screen bg-background">
          <Sidebar
            tab={tab}
            setTab={setTab}
            user={{
              name: user.name,
              email: user.email,
              avatar_url: user.avatar_url,
            }}
            incomingInvites={incomingInvites}
          />

          <main
            className={cn(
              "transition-[padding] duration-200 ease-out",
              navCollapsed ? "md:pl-16" : "md:pl-60",
            )}
          >
            <div className="mx-auto max-w-6xl px-4 md:px-8 py-6 md:py-8">
              <MobileNav
                tab={tab}
                setTab={setTab}
                incomingInvites={incomingInvites}
              />

              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                >
                  {tab === "overview" && (
                    <CustomizableOverview
                      nodes={
                        {
                          "today-hero": (
                            <TodayHero
                              userName={user.name}
                              userEmail={user.email}
                              calendar={todayCalendar}
                              todos={todos}
                              streaks={streaks}
                              streakLogs={streakLogs}
                              importantDates={importantDates}
                            />
                          ),
                          "quick-add": (
                            <QuickAdd
                              setTodos={setTodos}
                              streaks={streaks}
                              streakLogs={streakLogs}
                              setStreakLogs={setStreakLogs}
                              onCalendarTitle={handleCalendarTitle}
                            />
                          ),
                          kpi: (
                            <KpiCards
                              subscriptions={subscriptions}
                              todos={todos}
                              streaks={streaks}
                              streakLogs={streakLogs}
                              displayCurrency={displayCurrency}
                            />
                          ),
                          todos: (
                            <TodosPanel
                              todos={todos}
                              compact
                              partnerTodos={partnerTodos}
                              partnerName={partnerName}
                            />
                          ),
                          streaks: (
                            <StreaksPanel
                              streaks={streaks}
                              setStreaks={setStreaks}
                              logs={streakLogs}
                              setLogs={setStreakLogs}
                              compact
                              partnerStreaks={partnerStreaks}
                              partnerLogs={partnerStreakLogs}
                              partnerName={partnerName}
                            />
                          ),
                          subscriptions: (
                            <SubscriptionsPanel
                              subs={subscriptions}
                              setSubs={setSubscriptions}
                              displayCurrency={displayCurrency}
                              compact
                            />
                          ),
                          calendar: <CalendarPanel compact />,
                        } satisfies Record<WidgetId, React.ReactNode>
                      }
                    />
                  )}

                  {tab === "calendar" && (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <CalendarPanel
                        key={calendarPrefill?.nonce ?? "idle"}
                        initialTitle={calendarPrefill?.title}
                      />
                      <WeekView
                        calendar={weekCalendar}
                        selectedCalendarIds={selectedCalendarIds}
                      />
                    </div>
                  )}

                  {tab === "subscriptions" && (
                    <SubscriptionsPanel
                      subs={subscriptions}
                      setSubs={setSubscriptions}
                      displayCurrency={displayCurrency}
                      setDisplayCurrency={setDisplayCurrency}
                    />
                  )}

                  {tab === "todos" && (
                    <TodosPanel
                      todos={todos}
                      partnerTodos={partnerTodos}
                      partnerName={partnerName}
                    />
                  )}

                  {tab === "streaks" && (
                    <StreaksPanel
                      streaks={streaks}
                      setStreaks={setStreaks}
                      logs={streakLogs}
                      setLogs={setStreakLogs}
                      partnerStreaks={partnerStreaks}
                      partnerLogs={partnerStreakLogs}
                      partnerName={partnerName}
                    />
                  )}

                  {tab === "finances" && (
                    <FinancesPanel
                      accounts={accounts}
                      setAccounts={setAccounts}
                      transactions={transactions}
                      setTransactions={setTransactions}
                      subscriptions={subscriptions}
                      displayCurrency={displayCurrency}
                    />
                  )}

                  {tab === "invoices" && (
                    <InvoicesPanel
                      invoices={invoices}
                      setInvoices={setInvoices}
                      items={invoiceItems}
                      setItems={setInvoiceItems}
                      settings={invoiceSettings}
                      setSettings={setInvoiceSettings}
                      userId={user.id}
                      displayCurrency={displayCurrency}
                    />
                  )}

                  {tab === "plans" && (
                    <PlansPanel plans={plans} setPlans={setPlans} />
                  )}

                  {tab === "couple" && (
                    <CouplePanel
                      ctx={coupleCtx}
                      userId={user.id}
                      userEmail={user.email}
                    />
                  )}

                  {tab === "books" && (
                    <BooksPanel
                      books={books}
                      setBooks={setBooks}
                      pages={bookPages}
                      setPages={setBookPages}
                      userId={user.id}
                      userName={user.name ?? user.email.split("@")[0]}
                      ctx={coupleCtx}
                    />
                  )}

                  {tab === "notes" && (
                    <NotesPanel notes={notes} setNotes={setNotes} />
                  )}

                  {tab === "prompts" && (
                    <PromptsPanel prompts={prompts} setPrompts={setPrompts} />
                  )}

                  {tab === "shortcuts" && (
                    <ShortcutsPanel
                      shortcuts={shortcuts}
                      setShortcuts={setShortcuts}
                    />
                  )}

                  {tab === "dates" && (
                    <ImportantDatesPanel
                      dates={importantDates}
                      setDates={setImportantDates}
                      userId={user.id}
                      ctx={coupleCtx}
                    />
                  )}

                  {tab === "github" && (
                    <ReposPanel
                      initialVisibleIds={repoVisibleIds}
                      repoNotes={repoNotes}
                      setRepoNotes={setRepoNotes}
                      repoLinks={repoLinks}
                      setRepoLinks={setRepoLinks}
                    />
                  )}

                  {tab === "ai" && (
                    <AiPanel
                      aiLinks={aiLinks}
                      setAiLinks={setAiLinks}
                      aiCategories={aiCategories}
                      setAiCategories={setAiCategories}
                    />
                  )}

                  {tab === "settings" && <SettingsPanel />}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </ToastProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
