"use client";

import { useState } from "react";
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
import type {
  Streak,
  StreakLog,
  Subscription,
  Todo,
} from "@/lib/types";

type Props = {
  user: { email: string; name: string | null; avatar_url: string | null };
  initialSubscriptions: Subscription[];
  initialTodos: Todo[];
  initialStreaks: Streak[];
  initialStreakLogs: StreakLog[];
};

export function DashboardShell({
  user,
  initialSubscriptions,
  initialTodos,
  initialStreaks,
  initialStreakLogs,
}: Props) {
  const [tab, setTab] = useState("overview");

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
            <div className="grid gap-4 md:grid-cols-2">
              <SubscriptionsPanel initial={initialSubscriptions} compact />
              <TodosPanel initial={initialTodos} compact />
              <StreaksPanel
                initialStreaks={initialStreaks}
                initialLogs={initialStreakLogs}
                compact
              />
              <CalendarPanel compact />
            </div>
          </TabsContent>
          <TabsContent value="calendar">
            <CalendarPanel />
          </TabsContent>
          <TabsContent value="subscriptions">
            <SubscriptionsPanel initial={initialSubscriptions} />
          </TabsContent>
          <TabsContent value="todos">
            <TodosPanel initial={initialTodos} />
          </TabsContent>
          <TabsContent value="streaks">
            <StreaksPanel
              initialStreaks={initialStreaks}
              initialLogs={initialStreakLogs}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
