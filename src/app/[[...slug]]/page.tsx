import { notFound, redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { fetchTodayWindowEvents, fetchUpcomingWeekEvents } from "@/lib/calendar-server";
import { dashboardDataKeysForTab, type DashboardDataKey } from "@/lib/dashboard-data";
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

  const requiredData = dashboardDataKeysForTab(initialTab);
  async function loadWhen<T>(key: DashboardDataKey, load: () => PromiseLike<T>): Promise<T | null> {
    return requiredData.has(key) ? await load() : null;
  }

  const [
    subscriptionsRes, todosRes, accountsRes, transactionsRes, plansRes,
    notesRes, promptsRes, repoNotesRes, repoLinksRes, aiLinksRes, aiCategoriesRes, shortcutsRes,
    referenceRowsRes, importantDatesRes, invoicesRes, invoiceItemsRes,
    invoiceSettingsRes, projectsRes, projectCommunicationsRes, agentTasksRes, projectCostsRes, cronsRes,
    organizationsRes, opportunitiesRes, inboxItemsRes, notificationsRes, weeklyReviewsRes,
    jobListingsRes, jobUserStatesRes, jobApplicationsRes,
    jobApplicationEventsRes, coverLetterTemplatesRes, jobLastRunRes,
    todayCalendar, weekCalendar, prefs, navigationProjectsRes,
  ] = await Promise.all([
    loadWhen("subscriptions", () => supabase.from("subscriptions").select("*").eq("user_id", user.id).order("created_at", { ascending: false })),
    loadWhen("todos", () => supabase.from("todos").select("*").eq("user_id", user.id).order("created_at", { ascending: false })),
    loadWhen("accounts", () => supabase.from("accounts").select("*").eq("user_id", user.id).order("created_at", { ascending: true })),
    loadWhen("transactions", () => supabase.from("transactions").select("*").eq("user_id", user.id).order("occurred_on", { ascending: false }).limit(500)),
    loadWhen("plans", () => supabase.from("plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false })),
    loadWhen("notes", () => supabase.from("notes").select("*").eq("user_id", user.id).order("updated_at", { ascending: false })),
    loadWhen("prompts", () => supabase.from("prompts").select("*").eq("user_id", user.id).order("created_at", { ascending: false })),
    loadWhen("repoNotes", () => supabase.from("repo_notes").select("*").eq("user_id", user.id).order("sort_order", { ascending: true }).order("created_at", { ascending: true })),
    loadWhen("repoLinks", () => supabase.from("repo_links").select("*").eq("user_id", user.id)),
    loadWhen("aiLinks", () => supabase.from("ai_links").select("*").eq("user_id", user.id).order("created_at", { ascending: false })),
    loadWhen("aiCategories", () => supabase.from("ai_categories").select("*").eq("user_id", user.id).order("sort_order", { ascending: true })),
    loadWhen("shortcuts", () => supabase.from("shortcuts").select("*").eq("user_id", user.id).order("sort_order", { ascending: true })),
    loadWhen("referenceRows", () => supabase.from("reference_rows").select("*").eq("user_id", user.id).order("sort_order", { ascending: true })),
    loadWhen("importantDates", () => supabase.from("important_dates").select("*").eq("user_id", user.id).order("the_date", { ascending: true })),
    loadWhen("invoices", () => supabase.from("invoices").select("*").eq("user_id", user.id).order("issue_date", { ascending: false })),
    loadWhen("invoiceItems", () => supabase.from("invoice_items").select("*").eq("user_id", user.id).limit(2000)),
    loadWhen("invoiceSettings", () => supabase.from("invoice_settings").select("*").eq("user_id", user.id).maybeSingle()),
    loadWhen("projects", () => supabase.from("projects").select("*").eq("user_id", user.id).order("sort_order", { ascending: true })),
    loadWhen("projectCommunications", () => supabase.from("project_communications").select("*").eq("user_id", user.id).order("occurred_at", { ascending: false }).limit(500)),
    loadWhen("agentTasks", () => supabase.from("agent_tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(250)),
    loadWhen("projectCosts", () => supabase.from("project_costs").select("*").eq("user_id", user.id).order("sort_order", { ascending: true })),
    loadWhen("crons", () => supabase.from("crons").select("*").eq("user_id", user.id).order("created_at", { ascending: true })),
    loadWhen("organizations", () => supabase.from("organizations").select("*").eq("user_id", user.id).order("name", { ascending: true })),
    loadWhen("opportunities", () => supabase.from("client_opportunities").select("*").eq("user_id", user.id).order("updated_at", { ascending: false })),
    loadWhen("inboxItems", () => supabase.from("inbox_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(250)),
    loadWhen("notifications", () => supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100)),
    loadWhen("weeklyReviews", () => supabase.from("weekly_reviews").select("*").eq("user_id", user.id).order("week_start", { ascending: false }).limit(12)),
    loadWhen("jobListings", () => supabase.from("job_listings").select("*").order("first_seen_at", { ascending: false }).limit(500)),
    loadWhen("jobUserStates", () => supabase.from("job_user_state").select("*").eq("user_id", user.id)),
    loadWhen("jobApplications", () => supabase.from("job_applications").select("*").eq("user_id", user.id).order("applied_on", { ascending: false })),
    loadWhen("jobApplicationEvents", () => supabase.from("job_application_events").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1000)),
    loadWhen("coverLetterTemplates", () => supabase.from("cover_letter_templates").select("*").eq("user_id", user.id).order("created_at", { ascending: true })),
    loadWhen("jobLastRun", () => supabase.from("job_scrape_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle()),
    loadWhen("todayCalendar", fetchTodayWindowEvents),
    loadWhen("weekCalendar", fetchUpcomingWeekEvents),
    loadUserPreferences(user.id),
    supabase
      .from("projects")
      .select("id, name, slug, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(50),
  ]);

  const requestedProject = slug?.[0] === "projects" && slug[1]
    ? (projectsRes?.data ?? []).find((project) => project.id === slug[1] || project.slug === slug[1])
    : null;
  if (slug?.[0] === "projects" && slug[1] && !requestedProject) notFound();

  return <DashboardShell
    initialTab={initialTab}
    initialProjectId={requestedProject?.id}
    initialDataKeys={[...requiredData]}
    user={{ id: user.id, email: user.email ?? "", name: (user.user_metadata?.full_name as string | undefined) ?? null, avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null }}
    initialSubscriptions={subscriptionsRes?.data ?? []}
    initialTodos={todosRes?.data ?? []}
    initialAccounts={accountsRes?.data ?? []}
    initialTransactions={transactionsRes?.data ?? []}
    initialPlans={plansRes?.data ?? []}
    initialNotes={notesRes?.data ?? []}
    initialPrompts={promptsRes?.data ?? []}
    initialRepoNotes={repoNotesRes?.data ?? []}
    initialRepoLinks={repoLinksRes?.data ?? []}
    initialAiLinks={aiLinksRes?.data ?? []}
    initialAiCategories={aiCategoriesRes?.data ?? []}
    initialShortcuts={shortcutsRes?.data ?? []}
    initialReferenceRows={referenceRowsRes?.data ?? []}
    initialImportantDates={importantDatesRes?.data ?? []}
    initialInvoices={invoicesRes?.data ?? []}
    initialInvoiceItems={invoiceItemsRes?.data ?? []}
    initialInvoiceSettings={invoiceSettingsRes?.data ?? null}
    initialProjects={projectsRes?.data ?? []}
    initialNavigationProjects={navigationProjectsRes.data ?? []}
    initialProjectCommunications={projectCommunicationsRes?.data ?? []}
    initialAgentTasks={agentTasksRes?.data ?? []}
    initialProjectCosts={projectCostsRes?.data ?? []}
    initialCrons={cronsRes?.data ?? []}
    initialOrganizations={organizationsRes?.data ?? []}
    initialOpportunities={opportunitiesRes?.data ?? []}
    initialInboxItems={inboxItemsRes?.data ?? []}
    initialNotifications={notificationsRes?.data ?? []}
    initialWeeklyReviews={weeklyReviewsRes?.data ?? []}
    initialJobListings={jobListingsRes?.data ?? []}
    initialJobUserStates={jobUserStatesRes?.data ?? []}
    initialJobApplications={jobApplicationsRes?.data ?? []}
    initialJobApplicationEvents={jobApplicationEventsRes?.data ?? []}
    initialCoverLetterTemplates={coverLetterTemplatesRes?.data ?? []}
    initialJobLastRun={jobLastRunRes?.data ?? null}
    todayCalendar={todayCalendar ?? { ok: true, events: [] }}
    weekCalendar={weekCalendar ?? { ok: true, events: [] }}
    selectedCalendarIds={prefs.selected_calendar_ids}
    repoVisibleIds={prefs.visible_repo_ids}
    initialPreferences={{
      language: prefs.language,
      theme: prefs.theme,
      display_currency: prefs.display_currency,
      hidden_navigation: prefs.hidden_navigation,
      navigation_order: prefs.navigation_order,
      navigation_collapsed: prefs.navigation_collapsed,
      dashboard_layout: prefs.dashboard_layout,
      tasks_per_category: prefs.tasks_per_category,
      cv_url_cs: prefs.cv_url_cs,
      cv_url_en: prefs.cv_url_en,
      hidden_project_tabs: prefs.hidden_project_tabs,
      sync_available: prefs.sync_available,
    }}
  />;
}
