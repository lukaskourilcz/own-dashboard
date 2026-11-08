import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { PublishingSwitchSchema } from "@/lib/publishing-calendar";

export const runtime = "nodejs";

/**
 * POST /api/publishing-calendar/switch (owner request, 8 November 2026): turns one version of a planned post (story,
 * Instagram post, Threads, LinkedIn, Facebook) or the whole post ("all") off or back on. Off is a row in
 * `marketing_publishing_switches`; the publishers' claim never takes a switched-off version. Through the owner's
 * session, so own-only RLS and the slot-ownership trigger decide what may change.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const input = PublishingSwitchSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "invalid-switch" }, { status: 400 });
  const { brand, slotId, channel, off } = input.data;
  const result = off
    ? await db.from("marketing_publishing_switches").upsert({ user_id: user.id, brand, slot_id: slotId, channel }, { onConflict: "user_id,brand,slot_id,channel", ignoreDuplicates: true })
    : await db.from("marketing_publishing_switches").delete().eq("user_id", user.id).eq("brand", brand).eq("slot_id", slotId).eq("channel", channel);
  if (result.error) return Response.json({ error: "switch-unavailable" }, { status: 409 });
  return Response.json({ brand, slotId, channel, off }, { headers: { "Cache-Control": "private, no-store" } });
}
