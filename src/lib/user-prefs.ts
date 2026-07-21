import "server-only";
import { createClient as createUserClient } from "@/lib/supabase/server";

export type UserPreferences = {
  selected_calendar_ids: string[];
  /** GitHub repo ids (as strings) the user pinned to the Repositories panel.
   *  Empty means "no filter" — show every repo the API returns. */
  visible_repo_ids: string[];
  timezone: string | null;
  nudge_hour: number | null;
  notifications_renewals: boolean;
  ai_enabled: boolean;
  ai_sensitive_opt_in: boolean;
};

const DEFAULT_PREFS: UserPreferences = {
  selected_calendar_ids: ["primary"],
  visible_repo_ids: [],
  timezone: null,
  nudge_hour: null,
  notifications_renewals: true,
  ai_enabled: true,
  ai_sensitive_opt_in: false,
};

export async function loadUserPreferences(
  userId: string,
): Promise<UserPreferences> {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from("user_preferences")
    .select(
      "selected_calendar_ids, visible_repo_ids, timezone, nudge_hour, notifications_renewals, ai_enabled, ai_sensitive_opt_in",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return DEFAULT_PREFS;
  return {
    selected_calendar_ids:
      Array.isArray(data.selected_calendar_ids) &&
      data.selected_calendar_ids.length > 0
        ? data.selected_calendar_ids
        : ["primary"],
    visible_repo_ids: Array.isArray(data.visible_repo_ids)
      ? data.visible_repo_ids.filter((s): s is string => typeof s === "string")
      : [],
    timezone: data.timezone ?? null,
    nudge_hour: data.nudge_hour ?? null,
    notifications_renewals: data.notifications_renewals ?? true,
    ai_enabled: data.ai_enabled ?? true,
    ai_sensitive_opt_in: data.ai_sensitive_opt_in ?? false,
  };
}
