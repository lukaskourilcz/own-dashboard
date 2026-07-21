import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";

type Patch = {
  selected_calendar_ids?: string[];
  visible_repo_ids?: string[];
  timezone?: string | null;
  nudge_hour?: number | null;
  notifications_renewals?: boolean;
  ai_enabled?: boolean;
  ai_sensitive_opt_in?: boolean;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { data, error } = await supabase
    .from("user_preferences")
    .select("ai_enabled, ai_sensitive_opt_in, notifications_renewals")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load preferences." }, { status: 500 });
  return NextResponse.json({
    ai_enabled: data?.ai_enabled ?? true,
    ai_sensitive_opt_in: data?.ai_sensitive_opt_in ?? false,
    notifications_renewals: data?.notifications_renewals ?? true,
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

  const body = (await request.json().catch(() => ({}))) as Patch;
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
