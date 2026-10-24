import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { awaitWithSignal } from "@/lib/abortable";
import { PREFERENCE_FIELDS, parseStoredUiPreferences, type UiPreferences } from "@/lib/ui-preferences-contract";

export type UserPreferences = UiPreferences & { sync_available: boolean };

/** A failed read must not hydrate defaults over a working device cache. */
export async function loadUserPreferences(userId: string, parent?: AbortSignal): Promise<UserPreferences> {
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]);
  try {
    const supabase = await awaitWithSignal(createClient(signal), signal);
    const { data, error } = await awaitWithSignal(supabase.from("user_preferences")
      .select(["user_id", ...PREFERENCE_FIELDS].join(",")).eq("user_id", userId).abortSignal(signal).maybeSingle(), signal);
    const row = data === null ? null : z.record(z.string(), z.unknown()).parse(data);
    if (error || (row && row.user_id !== userId)) throw Error("Preferences unavailable");
    return { ...parseStoredUiPreferences(row), sync_available: true };
  } catch {
    return { ...parseStoredUiPreferences(null), sync_available: false };
  }
}
