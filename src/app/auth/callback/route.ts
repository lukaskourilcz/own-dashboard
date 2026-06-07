import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeGoogleTokens } from "@/lib/google-token";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.session) {
      // This is the ONLY moment Supabase exposes provider_refresh_token —
      // GoTrue nulls it on the next session refresh, which @supabase/ssr
      // triggers aggressively. Persist it server-side now or lose it.
      const { session, user } = data;
      const refreshToken =
        // Types vary across @supabase/ssr versions; both names appear in the wild.
        (session as unknown as { provider_refresh_token?: string | null })
          .provider_refresh_token ?? null;
      const accessToken = session.provider_token ?? null;
      const expiresInSeconds =
        (session as unknown as { expires_in?: number | null }).expires_in ??
        null;
      const scopesRaw =
        (session as unknown as { provider_scopes?: string | null })
          .provider_scopes ??
        (session as unknown as { scope?: string | null }).scope ??
        null;
      const scopes = scopesRaw
        ? scopesRaw.split(/\s+/).filter(Boolean)
        : [];
      const googleSub =
        (user.user_metadata as Record<string, unknown> | undefined)?.[
          "provider_id"
        ] ??
        (user.user_metadata as Record<string, unknown> | undefined)?.["sub"] ??
        null;

      if (refreshToken) {
        try {
          await storeGoogleTokens({
            userId: user.id,
            refreshToken,
            accessToken,
            expiresInSeconds,
            scopes,
            googleSub: typeof googleSub === "string" ? googleSub : null,
          });
        } catch (err) {
          console.error("[auth/callback] storeGoogleTokens failed:", err);
          // Fall through — the user is still logged in; first Google call
          // will surface a "reconnect" CTA.
        }
      }

      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
