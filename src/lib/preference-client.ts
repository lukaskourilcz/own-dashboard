"use client";
import { useCallback } from "react";
import { useOwnerPreferences } from "@/lib/owner-preferences";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";

export type PreferenceActor = { ownerId: string; signal: AbortSignal };
const saveQueues = new Map<string, Promise<void>>();
const ownerHeader = (ownerId: string) => { if (!ownerId || ownerId.length > 200 || /[\r\n]/.test(ownerId)) throw Error("Preferences unavailable"); return { "x-own-dashboard-owner": ownerId }; };

export async function fetchUserPreferences({ signal: parent, ownerId }: PreferenceActor) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
  try {
    const response = await awaitWithSignal(fetch("/api/user/preferences", { cache: "no-store", headers: ownerHeader(ownerId), signal }), signal);
    if (!response.ok) { if (response.body) void response.body.cancel().catch(() => undefined); throw Error("Preferences unavailable"); }
    const prefix = await awaitWithSignal(readTextPrefix(response, 65_536, signal), signal);
    if (prefix.truncated) throw Error("Preferences unavailable");
    const body = JSON.parse(prefix.text);
    const { preferenceValuesSchema } = await awaitWithSignal(import("@/lib/ui-preferences-contract"), signal);
    if (body?.sync_available !== true || body.ownerId !== ownerId) throw Error("Preferences unavailable");
    return preferenceValuesSchema.parse(body);
  } catch { throw Error("Could not load preferences."); }
}

/**
 * Serialize preference writes so rapid toggles cannot arrive out of order.
 * Queued work expires after 30 seconds; an individual request has at most 20.
 * The API confirms the exact own-row fields; callers present local-only errors.
 */
export function saveUserPreferences(
  patch: Record<string, unknown>,
  actor: PreferenceActor,
): Promise<void> {
  const { ownerId, signal: ownerSignal } = actor;
  let captured: Record<string, unknown>;
  try { captured = structuredClone(patch); } catch { return Promise.reject(Error("Could not save preferences.")); }
  const queued = AbortSignal.timeout(30_000);
  const run = async () => {
    const signal = AbortSignal.any([ownerSignal, queued, AbortSignal.timeout(20_000)]);
    try {
      signal.throwIfAborted();
      // Keep validation off the initial shell bundle; it loads on a real save.
      const { preferencePatchSchema } = await awaitWithSignal(import("@/lib/ui-preferences-contract"), signal);
      const requested = preferencePatchSchema.parse(captured), body = JSON.stringify(requested);
      if (body.length > 65_536) throw Error("Invalid preference size");
      signal.throwIfAborted();
      const response = await awaitWithSignal(fetch("/api/user/preferences", { method: "PATCH", headers: { "content-type": "application/json", ...ownerHeader(ownerId) }, body, signal }), signal);
      if (!response.ok) { if (response.body) void response.body.cancel().catch(() => undefined); throw Error("Preference save unconfirmed"); }
      const prefix = await awaitWithSignal(readTextPrefix(response, 65_536, signal), signal);
      if (prefix.truncated) throw Error("Preference save unconfirmed");
      const receipt = JSON.parse(prefix.text);
      if (receipt?.ok !== true || receipt.ownerId !== ownerId) throw Error("Preference save unconfirmed");
      const saved = preferencePatchSchema.parse(receipt.saved), keys = Object.keys(requested).filter(key => requested[key as keyof typeof requested] !== undefined);
      // Validation may normalize arrays/URLs. Compare the original receipt too
      // so normalization cannot conceal a different persisted value.
      if (keys.length !== Object.keys(saved).length || keys.some(key => JSON.stringify(receipt.saved[key]) !== JSON.stringify(requested[key as keyof typeof requested]))) throw Error("Preference save unconfirmed");
    } catch { throw Error("Could not save preferences."); }
  };
  const pending = (saveQueues.get(ownerId) ?? Promise.resolve()).catch(() => undefined).then(run);
  const tail = pending.catch(() => undefined);
  saveQueues.set(ownerId, tail);
  void tail.then(() => { if (saveQueues.get(ownerId) === tail) saveQueues.delete(ownerId); });
  return awaitWithSignal(pending, AbortSignal.any([ownerSignal, queued]));
}

/** Capture identity/lifetime synchronously at the action, before queueing. */
export function useSaveUserPreferences() {
  const owner = useOwnerPreferences();
  return useCallback(async (patch: Record<string, unknown>) => {
    if (!owner) throw Error("Could not save preferences.");
    const captured = structuredClone(patch), actor = owner.capture();
    await saveUserPreferences(captured, actor);
    actor.signal.throwIfAborted();
    owner.confirm(captured);
  }, [owner]);
}
