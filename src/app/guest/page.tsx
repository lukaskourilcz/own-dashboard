import type { Metadata } from "next";
import { DemoDashboard } from "@/components/demo-dashboard";
import { GuestBanner } from "@/components/guest-banner";
import { GuestLocale } from "@/components/guest-locale";
import type { Lang } from "@/lib/i18n/lang";
import { brandConfig } from "@/lib/brand";

/**
 * Public read-only tour of the dashboard.
 *
 * Renders the real `DashboardShell` against the shared demo fixtures, so a
 * visitor sees the actual product instead of a screenshot, without a Supabase
 * session and without reaching any owner data. The middleware exempts this
 * path from the login redirect.
 *
 * Everything the page shows is invented (see `src/lib/demo/fixtures.ts`).
 * Writes are not wired: `DemoDashboard` passes `isPreview`, and own-only RLS
 * would reject an anonymous write regardless.
 *
 * This is also the surface recorded for the portfolio thumbnail, which is why
 * it must stay logged-out reachable. See
 * `.claude/skills/preview-video/SKILL.md`.
 */
export const metadata: Metadata = {
  title: "Guest tour",
  description: brandConfig.description.en,
  robots: { index: true, follow: true },
};

// `@/lib/i18n/lang` is a client module, so its runtime exports cannot be read
// here. The type import above still keeps this honest if the union changes.
function toLang(value: string | undefined): Lang {
  return value === "en" ? "en" : "cs";
}

export default async function GuestPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; lang?: string }>;
}) {
  const { project, lang } = await searchParams;
  const language = toLang(lang);

  return (
    <>
      <GuestLocale lang={language} />
      <DemoDashboard projectRef={project} language={language} />
      <GuestBanner />
    </>
  );
}
