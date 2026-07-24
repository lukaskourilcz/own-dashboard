import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProjectTraffic } from "@/lib/vercel";

/**
 * Vercel Web Analytics for a project's linked repo, for the Overview card.
 *
 *   GET /api/vercel/analytics?repo=owner/name
 *
 * Owner-authenticated. The Vercel token stays server-only; the repo is resolved
 * to a Vercel project automatically. Returns { kind: "unconfigured" | "not-found"
 * | "error" | "ok", ... }.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const repo = new URL(request.url).searchParams.get("repo")?.trim();
  if (!repo || !repo.includes("/")) {
    return NextResponse.json({ error: "repo is required." }, { status: 400 });
  }

  const traffic = await getProjectTraffic(repo);
  return NextResponse.json(traffic, {
    headers: { "cache-control": "private, max-age=300" },
  });
}
