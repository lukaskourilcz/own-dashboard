import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { storeGoogleTokens } from "@/lib/google-token";
import { storeGitHubTokens } from "@/lib/github-token";

/**
 * Restrict `next=` to internal relative paths. Without this an attacker can
 * craft `/auth/callback?next=https://evil.com` and use our auth flow as a
 * redirector — the user signs in successfully and lands on the attacker's
 * page with a freshly minted Supabase session in their cookie jar.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  // Must start with single slash, must NOT start with // (protocol-relative)
  // or with /\ (Windows-style protocol-relative bypass).
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//")) return "/dashboard";
  if (raw.startsWith("/\\")) return "/dashboard";
  return raw;
}

type SessionLike = {
  provider_token?: string | null;
  provider_refresh_token?: string | null;
  expires_in?: number | null;
  provider_scopes?: string | null;
  scope?: string | null;
};

function parseScopes(session: SessionLike): string[] {
  const raw = session.provider_scopes ?? session.scope ?? null;
  return raw ? raw.split(/\s+/).filter(Boolean) : [];
}

/**
 * Persist the GitHub provider token captured when an identity link returns
 * through here (`link=github`). Classic OAuth App tokens never expire and ship
 * no refresh_token, so the access_token is the durable credential; we only
 * stamp an expiry when GitHub actually handed back a refresh_token.
 */
async function captureGitHub(session: SessionLike, user: User): Promise<void> {
  const accessToken = session.provider_token ?? null;
  if (!accessToken) return;
  const refreshToken = session.provider_refresh_token ?? null;

  const gh = user.identities?.find((i) => i.provider === "github");
  const data = (gh?.identity_data ?? {}) as Record<string, unknown>;
  const login =
    typeof data.user_name === "string"
      ? data.user_name
      : typeof data.preferred_username === "string"
        ? data.preferred_username
        : null;
  const idRaw = data.provider_id ?? data.sub;
  const githubId =
    typeof idRaw === "number"
      ? idRaw
      : typeof idRaw === "string" && /^\d+$/.test(idRaw)
        ? Number(idRaw)
        : null;

  try {
    await storeGitHubTokens({
      userId: user.id,
      accessToken,
      refreshToken,
      // Only treat as expiring when a refresh_token exists (GitHub App mode).
      expiresInSeconds: refreshToken ? (session.expires_in ?? null) : null,
      scopes: parseScopes(session),
      githubLogin: login,
      githubId,
    });
  } catch (err) {
    console.error("[auth/callback] storeGitHubTokens failed:", err);
    // Non-fatal — the user stays logged in; first GitHub call shows a CTA.
  }
}

async function captureGoogle(session: SessionLike, user: User): Promise<void> {
  // This is the ONLY moment Supabase exposes provider_refresh_token — GoTrue
  // nulls it on the next session refresh, which @supabase/ssr triggers
  // aggressively. Persist it server-side now or lose it.
  const refreshToken = session.provider_refresh_token ?? null;
  if (!refreshToken) return;
  const googleSub =
    (user.user_metadata as Record<string, unknown> | undefined)?.[
      "provider_id"
    ] ??
    (user.user_metadata as Record<string, unknown> | undefined)?.["sub"] ??
    null;
  try {
    await storeGoogleTokens({
      userId: user.id,
      refreshToken,
      accessToken: session.provider_token ?? null,
      expiresInSeconds: session.expires_in ?? null,
      scopes: parseScopes(session),
      googleSub: typeof googleSub === "string" ? googleSub : null,
    });
  } catch (err) {
    console.error("[auth/callback] storeGoogleTokens failed:", err);
    // Fall through — the user is still logged in; first Google call will
    // surface a "reconnect" CTA.
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const link = url.searchParams.get("link");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.session) {
      const session = data.session as unknown as SessionLike;
      if (link === "github") {
        await captureGitHub(session, data.user);
      } else {
        await captureGoogle(session, data.user);
      }
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
