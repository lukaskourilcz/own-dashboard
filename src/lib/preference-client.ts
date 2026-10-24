"use client";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";

let saveQueue: Promise<void> = Promise.resolve();

export async function fetchUserPreferences({ signal: parent }: { signal: AbortSignal }) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
  try {
    const response = await awaitWithSignal(fetch("/api/user/preferences", { cache: "no-store", signal }), signal);
    if (!response.ok) { if (response.body) void response.body.cancel().catch(() => undefined); throw Error("Preferences unavailable"); }
    const prefix = await awaitWithSignal(readTextPrefix(response, 65_536, signal), signal);
    if (prefix.truncated) throw Error("Preferences unavailable");
    const body = JSON.parse(prefix.text);
    const { preferenceValuesSchema } = await awaitWithSignal(import("@/lib/ui-preferences-contract"), signal);
    if (body?.sync_available !== true) throw Error("Preferences unavailable");
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
): Promise<void> {
  let captured: Record<string, unknown>;
  try { captured = structuredClone(patch); } catch { return Promise.reject(Error("Could not save preferences.")); }
  const queued = AbortSignal.timeout(30_000);
  const run = async () => {
    const signal = AbortSignal.any([queued, AbortSignal.timeout(20_000)]);
    try {
      signal.throwIfAborted();
      // Keep validation off the initial shell bundle; it loads on a real save.
      const { preferencePatchSchema } = await awaitWithSignal(import("@/lib/ui-preferences-contract"), signal);
      const requested = preferencePatchSchema.parse(captured), body = JSON.stringify(requested);
      if (body.length > 65_536) throw Error("Invalid preference size");
      signal.throwIfAborted();
      const response = await awaitWithSignal(fetch("/api/user/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body, signal }), signal);
      if (!response.ok) { if (response.body) void response.body.cancel().catch(() => undefined); throw Error("Preference save unconfirmed"); }
      const prefix = await awaitWithSignal(readTextPrefix(response, 65_536, signal), signal);
      if (prefix.truncated) throw Error("Preference save unconfirmed");
      const receipt = JSON.parse(prefix.text);
      if (receipt?.ok !== true) throw Error("Preference save unconfirmed");
      const saved = preferencePatchSchema.parse(receipt.saved), keys = Object.keys(requested);
      if (keys.length !== Object.keys(saved).length || keys.some(key => JSON.stringify(saved[key as keyof typeof saved]) !== JSON.stringify(requested[key as keyof typeof requested]))) throw Error("Preference save unconfirmed");
    } catch { throw Error("Could not save preferences."); }
  };
  const pending = saveQueue.catch(() => undefined).then(run);
  saveQueue = pending.catch(() => undefined);
  return awaitWithSignal(pending, queued);
}
