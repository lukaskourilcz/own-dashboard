import "server-only";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { DEFAULT_LAYOUT } from "@/lib/dashboard-layout";

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
  language: "cs" | "en";
  theme: "light" | "dark";
  display_currency: string;
  hidden_navigation: string[];
  navigation_order: string[];
  navigation_collapsed: boolean;
  dashboard_layout: string[];
  tasks_per_category: number;
  cv_url_cs: string;
  cv_url_en: string;
};

const DEFAULT_PREFS: UserPreferences = {
  selected_calendar_ids: ["primary"],
  visible_repo_ids: [],
  timezone: null,
  nudge_hour: null,
  notifications_renewals: true,
  ai_enabled: true,
  ai_sensitive_opt_in: false,
  language: "cs",
  theme: "light",
  display_currency: "CZK",
  hidden_navigation: [],
  navigation_order: [],
  navigation_collapsed: false,
  dashboard_layout: [...DEFAULT_LAYOUT],
  tasks_per_category: 5,
  cv_url_cs: "",
  cv_url_en: "",
};

export async function loadUserPreferences(
  userId: string,
): Promise<UserPreferences> {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from("user_preferences")
    .select(
      "selected_calendar_ids, visible_repo_ids, timezone, nudge_hour, notifications_renewals, ai_enabled, ai_sensitive_opt_in, language, theme, display_currency, hidden_navigation, navigation_order, navigation_collapsed, dashboard_layout, tasks_per_category, cv_url_cs, cv_url_en",
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
    language: data.language === "en" ? "en" : "cs",
    theme: data.theme === "dark" ? "dark" : "light",
    display_currency:
      typeof data.display_currency === "string"
        ? data.display_currency
        : "CZK",
    hidden_navigation: Array.isArray(data.hidden_navigation)
      ? data.hidden_navigation.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    navigation_order: Array.isArray(data.navigation_order)
      ? data.navigation_order.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    navigation_collapsed: data.navigation_collapsed ?? false,
    dashboard_layout: Array.isArray(data.dashboard_layout)
      ? data.dashboard_layout.filter(
          (value): value is string => typeof value === "string",
        )
      : [...DEFAULT_LAYOUT],
    tasks_per_category:
      typeof data.tasks_per_category === "number"
        ? data.tasks_per_category
        : 5,
    cv_url_cs: data.cv_url_cs ?? "",
    cv_url_en: data.cv_url_en ?? "",
  };
}
