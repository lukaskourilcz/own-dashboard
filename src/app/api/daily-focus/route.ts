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

  const [{ data: items, error: itemsError }, { data: gardenRows, error: gardenError }] =
    await Promise.all([
      supabase
        .from("daily_focus_items")
        .select(
          "id, set_id, todo_id, position, title_snapshot, project_name_snapshot, importance_snapshot, waiting_since, completed_at",
        )
        .eq("set_id", setId)
        .order("position"),
      supabase.rpc("daily_focus_garden", { p_until: String(set.focus_date) }),
    ]);

  if (itemsError) {
    return { error: "Could not load today's tasks.", status: 500 };
  }

  const gardenAvailable = !gardenError && Array.isArray(gardenRows);
  const rows = (gardenAvailable ? gardenRows : []) as Array<{ focus_date: string; completed: boolean; completed_count: number; total: number }>;
  const garden: DailyFocusDay[] = rows.map(row => ({
    date: String(row.focus_date), completed: row.completed === true,
    completedCount: Number(row.completed_count), total: Number(row.total),
  }));

  return {
    data: {
      setId,
      date: String(set.focus_date),
      generation: Number(set.generation),
      items: (items ?? []) as DailyFocusItem[],
      garden,
      gardenAvailable,
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
