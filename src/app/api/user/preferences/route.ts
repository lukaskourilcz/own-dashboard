import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";

type Patch = {
  selected_calendar_ids?: string[];
  timezone?: string | null;
  nudge_hour?: number | null;
  notifications_renewals?: boolean;
  notifications_streaks?: boolean;
};

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
  if ("timezone" in body) patch.timezone = body.timezone ?? null;
  if ("nudge_hour" in body) patch.nudge_hour = body.nudge_hour ?? null;
  if (typeof body.notifications_renewals === "boolean") {
    patch.notifications_renewals = body.notifications_renewals;
  }
  if (typeof body.notifications_streaks === "boolean") {
    patch.notifications_streaks = body.notifications_streaks;
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
