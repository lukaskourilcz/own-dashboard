"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CalendarPlus,
  CreditCard,
  Flame,
  Heart,
  ListTodo,
  LayoutDashboard,
  LogOut,
  Target,
  Wallet,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarPanel } from "@/components/panels/calendar-panel";
import { SubscriptionsPanel } from "@/components/panels/subscriptions-panel";
import { TodosPanel } from "@/components/panels/todos-panel";
import { StreaksPanel } from "@/components/panels/streaks-panel";
import { FinancesPanel } from "@/components/panels/finances-panel";
import { PlansPanel } from "@/components/panels/plans-panel";
import { CouplePanel } from "@/components/panels/couple-panel";
import { BooksPanel } from "@/components/panels/books-panel";
import { KpiCards } from "@/components/overview/kpi-cards";
import { QuickAdd } from "@/components/overview/quick-add";
import { TodayHero } from "@/components/overview/today-hero";
import { WeekView } from "@/components/calendar/week-view";
import { ThemeToggle } from "@/components/theme-toggle";
import { ToastProvider } from "@/components/ui/toast";
import type {
  Account,
  Book,
  BookPage,
  Plan,
  Streak,
  StreakLog,
  Subscription,
  Todo,
  Transaction,
} from "@/lib/types";
import type { EventsResult } from "@/lib/calendar";
import type { CoupleContext, PartnerData } from "@/lib/couple";

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
  todayCalendar: EventsResult;
  weekCalendar: EventsResult;
  coupleCtx: CoupleContext;
  partnerData: PartnerData | null;
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
  todayCalendar,
  weekCalendar,
  coupleCtx,
  partnerData,
}: Props) {
  const [tab, setTab] = useState("overview");
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
  const [displayCurrency, setDisplayCurrency] = useState<string>("USD");
  const [calendarPrefill, setCalendarPrefill] = useState<{
    title: string;
    nonce: number;
  } | null>(null);

  const handleCalendarTitle = useCallback((title: string) => {
    setCalendarPrefill({ title, nonce: Date.now() });
    setTab("calendar");
  }, []);

  // g+<letter> jumps tabs (gmail/vim-style); n focuses the overview quick-add.
  // The chord times out after 1.5s.
  const lastG = useRef(0);
  useEffect(() => {
    const TAB_FOR: Record<string, string> = {
      o: "overview",
      c: "calendar",
      s: "streaks",
      t: "todos",
      f: "finances",
      p: "plans",
      u: "couple",
      b: "books",
    };
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
      if (Date.now() - lastG.current < 1500 && TAB_FOR[e.key]) {
        lastG.current = 0;
        setTab(TAB_FOR[e.key]);
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

  return (
    <ToastProvider>
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 flex items-center justify-center">
              <LayoutDashboard className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold leading-none">Own Dashboard</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {user.name ?? user.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">
              <LayoutDashboard className="h-4 w-4 mr-1.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="calendar">
              <CalendarPlus className="h-4 w-4 mr-1.5" />
              Calendar
            </TabsTrigger>
            <TabsTrigger value="subscriptions">
              <CreditCard className="h-4 w-4 mr-1.5" />
              Subscriptions
            </TabsTrigger>
            <TabsTrigger value="todos">
              <ListTodo className="h-4 w-4 mr-1.5" />
              Todos
            </TabsTrigger>
            <TabsTrigger value="streaks">
              <Flame className="h-4 w-4 mr-1.5" />
              Streaks
            </TabsTrigger>
            <TabsTrigger value="finances">
              <Wallet className="h-4 w-4 mr-1.5" />
              Finances
            </TabsTrigger>
            <TabsTrigger value="plans">
              <Target className="h-4 w-4 mr-1.5" />
              Plans
            </TabsTrigger>
            <TabsTrigger value="couple">
              <Heart className="h-4 w-4 mr-1.5" />
              {coupleCtx.couple
                ? "Couple"
                : coupleCtx.incomingInvites.length > 0
                  ? `Couple (${coupleCtx.incomingInvites.length})`
                  : "Couple"}
            </TabsTrigger>
            <TabsTrigger value="books">
              <BookOpen className="h-4 w-4 mr-1.5" />
              Books
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="space-y-4">
              <QuickAdd
                setTodos={setTodos}
                streaks={streaks}
                streakLogs={streakLogs}
                setStreakLogs={setStreakLogs}
                onCalendarTitle={handleCalendarTitle}
              />
              <TodayHero
                userName={user.name}
                userEmail={user.email}
                calendar={todayCalendar}
                todos={todos}
                streaks={streaks}
                streakLogs={streakLogs}
              />
              <KpiCards
                subscriptions={subscriptions}
                todos={todos}
                streaks={streaks}
                streakLogs={streakLogs}
                displayCurrency={displayCurrency}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <SubscriptionsPanel
                  subs={subscriptions}
                  setSubs={setSubscriptions}
                  displayCurrency={displayCurrency}
                  compact
                />
                <TodosPanel todos={todos} setTodos={setTodos} compact />
                <StreaksPanel
                  streaks={streaks}
                  setStreaks={setStreaks}
                  logs={streakLogs}
                  setLogs={setStreakLogs}
                  compact
                />
                <CalendarPanel compact />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="calendar">
            <div className="grid gap-4 md:grid-cols-2">
              <CalendarPanel
                key={calendarPrefill?.nonce ?? "idle"}
                initialTitle={calendarPrefill?.title}
              />
              <WeekView calendar={weekCalendar} />
            </div>
          </TabsContent>
          <TabsContent value="subscriptions">
            <SubscriptionsPanel
              subs={subscriptions}
              setSubs={setSubscriptions}
              displayCurrency={displayCurrency}
              setDisplayCurrency={setDisplayCurrency}
            />
          </TabsContent>
          <TabsContent value="todos">
            <TodosPanel todos={todos} setTodos={setTodos} />
          </TabsContent>
          <TabsContent value="streaks">
            <StreaksPanel
              streaks={streaks}
              setStreaks={setStreaks}
              logs={streakLogs}
              setLogs={setStreakLogs}
            />
          </TabsContent>
          <TabsContent value="finances">
            <FinancesPanel
              accounts={accounts}
              setAccounts={setAccounts}
              transactions={transactions}
              setTransactions={setTransactions}
              subscriptions={subscriptions}
              displayCurrency={displayCurrency}
            />
          </TabsContent>
          <TabsContent value="plans">
            <PlansPanel plans={plans} setPlans={setPlans} />
          </TabsContent>
          <TabsContent value="couple">
            <CouplePanel
              ctx={coupleCtx}
              userId={user.id}
              userEmail={user.email}
            />
          </TabsContent>
          <TabsContent value="books">
            <BooksPanel
              books={books}
              setBooks={setBooks}
              pages={bookPages}
              setPages={setBookPages}
              userId={user.id}
              userName={user.name ?? user.email.split("@")[0]}
              ctx={coupleCtx}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
    </ToastProvider>
  );
}
