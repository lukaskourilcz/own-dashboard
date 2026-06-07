import "server-only";
import { createClient as createUserClient } from "@/lib/supabase/server";

export type UserPreferences = {
  selected_calendar_ids: string[];
  timezone: string | null;
  nudge_hour: number | null;
  notifications_renewals: boolean;
  notifications_streaks: boolean;
};

const DEFAULT_PREFS: UserPreferences = {
  selected_calendar_ids: ["primary"],
  timezone: null,
  nudge_hour: null,
  notifications_renewals: true,
  notifications_streaks: true,
};

export async function loadUserPreferences(
  userId: string,
): Promise<UserPreferences> {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from("user_preferences")
    .select(
      "selected_calendar_ids, timezone, nudge_hour, notifications_renewals, notifications_streaks",
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
    timezone: data.timezone ?? null,
    nudge_hour: data.nudge_hour ?? null,
    notifications_renewals: data.notifications_renewals ?? true,
    notifications_streaks: data.notifications_streaks ?? true,
  };
}
