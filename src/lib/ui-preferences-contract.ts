import { z } from "zod";
import { DEFAULT_LAYOUT, WIDGET_IDS, normalizeLayout } from "@/lib/dashboard-layout";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { normalizeNavPreferenceIds } from "@/lib/navigation-preferences";
import { PROJECT_TAB_IDS, normalizeHiddenProjectTabs } from "@/lib/project-workspace-tabs";
import { safeWebUrl } from "@/lib/web-url";

const distinct = <T>(items: T[]): T[] => [...new Set(items)];
const navigation = z.array(z.string().max(100).refine(value => normalizeNavPreferenceIds([value]).length === 1)).max(50).transform(normalizeNavPreferenceIds);
const identifier = z.string().min(1).max(1024).refine(value => value.trim() === value && !/\p{Cc}/u.test(value));
const cvUrl = z.string().max(2000).refine(value => !/\p{Cc}/u.test(value)).transform(value => value.trim()).refine(value => !value || safeWebUrl(value) !== null);
export const preferenceValuesSchema = z.object({
  selected_calendar_ids: z.array(identifier).max(20).transform(distinct),
  visible_repo_ids: z.array(z.string().regex(/^[1-9]\d{0,15}$/).refine(value => Number.isSafeInteger(Number(value)))).max(500).transform(distinct),
  timezone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; } }).nullable(),
  nudge_hour: z.number().int().min(0).max(23).nullable(), notifications_renewals: z.boolean(),
  ai_enabled: z.boolean(), ai_sensitive_opt_in: z.boolean(), language: z.enum(["cs", "en"]), theme: z.enum(["light", "dark"]),
  display_currency: z.enum(SUPPORTED_CURRENCIES), hidden_navigation: navigation, navigation_order: navigation,
  navigation_collapsed: z.boolean(), dashboard_layout: z.array(z.enum(WIDGET_IDS)).max(20).transform(distinct),
  tasks_per_category: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]),
  cv_url_cs: cvUrl, cv_url_en: cvUrl, hidden_project_tabs: z.array(z.enum(PROJECT_TAB_IDS)).max(PROJECT_TAB_IDS.length).transform(distinct),
  show_czech_career: z.boolean(),
});
export const preferencePatchSchema = preferenceValuesSchema.partial().strict().refine(value => Object.values(value).some(item => item !== undefined));
export type UiPreferences = z.infer<typeof preferenceValuesSchema>;
export const PREFERENCE_FIELDS = Object.keys(preferenceValuesSchema.shape) as (keyof UiPreferences)[];
export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  selected_calendar_ids: ["primary"], visible_repo_ids: [], timezone: null, nudge_hour: null, notifications_renewals: true,
  ai_enabled: true, ai_sensitive_opt_in: false, language: "cs", theme: "light", display_currency: "CZK",
  hidden_navigation: [], navigation_order: [], navigation_collapsed: false, dashboard_layout: [...DEFAULT_LAYOUT],
  tasks_per_category: 5, cv_url_cs: "", cv_url_en: "", hidden_project_tabs: [], show_czech_career: false,
};

/** Legacy navigation/widget ids are normalized on reads, never restored as
 * retired product scope. Invalid scalar/oversized values remain unavailable. */
export function parseStoredUiPreferences(row: Record<string, unknown> | null): UiPreferences {
  const value = { ...DEFAULT_UI_PREFERENCES, ...row };
  for (const field of ["hidden_navigation", "navigation_order", "dashboard_layout", "hidden_project_tabs"] as const) {
    if (!Array.isArray(value[field]) || value[field].length > 50 || value[field].some(item => typeof item !== "string" || item.length > 100)) throw Error("Preferences unavailable");
  }
  const parsed = preferenceValuesSchema.parse({ ...value, hidden_navigation: normalizeNavPreferenceIds(value.hidden_navigation), navigation_order: normalizeNavPreferenceIds(value.navigation_order),
    dashboard_layout: normalizeLayout(value.dashboard_layout), hidden_project_tabs: normalizeHiddenProjectTabs(value.hidden_project_tabs) });
  if (!parsed.selected_calendar_ids.length) parsed.selected_calendar_ids = ["primary"];
  return parsed;
}
