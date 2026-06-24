"use client";

import { createClient } from "@/lib/supabase/client";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export async function relinkGoogle(): Promise<{ error?: string }> {
  const supabase = createClient();
  // prompt=consent + access_type=offline forces Google to mint a fresh
  // refresh_token (which /auth/callback persists into google_oauth).
  // include_granted_scopes=true makes future scope additions additive:
  // user keeps their existing grants and only consents to the delta.
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=/`,
      scopes: SCOPES,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
      },
    },
  });
  return { error: error?.message };
}
