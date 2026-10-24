"use client";

import { awaitWithSignal } from "@/lib/abortable";
import { createClient } from "@/lib/supabase/client";
import { guestReadOnlyError, isGuestTour } from "@/lib/guest-requests";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

/** Prepare the PKCE URL without the SDK's automatic redirect. A timeout or
 * unmounted caller must not navigate later when slow storage finally settles. */
export async function relinkGoogle(parent?: AbortSignal): Promise<{ error?: string }> {
  if (isGuestTour()) return { error: guestReadOnlyError() };
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]);
  if (signal.aborted) return { error: "Google authorization unavailable" };
  try {
    const supabase = createClient(), redirectTo = `${window.location.origin}/auth/callback?next=/`;
    // Consent/offline renew the refresh grant; the callback stores it server-side.
    const { data, error } = await awaitWithSignal(supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo, scopes: SCOPES, skipBrowserRedirect: true,
        queryParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
      },
    }), signal);
    if (signal.aborted || error || !data.url || data.url.length > 8192) throw Error();
    const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!), target = new URL(data.url);
    const path = `${configured.pathname.replace(/\/$/, "")}/auth/v1/authorize`;
    if (!["https:", "http:"].includes(configured.protocol) || configured.username || configured.password
      || target.origin !== configured.origin || target.pathname !== path || target.username || target.password || target.hash
      || target.searchParams.get("provider") !== "google" || target.searchParams.get("redirect_to") !== redirectTo) throw Error();
    window.location.assign(target.href);
    return {};
  } catch {
    // Never expose an upstream message, URL, verifier or provider detail.
    return { error: "Google authorization unavailable" };
  }
}
