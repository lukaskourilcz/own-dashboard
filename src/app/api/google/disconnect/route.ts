import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeGoogleAccess } from "@/lib/google-token";
import { rateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/csrf";

/**
 * Revoke the user's Google grant without ending their dashboard session.
 * The explicit disconnect endpoint; afterwards calendar
 * features will surface a re-link CTA but the user stays logged in.
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

  const limited = await rateLimit(user.id, { key: "google-disconnect", limit: 5, windowSec: 60 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  try {
    const receipt = await revokeGoogleAccess(user.id);
    return NextResponse.json({ ok: true, ...receipt }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Could not revoke Google access." },
      { status: 500 },
    );
  }
}
