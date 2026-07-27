import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DemoDashboard } from "@/components/demo-dashboard";

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
  searchParams: Promise<{ project?: string }>;
}) {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_E2E !== "1") notFound();
  const { project } = await searchParams;

  return <DemoDashboard projectRef={project} />;
}
