import { NextResponse } from "next/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { createClient } from "@/lib/supabase/server";
import type {
  DailyFocus,
  DailyFocusDay,
  DailyFocusItem,
} from "@/lib/types";

async function loadDailyFocus(regenerate: boolean): Promise<
  | { data: DailyFocus; error?: never }
  | { data?: never; error: string; status: number }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated.", status: 401 };

  const { data: setId, error: rpcError } = await supabase.rpc(
    "create_daily_focus_set",
    { p_regenerate: regenerate },
  );
  if (rpcError || typeof setId !== "string") {
    return { error: "Could not prepare today's focus.", status: 500 };
  }

  const { data: set, error: setError } = await supabase
    .from("daily_focus_sets")
    .select("id, focus_date, generation")
    .eq("id", setId)
    .single();
  if (setError || !set) {
    return { error: "Could not load today's focus.", status: 500 };
  }

  const [{ data: items, error: itemsError }, { data: recentSets }] =
    await Promise.all([
      supabase
        .from("daily_focus_items")
        .select(
          "id, set_id, todo_id, position, title_snapshot, project_name_snapshot, importance_snapshot, waiting_since, completed_at",
        )
        .eq("set_id", setId)
        .order("position"),
      supabase
        .from("daily_focus_sets")
        .select(
          "id, focus_date, generation, daily_focus_items(id, completed_at)",
        )
        .eq("user_id", user.id)
        .order("focus_date", { ascending: false })
        .order("generation", { ascending: false })
        .limit(350),
    ]);

  if (itemsError) {
    return { error: "Could not load today's tasks.", status: 500 };
  }

  const byDate = new Map<string, DailyFocusDay>();
  for (const row of recentSets ?? []) {
    const date = String(row.focus_date);
    const nested = Array.isArray(row.daily_focus_items)
      ? row.daily_focus_items
      : [];
    const completedCount = nested.filter((item) => item.completed_at).length;
    const completed = nested.length === 7 && completedCount === 7;
    const current = byDate.get(date);
    if (
      !current ||
      completed ||
      (!current.completed && completedCount > current.completedCount)
    ) {
      byDate.set(date, {
        date,
        completed,
        completedCount,
        total: nested.length,
      });
    }
  }

  return {
    data: {
      setId,
      date: String(set.focus_date),
      generation: Number(set.generation),
      items: (items ?? []) as DailyFocusItem[],
      garden: [...byDate.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-49),
    },
  };
}

export async function GET() {
  const result = await loadDailyFocus(false);
  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json(result.data);
}

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  const result = await loadDailyFocus(true);
  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json(result.data);
}
