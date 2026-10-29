"use client";

import { createClient } from "@/lib/supabase/client";
import { guestReadOnlyError, isGuestTour } from "@/lib/guest-requests";

// `repo` grants read/write to code in public AND private repos (OAuth Apps are
// coarse-grained — there's no per-repo Contents scope). `read:user` lets us
// label the connection with the GitHub login.
const SCOPES = ["repo", "read:user"].join(" ");

/**
 * Connect GitHub to the already-signed-in (Google) account via Supabase
 * identity linking. The OAuth round-trip returns through /auth/callback with
 * `link=github` as a navigation hint; the callback independently verifies
 * the token and its server-managed identity before choosing storage —
 * mirroring how relinkGoogle() feeds /auth/callback for Google.
 *
 * Requires "Manual linking" enabled in Supabase Auth, and the GitHub provider
 * configured there with an OAuth App.
 */
export async function connectGitHub(): Promise<{ error?: string }> {
  if (isGuestTour()) return { error: guestReadOnlyError() };
  const supabase = createClient();
  const { error } = await supabase.auth.linkIdentity({
    provider: "github",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=/&link=github`,
      scopes: SCOPES,
    },
  });
  return { error: error?.message };
}
