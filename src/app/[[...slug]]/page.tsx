import { z } from 'zod';
import { awaitWithSignal, fetchWithSignal } from '@/lib/abortable';
import { parseStoredUiPreferences } from '@/lib/ui-preferences-contract';
import { projectTabFromQuery } from "@/lib/project-workspace-tabs";
import { notFound, redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { DashboardDataUnavailable } from "@/components/dashboard-data-unavailable";
import { fetchTodayWindowEvents, fetchUpcomingWeekEvents } from "@/lib/calendar-server";
import { serverDataKeysForTab, type DashboardDataKey } from "@/lib/dashboard-data";
import { isDashboardSlug, isLegacyRouteSegment, tabFromSlug, tabToPath } from "@/lib/nav-tabs";
import { tipDeepLinkQuery } from "@/lib/marketing-calendars";
import { readCompetitorRecords } from "@/lib/competitor-records";
import { readOrganizationRecords } from "@/lib/organization-records";
import { readOwnedCollection } from "@/lib/owned-records";
import { resolveProjectRef } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import { loadUserPreferences } from "@/lib/user-prefs";

type DashboardPageInput = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ q?: string | string[]; projectTab?: string | string[] }>;
};
export default async function DashboardPage(input: DashboardPageInput) {
  const lifetime = new AbortController();
  const total = AbortSignal.any([lifetime.signal, AbortSignal.timeout(30_000)]);
  try { return await loadDashboardPage(input, total); }
  finally { lifetime.abort(); }
}
async function loadDashboardPage({ params, searchParams }: DashboardPageInput, total: AbortSignal) {
  const route = await awaitWithSignal(params, total).catch(() => null);
  if (!route) return <DashboardDataUnavailable lang="cs" />;
  const { slug } = route;
  if (!isDashboardSlug(slug)) notFound();
  const initialTab = tabFromSlug(slug);
  if (slug?.[0] && isLegacyRouteSegment(slug[0])) redirect(tabToPath(initialTab));

  let phase = AbortSignal.any([total, AbortSignal.timeout(8_000)]);
  const phaseFetch: typeof fetch = (input, init) => fetchWithSignal(phase)(input, init);
  const verified = await (async () => {
    try {
      const db = await awaitWithSignal(createClient(total, phaseFetch), phase);
      const auth = await awaitWithSignal(db.auth.getUser(), phase);
      phase.throwIfAborted(); return { db, auth };
    } catch { return null; }
  })();
  if (!verified) return <DashboardDataUnavailable lang="cs" />;
  const { db: supabase, auth } = verified;
  const user = auth.data.user;
  if (auth.error || !user || !z.uuid().safeParse(user.id).success) redirect("/login");
  phase = AbortSignal.any([total, AbortSignal.timeout(20_000)]);
  const readSignal = phase;

  // Client-only keys (last week's calendar) are neither loaded nor seeded
  // here: the shell fetches them in the browser's timezone.
  const requiredData = serverDataKeysForTab(initialTab);
  const failedReads = new Set<DashboardDataKey>();
  async function loadWhen<T>(key: DashboardDataKey, load: () => PromiseLike<T>): Promise<T | null> {
    if (!requiredData.has(key)) return null;
    try {
      readSignal.throwIfAborted();
      const result = await awaitWithSignal(load(), readSignal);
      if (result && typeof result === "object" && "error" in result && result.error) {
        failedReads.add(key);
        return null;
      }
      return result;
    } catch {
      failedReads.add(key);
      return null;
    }
  }

  const [
    subscriptionsRes, todosRes, accountsRes, transactionsRes, plansRes,
    notesRes, promptsRes, promptLinksRes, repoNotesRes, repoLinksRes, aiLinksRes, aiCategoriesRes, projectLinksRes, toolsRes, shortcutsRes,
    referenceRowsRes, importantDatesRes, invoicesRes, invoiceItemsRes,
    invoiceSettingsRes, projectsRes, projectCommunicationsRes, projectCostsRes, cronsRes,
    subscriptionAllocationsRes, competitorsRes,
    organizationsRes, opportunitiesRes, inboxItemsRes, notificationsRes, weeklyReviewsRes,
    jobListingsRes, jobUserStatesRes, savedJobPositionsRes, jobApplicationsRes,
    jobApplicationEventsRes, coverLetterTemplatesRes, jobLastRunRes,
    todayCalendar, weekCalendar, prefs, navigationProjectsRes,
  ] = await Promise.all([
    loadWhen("subscriptions", () => supabase.from("subscriptions").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("created_at", { ascending: false })),
    loadWhen("todos", () => readOwnedCollection(supabase, "todos", user.id)),
    loadWhen("accounts", () => supabase.from("accounts").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("created_at", { ascending: true })),
    loadWhen("transactions", () => readOwnedCollection(supabase, "transactions", user.id)),
    loadWhen("plans", () => supabase.from("plans").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("created_at", { ascending: false })),
    loadWhen("notes", () => supabase.from("notes").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("updated_at", { ascending: false })),
    loadWhen("prompts", () => readOwnedCollection(supabase, "prompts", user.id)),
    loadWhen("promptLinks", () => readOwnedCollection(supabase, "prompt_links", user.id)),
    loadWhen("repoNotes", () => readOwnedCollection(supabase, "repo_notes", user.id)),
    loadWhen("repoLinks", () => readOwnedCollection(supabase, "repo_links", user.id)),
    loadWhen("aiLinks", () => readOwnedCollection(supabase, "ai_links", user.id)),
    loadWhen("aiCategories", () => readOwnedCollection(supabase, "ai_categories", user.id)),
    loadWhen("projectLinks", () => readOwnedCollection(supabase, "project_links", user.id)),
    loadWhen("tools", () => supabase.from("tools").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("created_at", { ascending: true }).limit(500)),
    loadWhen("shortcuts", () => supabase.from("shortcuts").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("sort_order", { ascending: true })),
    loadWhen("referenceRows", () => supabase.from("reference_rows").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("sort_order", { ascending: true })),
    loadWhen("importantDates", () => supabase.from("important_dates").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("the_date", { ascending: true })),
    loadWhen("invoices", () => readOwnedCollection(supabase, "invoices", user.id)),
    loadWhen("invoiceItems", () => readOwnedCollection(supabase, "invoice_items", user.id)),
    loadWhen("invoiceSettings", () => supabase.from("invoice_settings").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).maybeSingle()),
    loadWhen("projects", () => readOwnedCollection(supabase, "projects", user.id)),
    loadWhen("projectCommunications", () => supabase.from("project_communications").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("occurred_at", { ascending: false }).limit(500)),
    loadWhen("projectCosts", () => readOwnedCollection(supabase, "project_costs", user.id)),
    loadWhen("crons", () => readOwnedCollection(supabase, "crons", user.id)),
    loadWhen("subscriptionAllocations", () => supabase.from("subscription_allocations").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("created_at", { ascending: true })),
    loadWhen("competitors", () => readCompetitorRecords(supabase, { ownerId: user.id, signal: AbortSignal.timeout(15_000) })),
    loadWhen("organizations", () => readOrganizationRecords(supabase, { ownerId: user.id, signal: AbortSignal.timeout(15_000) })),
    loadWhen("opportunities", () => supabase.from("client_opportunities").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("updated_at", { ascending: false }).limit(1000)),
    loadWhen("inboxItems", () => supabase.from("inbox_items").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("created_at", { ascending: false }).limit(250)),
    loadWhen("notifications", () => supabase.from("notifications").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("created_at", { ascending: false }).limit(100)),
    loadWhen("weeklyReviews", () => supabase.from("weekly_reviews").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("week_start", { ascending: false }).limit(12)),
    loadWhen("jobListings", () => supabase.from("job_listings").select("*").retry(false).abortSignal(readSignal).order("first_seen_at", { ascending: false }).limit(500)),
    loadWhen("jobUserStates", () => supabase.from("job_user_state").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id)),
    loadWhen("savedJobPositions", () => supabase.from("saved_job_positions").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("saved_at", { ascending: false })),
    loadWhen("jobApplications", () => supabase.from("job_applications").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("applied_on", { ascending: false })),
    loadWhen("jobApplicationEvents", () => supabase.from("job_application_events").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("created_at", { ascending: false }).limit(1000)),
    loadWhen("coverLetterTemplates", () => supabase.from("cover_letter_templates").select("*").retry(false).abortSignal(readSignal).eq("user_id", user.id).order("created_at", { ascending: true })),
    loadWhen("jobLastRun", () => supabase.from("job_scrape_runs").select("*").retry(false).abortSignal(readSignal).order("started_at", { ascending: false }).limit(1).maybeSingle()),
    loadWhen("todayCalendar", () => fetchTodayWindowEvents({ userId: user.id, signal: readSignal })),
    loadWhen("weekCalendar", () => fetchUpcomingWeekEvents({ userId: user.id, signal: readSignal })),
    awaitWithSignal(loadUserPreferences(user.id, readSignal), readSignal)
      .catch(() => ({ ...parseStoredUiPreferences(null), sync_available: false })),
    // The full project read already supplies the lightweight navigation data.
    requiredData.has("projects") ? null : awaitWithSignal(supabase
      .from("projects")
      .select("id, name, slug, is_active, engagement").retry(false).abortSignal(readSignal)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(50), readSignal).then(result => result, () => ({ data: null, error: true })),
  ]);

  if (failedReads.size > 0 || navigationProjectsRes?.error) {
    return <DashboardDataUnavailable lang={prefs.language} />;
  }

  const requestedRef = slug?.[0] === "projects" && slug[1] ? slug[1] : null;
  const requestedProject = requestedRef
    ? resolveProjectRef(projectsRes?.data ?? [], requestedRef)
    : null;
  if (requestedRef && !requestedProject) notFound();
  // An earlier slug (e.g. /projects/aifirst after the DNESKAi rename) resolves
  // to the project and redirects to its canonical URL.
  if (requestedRef && requestedProject && requestedRef !== requestedProject.id && requestedRef !== requestedProject.slug) {
    redirect(`/projects/${encodeURIComponent(requestedProject.slug)}`);
  }

  // `/ig-tips?q=<title>` (linked from the marketing calendars) opens IG TIPS
  // searching for that tip, with its card expanded.
  const query = await awaitWithSignal(searchParams, total).catch(() => null);
  if (!query) return <DashboardDataUnavailable lang={prefs.language} />;
  const initialTipQuery = initialTab === "ig-tips" ? tipDeepLinkQuery(query.q) : null;

  return <DashboardShell
    initialTab={initialTab}
    initialTimezone={prefs.timezone}
    initialTipQuery={initialTipQuery}
    initialProjectId={requestedProject?.id}
    initialProjectTab={projectTabFromQuery(query.projectTab)}
    initialDataKeys={[...requiredData]}
    user={{ id: user.id, email: user.email ?? "", name: (user.user_metadata?.full_name as string | undefined) ?? null, avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null }}
    initialSubscriptions={subscriptionsRes?.data ?? []}
    initialTodos={todosRes?.data ?? []}
    initialAccounts={accountsRes?.data ?? []}
    initialTransactions={transactionsRes?.data ?? []}
    initialPlans={plansRes?.data ?? []}
    initialNotes={notesRes?.data ?? []}
    initialPrompts={promptsRes?.data ?? []}
    initialPromptLinks={promptLinksRes?.data ?? []}
    initialRepoNotes={repoNotesRes?.data ?? []}
    initialRepoLinks={repoLinksRes?.data ?? []}
    initialAiLinks={aiLinksRes?.data ?? []}
    initialAiCategories={aiCategoriesRes?.data ?? []}
    initialProjectLinks={projectLinksRes?.data ?? []}
    initialTools={toolsRes?.data ?? []}
    initialShortcuts={shortcutsRes?.data ?? []}
    initialReferenceRows={referenceRowsRes?.data ?? []}
    initialImportantDates={importantDatesRes?.data ?? []}
    initialInvoices={invoicesRes?.data ?? []}
    initialInvoiceItems={invoiceItemsRes?.data ?? []}
    initialInvoiceSettings={invoiceSettingsRes?.data ?? null}
    initialProjects={projectsRes?.data ?? []}
    initialNavigationProjects={navigationProjectsRes?.data ?? (projectsRes?.data ?? []).filter(project => project.is_active).slice(0, 50)}
    initialProjectCommunications={projectCommunicationsRes?.data ?? []}
    initialProjectCosts={projectCostsRes?.data ?? []}
    initialCrons={cronsRes?.data ?? []}
    initialSubscriptionAllocations={subscriptionAllocationsRes?.data ?? []}
    initialCompetitors={competitorsRes?.data ?? []}
    initialOrganizations={organizationsRes?.data ?? []}
    initialOpportunities={opportunitiesRes?.data ?? []}
    initialInboxItems={inboxItemsRes?.data ?? []}
    initialNotifications={notificationsRes?.data ?? []}
    initialWeeklyReviews={weeklyReviewsRes?.data ?? []}
    initialJobListings={jobListingsRes?.data ?? []}
    initialJobUserStates={jobUserStatesRes?.data ?? []}
    initialSavedJobPositions={savedJobPositionsRes?.data ?? []}
    initialJobApplications={jobApplicationsRes?.data ?? []}
    initialJobApplicationEvents={jobApplicationEventsRes?.data ?? []}
    initialCoverLetterTemplates={coverLetterTemplatesRes?.data ?? []}
    initialJobLastRun={jobLastRunRes?.data ?? null}
    todayCalendar={todayCalendar ?? { ok: true, events: [] }}
    weekCalendar={weekCalendar ?? { ok: true, events: [] }}
    lastWeekCalendar={{ ok: true, events: [] }}
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
