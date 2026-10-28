import { projectTabFromQuery } from "@/lib/project-workspace-tabs";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DemoDashboard } from "@/components/demo-dashboard";
import { GuestBoundary } from "@/components/guest-boundary";
import { tipDeepLinkQuery } from "@/lib/marketing-calendars";
import { isNavTab } from "@/lib/nav-tabs";

/**
 * Dev/E2E-only harness: renders the real DashboardShell with deterministic
 * fixtures so the auth-gated UI can be exercised by Playwright without a live
 * Supabase session. Returns 404 in production so it never ships.
 *
 * The public counterpart is `/guest`, which renders the same fixtures without
 * the environment guard and with a banner. Both share `DemoDashboard`.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; projectTab?: string | string[]; tab?: string; imports?: string; calendars?: string; repositories?: string; projectRecords?: string; music?: string; accounts?: string; planning?: string; planRecords?: string; tasks?: string; categories?: string; monitoring?: string; career?: string; preferences?: string; calendar?: string; organizations?: string; competitors?: string; exports?: string; session?: string; q?: string | string[] }>;
}) {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_E2E !== "1") notFound();
  const { project, projectTab, tab, imports, calendars, repositories, projectRecords, music, accounts, planning, planRecords, tasks, categories, monitoring, career, preferences, calendar, organizations, competitors, exports: dataExports, session, q } = await searchParams;

  // `?tab=` opens a destination directly, the fixture equivalent of visiting
  // its URL — used for sections hidden from navigation (Inbox, References).
  // `?q=` is the IG TIPS deep link, as `/ig-tips?q=` is in the app.
  // `?calendars=live` reads the marketing calendars from the API route (which
  // Playwright stubs) instead of the fixture.
  const preview = (
    <DemoDashboard
      projectRef={project}
      initialProjectTab={projectTabFromQuery(projectTab)}
      initialTab={isNavTab(tab) ? tab : undefined}
      liveMarketingImport={imports === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveMarketingCalendars={calendars === "live"}
      liveRepositories={repositories === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveProjectRecords={projectRecords === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveTasks={tasks === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveCategories={categories === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      livePlanRecords={planRecords === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      livePlanning={planning === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveAccounts={accounts === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveMusic={music === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveCareer={((career === "live") || (career === "records")) && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveCareerRecords={career === "records" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveMonitoring={monitoring === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      livePreferences={preferences === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveOrganizations={organizations === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveCompetitors={competitors === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveSession={session === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveExports={dataExports === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      liveCalendar={calendar === "live" && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"}
      initialTipQuery={tab === "ig-tips" ? tipDeepLinkQuery(q) : null}
    />
  );
  // Mutation tests use a deliberately nonexistent backend. A developer's
  // signed-in real backend must never receive fixture writes or private reads.
  return process.env.NEXT_PUBLIC_SUPABASE_URL === "https://example.supabase.co"
    ? preview
    : <GuestBoundary>{preview}</GuestBoundary>;
}
