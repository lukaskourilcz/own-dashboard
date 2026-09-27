import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DemoDashboard } from "@/components/demo-dashboard";
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
  searchParams: Promise<{ project?: string; tab?: string; calendars?: string; q?: string | string[] }>;
}) {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_E2E !== "1") notFound();
  const { project, tab, calendars, q } = await searchParams;

  // `?tab=` opens a destination directly, the fixture equivalent of visiting
  // its URL — used for sections hidden from navigation (Inbox, References).
  // `?q=` is the IG TIPS deep link, as `/ig-tips?q=` is in the app.
  // `?calendars=live` reads the marketing calendars from the API route (which
  // Playwright stubs) instead of the fixture.
  return (
    <DemoDashboard
      projectRef={project}
      initialTab={isNavTab(tab) ? tab : undefined}
      liveMarketingCalendars={calendars === "live"}
      initialTipQuery={tab === "ig-tips" ? tipDeepLinkQuery(q) : null}
    />
  );
}
