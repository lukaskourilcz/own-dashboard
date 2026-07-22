import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  // The page owns the environment guard: ordinary production builds call
  // notFound(), while local development and explicit NEXT_E2E builds render
  // fixtures. Bypass auth here so production reaches that 404 instead of
  // leaking the route as an authentication redirect.
  if (request.nextUrl.pathname.startsWith("/dev-preview")) {
    return NextResponse.next({ request });
  }

  // API routes authenticate themselves — each one calls getUser() (returning
  // 401), verifies `Authorization: Bearer $CRON_SECRET` (the cron jobs), or is
  // intentionally public (the cron registry). Running the page-level
  // session-redirect here would 307 any cookieless request to /login *before*
  // the handler runs, which silently killed the Vercel Cron jobs (renewal
  // emails, bank-sync) — they carry the bearer secret but no session cookie.
  // Skip the redirect for /api and let each route do its own authz.
  if (request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const url = request.nextUrl;
  const isAuthRoute =
    url.pathname.startsWith("/login") || url.pathname.startsWith("/auth");

  if (!user && !isAuthRoute) {
    const loginUrl = url.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (user && url.pathname === "/login") {
    const homeUrl = url.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}
