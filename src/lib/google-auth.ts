"use client";

import { createClient } from "@/lib/supabase/client";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export async function relinkGoogle(): Promise<{ error?: string }> {
  const supabase = createClient();
  // prompt=consent forces Google to re-issue a provider_token even if the user
  // is still signed in — the token Supabase keeps is short-lived and there's
  // no refresh flow wired up.
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      scopes: SCOPES,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  return { error: error?.message };
}
