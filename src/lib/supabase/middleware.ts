import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const isWithin = (path: string) => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`);
  // The page owns the environment guard: ordinary production builds call
  // notFound(), while local development and explicit NEXT_E2E builds render
  // fixtures. Bypass auth here so production reaches that 404 instead of
  // leaking the route as an authentication redirect.
  if (isWithin("/dev-preview")) {
    return NextResponse.next({ request });
  }

  // /guest is the public read-only tour: the real shell rendered against the
  // demo fixtures, with no session and no owner data. Redirecting it to /login
  // would defeat its only purpose, which is being reachable while logged out.
  if (isWithin("/guest")) {
    return NextResponse.next({ request });
  }

  // API routes authenticate themselves — each one calls getUser() (returning
  // 401), verifies `Authorization: Bearer $CRON_SECRET` (the cron jobs), or is
  // intentionally public (the cron registry). Running the page-level
  // session-redirect here would 307 any cookieless request to /login *before*
  // the handler runs, which silently killed the Vercel Cron jobs (renewal
  // emails, bank-sync) — they carry the bearer secret but no session cookie.
  // Skip the redirect for /api and let each route do its own authz.
  if (isWithin("/api")) {
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
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          const previous = supabaseResponse;
          supabaseResponse = NextResponse.next({ request });
          copySessionResponse(previous, supabaseResponse);
          Object.entries(headers).forEach(([name, value]) => supabaseResponse.headers.set(name, value));
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
    url.pathname === "/login" || isWithin("/auth");

  if (!user && !isAuthRoute) {
    const loginUrl = url.clone();
    loginUrl.pathname = "/login";
    return copySessionResponse(supabaseResponse, NextResponse.redirect(loginUrl));
  }

  if (user && url.pathname === "/login") {
    const homeUrl = url.clone();
    homeUrl.pathname = "/";
    return copySessionResponse(supabaseResponse, NextResponse.redirect(homeUrl));
  }

  return supabaseResponse;
}

/** Preserve only SDK response state, never request/internal forwarding headers. */
function copySessionResponse(source: NextResponse, destination: NextResponse) {
  source.cookies.getAll().forEach(cookie => destination.cookies.set(cookie));
  for (const name of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(name);
    if (value !== null) destination.headers.set(name, value);
  }
  return destination;
}
