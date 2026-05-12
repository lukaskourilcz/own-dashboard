import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  fetchTodayWindowEvents,
  fetchUpcomingWeekEvents,
} from "@/lib/calendar";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    subsRes,
    todosRes,
    streaksRes,
    logsRes,
    accountsRes,
    transactionsRes,
    todayCalendar,
    weekCalendar,
  ] = await Promise.all([
    supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
    supabase.from("todos").select("*").order("created_at", { ascending: false }),
    supabase.from("streaks").select("*").order("created_at", { ascending: true }),
    supabase.from("streak_logs").select("*"),
    supabase.from("accounts").select("*").order("created_at", { ascending: true }),
    supabase
      .from("transactions")
      .select("*")
      .order("occurred_on", { ascending: false })
      .limit(500),
    fetchTodayWindowEvents(),
    fetchUpcomingWeekEvents(),
  ]);

  return (
    <DashboardShell
      user={{
        email: user.email ?? "",
        name: (user.user_metadata?.full_name as string | undefined) ?? null,
        avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
      }}
      initialSubscriptions={subsRes.data ?? []}
      initialTodos={todosRes.data ?? []}
      initialStreaks={streaksRes.data ?? []}
      initialStreakLogs={logsRes.data ?? []}
      initialAccounts={accountsRes.data ?? []}
      initialTransactions={transactionsRes.data ?? []}
      todayCalendar={todayCalendar}
      weekCalendar={weekCalendar}
    />
  );
}
