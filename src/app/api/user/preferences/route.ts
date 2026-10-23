import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { DEFAULT_LAYOUT, isWidgetId } from "@/lib/dashboard-layout";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { normalizeHiddenProjectTabs } from "@/lib/project-workspace-tabs";

type Patch = {
  selected_calendar_ids?: string[];
  visible_repo_ids?: string[];
  timezone?: string | null;
  nudge_hour?: number | null;
  notifications_renewals?: boolean;
  ai_enabled?: boolean;
  ai_sensitive_opt_in?: boolean;
  language?: "cs" | "en";
  theme?: "light" | "dark";
  display_currency?: string;
  hidden_navigation?: string[];
  navigation_order?: string[];
  navigation_collapsed?: boolean;
  dashboard_layout?: string[];
  tasks_per_category?: number;
  cv_url_cs?: string;
  cv_url_en?: string;
  hidden_project_tabs?: string[];
  show_czech_career?: boolean;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { data, error } = await supabase
    .from("user_preferences")
    .select("ai_enabled, ai_sensitive_opt_in, notifications_renewals, language, theme, display_currency, hidden_navigation, navigation_order, navigation_collapsed, dashboard_layout, tasks_per_category, cv_url_cs, cv_url_en, hidden_project_tabs, show_czech_career")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load preferences." }, { status: 500 });
  return NextResponse.json({
    ai_enabled: data?.ai_enabled ?? true,
    ai_sensitive_opt_in: data?.ai_sensitive_opt_in ?? false,
    notifications_renewals: data?.notifications_renewals ?? true,
    language: data?.language === "en" ? "en" : "cs",
    theme: data?.theme === "dark" ? "dark" : "light",
    display_currency: data?.display_currency ?? "CZK",
    hidden_navigation: data?.hidden_navigation ?? [],
    navigation_order: data?.navigation_order ?? [],
    navigation_collapsed: data?.navigation_collapsed ?? false,
    dashboard_layout: data?.dashboard_layout ?? [...DEFAULT_LAYOUT],
    tasks_per_category: data?.tasks_per_category ?? 5,
    cv_url_cs: data?.cv_url_cs ?? "",
    cv_url_en: data?.cv_url_en ?? "",
    hidden_project_tabs: normalizeHiddenProjectTabs(data?.hidden_project_tabs),
    show_czech_career: data?.show_czech_career === true,
    sync_available: true,
  });
}

export async function PATCH(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "Expected a preferences object." }, { status: 400 });
  }
  const body = input as Patch;
  if ("timezone" in body && body.timezone !== null) {
    try {
      if (typeof body.timezone !== "string" || !body.timezone || body.timezone.length > 100) throw new Error();
      new Intl.DateTimeFormat("en", { timeZone: body.timezone }).format();
    } catch {
      return NextResponse.json({ error: "Invalid timezone." }, { status: 400 });
    }
  }
  if ("nudge_hour" in body && body.nudge_hour !== null &&
      (!Number.isInteger(body.nudge_hour) || Number(body.nudge_hour) < 0 || Number(body.nudge_hour) > 23)) {
    return NextResponse.json({ error: "Invalid reminder hour." }, { status: 400 });
  }
  if ("display_currency" in body && !SUPPORTED_CURRENCIES.includes(body.display_currency as typeof SUPPORTED_CURRENCIES[number])) {
    return NextResponse.json({ error: "Unsupported display currency." }, { status: 400 });
  }
  const patch: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };

  if (Array.isArray(body.selected_calendar_ids)) {
    patch.selected_calendar_ids = body.selected_calendar_ids
      .filter((s) => typeof s === "string" && s.length > 0)
      .slice(0, 20); // sanity cap
  }
  if (Array.isArray(body.visible_repo_ids)) {
    // Empty array is meaningful — it clears the filter ("show all repos").
    patch.visible_repo_ids = Array.from(
      new Set(body.visible_repo_ids.filter((s) => typeof s === "string" && s.length > 0)),
    ).slice(0, 500); // sanity cap — the repos API returns at most 100
  }
  if ("timezone" in body) patch.timezone = body.timezone ?? null;
  if ("nudge_hour" in body) patch.nudge_hour = body.nudge_hour ?? null;
  if (typeof body.notifications_renewals === "boolean") {
    patch.notifications_renewals = body.notifications_renewals;
  }
  if (typeof body.ai_enabled === "boolean") {
    patch.ai_enabled = body.ai_enabled;
  }
  if (typeof body.ai_sensitive_opt_in === "boolean") {
    patch.ai_sensitive_opt_in = body.ai_sensitive_opt_in;
  }
  if (body.language === "cs" || body.language === "en") {
    patch.language = body.language;
  }
  if (body.theme === "light" || body.theme === "dark") {
    patch.theme = body.theme;
  }
  if (
    typeof body.display_currency === "string" &&
    /^[A-Z]{3}$/.test(body.display_currency)
  ) {
    patch.display_currency = body.display_currency;
  }
  if (Array.isArray(body.hidden_navigation)) {
    patch.hidden_navigation = Array.from(
      new Set(
        body.hidden_navigation.filter(
          (value) => typeof value === "string" && value.length > 0,
        ),
      ),
    ).slice(0, 50);
  }
  if (Array.isArray(body.navigation_order)) {
    patch.navigation_order = Array.from(
      new Set(
        body.navigation_order.filter(
          (value) => typeof value === "string" && value.length > 0,
        ),
      ),
    ).slice(0, 50);
  }
  if (typeof body.navigation_collapsed === "boolean") {
    patch.navigation_collapsed = body.navigation_collapsed;
  }
  if (Array.isArray(body.dashboard_layout)) {
    patch.dashboard_layout = Array.from(
      new Set(
        body.dashboard_layout.filter(isWidgetId),
      ),
    ).slice(0, 20);
  }
  if ([0, 3, 5, 10].includes(body.tasks_per_category ?? -1)) {
    patch.tasks_per_category = body.tasks_per_category;
  }
  if (typeof body.cv_url_cs === "string") {
    patch.cv_url_cs = body.cv_url_cs.slice(0, 2000);
  }
  if (typeof body.cv_url_en === "string") {
    patch.cv_url_en = body.cv_url_en.slice(0, 2000);
  }
  if (typeof body.show_czech_career === "boolean") {
    patch.show_czech_career = body.show_czech_career;
  }
  if (Array.isArray(body.hidden_project_tabs)) {
    patch.hidden_project_tabs = normalizeHiddenProjectTabs(
      body.hidden_project_tabs,
    );
  }

  const { error } = await supabase
    .from("user_preferences")
    .upsert(patch, { onConflict: "user_id" });
  if (error) {
    return NextResponse.json(
      { error: "Could not save preferences." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
