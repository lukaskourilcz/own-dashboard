import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeGitHubAccess } from "@/lib/github-token";
import { rateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/csrf";

/**
 * Revoke the user's GitHub grant without ending their dashboard session.
 * Powers the "Disconnect" button in the Repos panel — afterwards the panel
 * surfaces a reconnect CTA but the user stays logged in (via Google).
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const limited = await rateLimit(user.id, { key: "github-disconnect", limit: 5, windowSec: 60 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  try {
    const receipt = await revokeGitHubAccess(user.id);
    return NextResponse.json({ ok: true, ...receipt }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Could not disconnect GitHub." },
      { status: 500 },
    );
  }
}
