import "server-only";
import { awaitWithSignal } from "@/lib/abortable";
import { getOAuthAccessToken, type OAuthProvider } from "@/lib/oauth-access-token";

/** One owner/request only. Sharing the two promises collapses fan-out reads
 * and 401 refreshes without retaining a credential in a process-wide cache. */
export function createOAuthFetcher(provider: OAuthProvider, userId: string, parentSignal?: AbortSignal) {
  const signal = AbortSignal.any([AbortSignal.timeout(25_000), ...(parentSignal ? [parentSignal] : [])]);
  const origin = provider === "github" ? "https://api.github.com" : "https://www.googleapis.com";
  let initial: Promise<string | null> | undefined, refreshed: Promise<string | null> | undefined;
  const target = (input: string) => {
    const url = new URL(input, origin);
    if (url.origin !== origin || url.username || url.password || url.hash) throw Error("Provider target refused");
    return url;
  };
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    // Validate before any credential lookup; callers cannot forward a token to
    // an arbitrary absolute URL or cross-origin redirect.
    const url = target(path);
    const callSignal = AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]);
    callSignal.throwIfAborted();
    initial ??= getOAuthAccessToken(provider, userId, signal);
    const token = await awaitWithSignal(initial, callSignal);
    if (!token) return new Response(null, { status: 401, statusText: "no-token" });
    const send = async (access: string) => {
      const headers = new Headers(init.headers);
      if (provider === "github") {
        if (!headers.has("accept")) headers.set("accept", "application/vnd.github+json");
        headers.set("X-GitHub-Api-Version", "2022-11-28");
      }
      headers.set("authorization", `Bearer ${access}`);
      let next = url;
      const requestSignal = AbortSignal.any([callSignal, AbortSignal.timeout(12_000)]);
      for (let redirects = 0; redirects <= 3; redirects++) {
        requestSignal.throwIfAborted();
        const response = await awaitWithSignal(fetch(next.href, { ...init, headers, cache: "no-store", redirect: "manual", signal: requestSignal }), requestSignal);
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        void response.body?.cancel().catch(() => undefined);
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw Error("Provider redirect refused");
        // Repository renames keep their read behavior. Never replay a write
        // after a redirect; the caller must use its canonical repository.
        if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) throw Error("Provider redirect refused");
        next = target(new URL(location, next).href);
      }
      throw Error("Provider redirect refused");
    };
    const first = await send(token);
    if (first.status !== 401) return first;
    refreshed ??= getOAuthAccessToken(provider, userId, signal, token);
    const replacement = await awaitWithSignal(refreshed, callSignal);
    if (!replacement || replacement === token) return first;
    void first.body?.cancel().catch(() => undefined);
    return send(replacement);
  };
}
