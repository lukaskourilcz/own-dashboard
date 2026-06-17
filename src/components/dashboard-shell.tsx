"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import { ImportantDatesPanel } from "@/components/panels/important-dates-panel";
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
import { CommandPalette } from "@/components/command-palette";
import { MobileFab } from "@/components/mobile-fab";
import { PartnerTicker } from "@/components/realtime/partner-ticker";
import { useDisplayCurrency, useNavCollapsed } from "@/lib/use-prefs";
import { cn } from "@/lib/utils";
import type {
  Account,
  Book,
  BookPage,
  ImportantDate,
  Invoice,
  InvoiceItem,
  InvoiceSettings,
  Note,
  Plan,
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
  initialImportantDates: ImportantDate[];
  initialInvoices: Invoice[];
  initialInvoiceItems: InvoiceItem[];
  initialInvoiceSettings: InvoiceSettings | null;
  todayCalendar: EventsResult;
  weekCalendar: EventsResult;
  coupleCtx: CoupleContext;
  partnerData: PartnerData | null;
  selectedCalendarIds: string[];
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
  d: "dates",
};

export function DashboardShell({
  user,
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
  initialImportantDates,
  initialInvoices,
  initialInvoiceItems,
  initialInvoiceSettings,
  todayCalendar,
  weekCalendar,
  coupleCtx,
  partnerData,
  selectedCalendarIds,
}: Props) {
  const [tab, setTab] = useState<NavTab>("overview");
  const { collapsed: navCollapsed } = useNavCollapsed();
  const [subscriptions, setSubscriptions] =
    useState<Subscription[]>(initialSubscriptions);
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [streaks, setStreaks] = useState<Streak[]>(initialStreaks);
  const [streakLogs, setStreakLogs] = useState<StreakLog[]>(initialStreakLogs);
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [transactions, setTransactions] =
    useState<Transaction[]>(initialTransactions);
  const [plans, setPlans] = useState<Plan[]>(initialPlans);
  const [books, setBooks] = useState<Book[]>(initialBooks);
  const [bookPages, setBookPages] = useState<BookPage[]>(initialBookPages);
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [importantDates, setImportantDates] =
    useState<ImportantDate[]>(initialImportantDates);
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
  const [invoiceItems, setInvoiceItems] =
    useState<InvoiceItem[]>(initialInvoiceItems);
  const [invoiceSettings, setInvoiceSettings] =
    useState<InvoiceSettings | null>(initialInvoiceSettings);
  const { currency: displayCurrency, setCurrency: setDisplayCurrency } =
    useDisplayCurrency();
  const [calendarPrefill, setCalendarPrefill] = useState<{
    title: string;
    nonce: number;
  } | null>(null);

  const handleCalendarTitle = useCallback((title: string) => {
    setCalendarPrefill({ title, nonce: Date.now() });
    setTab("calendar");
  }, []);

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
  }, []);

  const incomingInvites = coupleCtx.incomingInvites.length;

  const focusQuickAdd = useCallback(() => {
    document.getElementById("quick-add-input")?.focus();
  }, []);

  return (
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
                              setTodos={setTodos}
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
                      setTodos={setTodos}
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

                  {tab === "dates" && (
                    <ImportantDatesPanel
                      dates={importantDates}
                      setDates={setImportantDates}
                      userId={user.id}
                      ctx={coupleCtx}
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
  );
}
