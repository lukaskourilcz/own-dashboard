import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeGitHubAccess } from "@/lib/github-token";
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

  try {
    await revokeGitHubAccess(user.id);
  } catch (err) {
    console.error("[api/github/disconnect] revoke failed:", err);
    return NextResponse.json(
      { error: "Could not disconnect GitHub." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
