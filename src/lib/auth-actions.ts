"use client";
import { guestReadOnlyError, isGuestTour } from "@/lib/guest-requests";

let activeSignOut: Promise<void> | null = null;
/** One in-flight action across the sidebar and command palette. No user or
 * session values are stored here. Navigate only after the server's receipt. */
export function requestSignOut(): Promise<void> {
  if (isGuestTour()) return Promise.reject(new Error(guestReadOnlyError()));
  if (activeSignOut) return activeSignOut;
  const pending = (async () => {
    const response = await fetch("/auth/signout", { method: "POST", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok || (await response.json()).ok !== true) throw new Error("Sign-out unconfirmed");
  })();
  activeSignOut = pending;
  void pending.finally(() => { if (activeSignOut === pending) activeSignOut = null; }).catch(() => undefined);
  return pending;
}
