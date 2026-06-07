import "server-only";

/**
 * Cookie-based auth (Supabase SSR uses HTTP-only cookies) is vulnerable to
 * CSRF without explicit Origin/Referer validation. SameSite=Lax helps for
 * top-level POSTs but is not enough for fetch() from arbitrary origins on
 * older browsers and certain Safari/PWA edge cases.
 *
 * Defense: reject any non-GET request whose Origin (or Referer, as fallback)
 * doesn't match our own host. The host derives from the request's own URL,
 * so this works for prod + preview + localhost without extra config.
 *
 * Returns null when the request is allowed, or a Response to short-circuit.
 */
export function rejectCrossOrigin(request: Request): Response | null {
  const method = request.method.toUpperCase();
  // GET/HEAD/OPTIONS are not state-changing.
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  const expectedHost = new URL(request.url).host;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // Origin header is present on every modern POST/PUT/DELETE/PATCH from
  // browsers. Server-to-server callers should also send it; if they don't,
  // we fall back to Referer (rarely missing).
  const sourceUrl = origin ?? referer;
  if (!sourceUrl) {
    return new Response(
      JSON.stringify({ error: "Missing Origin header." }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  let sourceHost: string;
  try {
    sourceHost = new URL(sourceUrl).host;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid Origin header." }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  if (sourceHost !== expectedHost) {
    return new Response(
      JSON.stringify({ error: "Cross-origin request rejected." }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return null;
}
