import { createClient } from "@/lib/supabase/server";
import { readPublishingCalendar } from "@/lib/publishing-calendar-read";

export const runtime = "nodejs";

/**
 * GET /api/publishing-calendar (owner request, 8 November 2026): what DNESKAi and devShark share today and in the next
 * two Prague days. Read-only, through the owner's session, so own-only RLS decides what is visible.
 */
export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json(await readPublishingCalendar(db, user.id, new Date()), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "publishing-calendar-unavailable" }, { status: 503 });
  }
}
