"use client";

import { useCallback, useState } from "react";
import {
  CalendarPlus,
  CreditCard,
  Flame,
  ListTodo,
  LayoutDashboard,
  LogOut,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarPanel } from "@/components/panels/calendar-panel";
import { SubscriptionsPanel } from "@/components/panels/subscriptions-panel";
import { TodosPanel } from "@/components/panels/todos-panel";
import { StreaksPanel } from "@/components/panels/streaks-panel";
import { KpiCards } from "@/components/overview/kpi-cards";
import { QuickAdd } from "@/components/overview/quick-add";
import { TodayHero } from "@/components/overview/today-hero";
import type {
  Streak,
  StreakLog,
  Subscription,
  Todo,
} from "@/lib/types";
import type { TodayEventsResult } from "@/lib/calendar";

type Props = {
  user: { email: string; name: string | null; avatar_url: string | null };
  initialSubscriptions: Subscription[];
  initialTodos: Todo[];
  initialStreaks: Streak[];
  initialStreakLogs: StreakLog[];
  todayCalendar: TodayEventsResult;
};

export function DashboardShell({
  user,
  initialSubscriptions,
  initialTodos,
  initialStreaks,
  initialStreakLogs,
  todayCalendar,
}: Props) {
  const [tab, setTab] = useState("overview");
  const [subscriptions, setSubscriptions] =
    useState<Subscription[]>(initialSubscriptions);
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [streaks, setStreaks] = useState<Streak[]>(initialStreaks);
  const [streakLogs, setStreakLogs] = useState<StreakLog[]>(initialStreakLogs);
  const [calendarPrefill, setCalendarPrefill] = useState<{
    title: string;
    nonce: number;
  } | null>(null);

  const handleCalendarTitle = useCallback((title: string) => {
    setCalendarPrefill({ title, nonce: Date.now() });
    setTab("calendar");
  }, []);

  return (
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
              />
              <div className="grid gap-4 md:grid-cols-2">
                <SubscriptionsPanel
                  subs={subscriptions}
                  setSubs={setSubscriptions}
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
            <CalendarPanel
              key={calendarPrefill?.nonce ?? "idle"}
              initialTitle={calendarPrefill?.title}
            />
          </TabsContent>
          <TabsContent value="subscriptions">
            <SubscriptionsPanel
              subs={subscriptions}
              setSubs={setSubscriptions}
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
        </Tabs>
      </main>
    </div>
  );
}
