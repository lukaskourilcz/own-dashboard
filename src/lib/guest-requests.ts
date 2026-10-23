import { guest } from "@/lib/i18n/sections/guest";

/** Public tours must stay isolated even if the owner is signed in. */
export function guestProtectedUrl(input: string, origin: string, supabaseUrl?: string): boolean {
  const url = new URL(input, origin);
  const backendOrigin = supabaseUrl ? new URL(supabaseUrl).origin : null;
  return url.origin === backendOrigin || (url.origin === origin && (url.pathname.startsWith("/api/") || url.pathname === "/auth/signout"));
}

export function isGuestTour(): boolean {
  return typeof document !== "undefined" && (window.location.pathname === "/guest" || document.documentElement.dataset.guestTour === "true");
}

export function guestReadOnlyError(): string {
  window.dispatchEvent(new Event("guest-action-blocked"));
  const t = guest[document.documentElement.lang === "en" ? "en" : "cs"];
  return t.readOnlyAction;
}

export function guestReadOnlyResponse(): Response {
  return Response.json({ error: guestReadOnlyError() }, { status: 403 });
}

/** Supabase may capture fetch while rendering, before the tour's layout effect. */
export const dashboardBrowserFetch: typeof fetch = (input, init) => {
  if (isGuestTour()) return Promise.resolve(guestReadOnlyResponse());
  return fetch(input, init);
};
