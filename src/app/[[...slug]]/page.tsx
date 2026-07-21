import { notFound, redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { fetchTodayWindowEvents, fetchUpcomingWeekEvents } from "@/lib/calendar-server";
import { isDashboardSlug, isLegacyRouteSegment, tabFromSlug, tabToPath } from "@/lib/nav-tabs";
import { createClient } from "@/lib/supabase/server";
import { loadUserPreferences } from "@/lib/user-prefs";

export default async function DashboardPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  if (!isDashboardSlug(slug)) notFound();
  const initialTab = tabFromSlug(slug);
  if (slug?.[0] && isLegacyRouteSegment(slug[0])) redirect(tabToPath(initialTab));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    subscriptionsRes, todosRes, accountsRes, transactionsRes, plansRes,
    notesRes, promptsRes, repoNotesRes, repoLinksRes, aiLinksRes, aiCategoriesRes, shortcutsRes,
    referenceRowsRes, importantDatesRes, invoicesRes, invoiceItemsRes,
    invoiceSettingsRes, projectsRes, projectCostsRes, cronsRes,
    organizationsRes, opportunitiesRes, inboxItemsRes, notificationsRes, weeklyReviewsRes,
    jobListingsRes, jobUserStatesRes, jobApplicationsRes,
    jobApplicationEventsRes, coverLetterTemplatesRes, jobLastRunRes,
    todayCalendar, weekCalendar, prefs,
  ] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("todos").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("accounts").select("*").eq("user_id", user.id).order("created_at", { ascending: true }),
    supabase.from("transactions").select("*").eq("user_id", user.id).order("occurred_on", { ascending: false }).limit(500),
    supabase.from("plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("notes").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
    supabase.from("prompts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("repo_notes").select("*").eq("user_id", user.id).order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("repo_links").select("*").eq("user_id", user.id),
    supabase.from("ai_links").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("ai_categories").select("*").eq("user_id", user.id).order("sort_order", { ascending: true }),
    supabase.from("shortcuts").select("*").eq("user_id", user.id).order("sort_order", { ascending: true }),
    supabase.from("reference_rows").select("*").eq("user_id", user.id).order("sort_order", { ascending: true }),
    supabase.from("important_dates").select("*").eq("user_id", user.id).order("the_date", { ascending: true }),
    supabase.from("invoices").select("*").eq("user_id", user.id).order("issue_date", { ascending: false }),
    supabase.from("invoice_items").select("*").eq("user_id", user.id).limit(2000),
    supabase.from("invoice_settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", user.id).order("sort_order", { ascending: true }),
    supabase.from("project_costs").select("*").eq("user_id", user.id).order("sort_order", { ascending: true }),
    supabase.from("crons").select("*").eq("user_id", user.id).order("created_at", { ascending: true }),
    supabase.from("organizations").select("*").eq("user_id", user.id).order("name", { ascending: true }),
    supabase.from("client_opportunities").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
    supabase.from("inbox_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(250),
    supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("weekly_reviews").select("*").eq("user_id", user.id).order("week_start", { ascending: false }).limit(12),
    supabase.from("job_listings").select("*").order("first_seen_at", { ascending: false }).limit(500),
    supabase.from("job_user_state").select("*").eq("user_id", user.id),
    supabase.from("job_applications").select("*").eq("user_id", user.id).order("applied_on", { ascending: false }),
    supabase.from("job_application_events").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1000),
    supabase.from("cover_letter_templates").select("*").eq("user_id", user.id).order("created_at", { ascending: true }),
    supabase.from("job_scrape_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    fetchTodayWindowEvents(),
    fetchUpcomingWeekEvents(),
    loadUserPreferences(user.id),
  ]);

  const requestedProject = slug?.[0] === "projects" && slug[1]
    ? (projectsRes.data ?? []).find((project) => project.id === slug[1] || project.slug === slug[1])
    : null;
  if (slug?.[0] === "projects" && slug[1] && !requestedProject) notFound();

  return <DashboardShell
    initialTab={initialTab}
    initialProjectId={requestedProject?.id}
    user={{ id: user.id, email: user.email ?? "", name: (user.user_metadata?.full_name as string | undefined) ?? null, avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null }}
    initialSubscriptions={subscriptionsRes.data ?? []}
    initialTodos={todosRes.data ?? []}
    initialAccounts={accountsRes.data ?? []}
    initialTransactions={transactionsRes.data ?? []}
    initialPlans={plansRes.data ?? []}
    initialNotes={notesRes.data ?? []}
    initialPrompts={promptsRes.data ?? []}
    initialRepoNotes={repoNotesRes.data ?? []}
    initialRepoLinks={repoLinksRes.data ?? []}
    initialAiLinks={aiLinksRes.data ?? []}
    initialAiCategories={aiCategoriesRes.data ?? []}
    initialShortcuts={shortcutsRes.data ?? []}
    initialReferenceRows={referenceRowsRes.data ?? []}
    initialImportantDates={importantDatesRes.data ?? []}
    initialInvoices={invoicesRes.data ?? []}
    initialInvoiceItems={invoiceItemsRes.data ?? []}
    initialInvoiceSettings={invoiceSettingsRes.data ?? null}
    initialProjects={projectsRes.data ?? []}
    initialProjectCosts={projectCostsRes.data ?? []}
    initialCrons={cronsRes.data ?? []}
    initialOrganizations={organizationsRes.data ?? []}
    initialOpportunities={opportunitiesRes.data ?? []}
    initialInboxItems={inboxItemsRes.data ?? []}
    initialNotifications={notificationsRes.data ?? []}
    initialWeeklyReviews={weeklyReviewsRes.data ?? []}
    initialJobListings={jobListingsRes.data ?? []}
    initialJobUserStates={jobUserStatesRes.data ?? []}
    initialJobApplications={jobApplicationsRes.data ?? []}
    initialJobApplicationEvents={jobApplicationEventsRes.data ?? []}
    initialCoverLetterTemplates={coverLetterTemplatesRes.data ?? []}
    initialJobLastRun={jobLastRunRes.data ?? null}
    todayCalendar={todayCalendar}
    weekCalendar={weekCalendar}
    selectedCalendarIds={prefs.selected_calendar_ids}
    repoVisibleIds={prefs.visible_repo_ids}
  />;
}
