import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeGoogleAccess } from "@/lib/google-token";
import { rejectCrossOrigin } from "@/lib/csrf";

/**
 * Revoke the user's Google grant without ending their dashboard session.
 * Powers the "Disconnect Google" button in the sidebar — afterwards calendar
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

  try {
    await revokeGoogleAccess(user.id);
  } catch (err) {
    console.error("[api/google/disconnect] revoke failed:", err);
    return NextResponse.json(
      { error: "Could not revoke Google access." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
