import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  fetchTodayWindowEvents,
  fetchUpcomingWeekEvents,
} from "@/lib/calendar-server";
import { loadCoupleContext, loadPartnerSharedData } from "@/lib/couple";
import { loadUserPreferences } from "@/lib/user-prefs";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Keep the profile row in sync so the partner can read our display name.
  // Upsert is idempotent and cheap.
  await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email,
    display_name:
      (user.user_metadata?.full_name as string | undefined) ?? null,
    avatar_url:
      (user.user_metadata?.avatar_url as string | undefined) ?? null,
    updated_at: new Date().toISOString(),
  });

  const [
    subsRes,
    todosRes,
    streaksRes,
    logsRes,
    accountsRes,
    transactionsRes,
    plansRes,
    todayCalendar,
    weekCalendar,
    coupleCtx,
  ] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("todos")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("streaks")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase.from("streak_logs").select("*").eq("user_id", user.id),
    supabase
      .from("accounts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("occurred_on", { ascending: false })
      .limit(500),
    supabase
      .from("plans")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    fetchTodayWindowEvents(),
    fetchUpcomingWeekEvents(),
    loadCoupleContext(supabase, user.id, user.email ?? null),
  ]);

  // Books are loaded after couple context so RLS lets shared books through.
  // RLS scopes returned rows to "own", "couple member", or "books-shared by partner".
  const [
    booksRes,
    bookPagesRes,
    importantDatesRes,
    notesRes,
    invoicesRes,
    invoiceItemsRes,
    invoiceSettingsRes,
  ] = await Promise.all([
    supabase
      .from("books")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("book_pages")
      .select("*")
      .order("log_date", { ascending: false })
      .limit(1000),
    supabase
      .from("important_dates")
      .select("*")
      .order("the_date", { ascending: true }),
    supabase
      .from("notes")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .order("issue_date", { ascending: false })
      .order("number", { ascending: false }),
    supabase
      .from("invoice_items")
      .select("*")
      .eq("user_id", user.id)
      .limit(2000),
    supabase
      .from("invoice_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const partnerData = coupleCtx.partnerId
    ? await loadPartnerSharedData(
        supabase,
        coupleCtx.partnerId,
        coupleCtx.partnerPrefs,
      )
    : null;

  const prefs = await loadUserPreferences(user.id);

  return (
    <DashboardShell
      user={{
        id: user.id,
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
      initialPlans={plansRes.data ?? []}
      initialBooks={booksRes.data ?? []}
      initialBookPages={bookPagesRes.data ?? []}
      initialNotes={notesRes.data ?? []}
      initialImportantDates={importantDatesRes.data ?? []}
      initialInvoices={invoicesRes.data ?? []}
      initialInvoiceItems={invoiceItemsRes.data ?? []}
      initialInvoiceSettings={invoiceSettingsRes.data ?? null}
      todayCalendar={todayCalendar}
      weekCalendar={weekCalendar}
      coupleCtx={coupleCtx}
      partnerData={partnerData}
      selectedCalendarIds={prefs.selected_calendar_ids}
    />
  );
}
