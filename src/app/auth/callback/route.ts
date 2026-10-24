import { awaitWithSignal } from "@/lib/abortable";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeGoogleTokens } from "@/lib/google-token";
import { storeGitHubTokens } from "@/lib/github-token";
import { verifyOAuthGrant } from "@/lib/oauth-grant-verification";

/**
 * Restrict `next=` to internal relative paths. Without this an attacker can
 * craft `/auth/callback?next=https://evil.com` and use our auth flow as a
 * redirector — the user signs in successfully and lands on the attacker's
 * page with a freshly minted Supabase session in their cookie jar.
 */
function safeNext(raw: string | null, origin: string): URL {
  const fallback = new URL("/", origin);
  if (!raw || raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  try {
    const target = new URL(raw, origin);
    // URL parsing removes tabs/newlines and normalizes backslashes. Check the
    // parsed origin, and keep this URL object: reparsing its normalized path
    // could turn a same-origin //path into a protocol-relative destination.
    return target.origin === origin && !target.username && !target.password ? target : fallback;
  } catch { return fallback; }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), url.origin);

  if (code) {
    const signal = AbortSignal.timeout(20_000);
    const supabase = await createClient(signal);
    let exchanged;
    try { exchanged = await awaitWithSignal(supabase.auth.exchangeCodeForSession(code), signal); }
    catch { return NextResponse.redirect(new URL("/login?error=auth", url.origin)); }
    const { data, error } = exchanged;
    if (!error && data.session) {
      try {
        const grant = await verifyOAuthGrant(data.session, data.user, signal);
        if (grant?.provider === "github") {
          try { await storeGitHubTokens({ userId: data.user.id, ...grant }, signal); }
          catch { console.error("[auth/callback] github-token-storage-unconfirmed"); }
        } else if (grant?.provider === "google" && grant.refreshToken) {
          try { await storeGoogleTokens({ userId: data.user.id, ...grant, refreshToken: grant.refreshToken }, signal); }
          catch { console.error("[auth/callback] google-token-storage-unconfirmed"); }
        }
      } catch { console.error("[auth/callback] provider-token-verification-unconfirmed"); }
      return NextResponse.redirect(next);
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
