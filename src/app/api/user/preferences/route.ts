import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { PREFERENCE_FIELDS, parseStoredUiPreferences, preferencePatchSchema } from "@/lib/ui-preferences-contract";

export const maxDuration = 20;
const headers = { "cache-control": "private, no-store" };
const response = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
function budget(request?: Request) { return AbortSignal.any([AbortSignal.timeout(15_000), ...(request ? [request.signal] : [])]); }

export async function GET(request: Request) {
  const signal = budget(request);
  try {
    const supabase = await awaitWithSignal(createClient(signal), signal);
    const auth = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (auth.error) throw Error("Authentication unavailable");
    if (!auth.data.user) return response("Not authenticated.", 401);
    const { data, error } = await awaitWithSignal(supabase.from("user_preferences").select(["user_id", ...PREFERENCE_FIELDS].join(","))
      .eq("user_id", auth.data.user.id).abortSignal(signal).maybeSingle(), signal);
    const row = data === null ? null : z.record(z.string(), z.unknown()).parse(data);
    if (error || (row && row.user_id !== auth.data.user.id)) throw Error("Preferences unavailable");
    return NextResponse.json({ ...parseStoredUiPreferences(row), sync_available: true }, { headers });
  } catch { return response("Could not load preferences.", 503); }
}

export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) { rejected.headers.set("cache-control", "private, no-store"); return rejected; }
  const signal = budget(request);
  try {
    const supabase = await awaitWithSignal(createClient(signal), signal);
    const auth = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (auth.error) throw Error("Authentication unavailable");
    const user = auth.data.user;
    if (!user) return response("Not authenticated.", 401);
    const prefix = await awaitWithSignal(readTextPrefix(new Response(request.body), 65_536, signal), signal);
    if (prefix.truncated) return response("Preferences request too large.", 413);
    let input: unknown;
    try { input = JSON.parse(prefix.text); } catch { return response("Expected a preferences object.", 400); }
    const parsed = preferencePatchSchema.safeParse(input);
    if (!parsed.success) return response("Invalid preferences.", 400);
    const patch = parsed.data, fields = Object.keys(patch).filter(key => patch[key as keyof typeof patch] !== undefined);
    const existing = await awaitWithSignal(supabase.from("user_preferences").select("user_id,updated_at").eq("user_id", user.id).abortSignal(signal).maybeSingle(), signal);
    if (existing.error || (existing.data && (existing.data.user_id !== user.id || !Number.isFinite(Date.parse(existing.data.updated_at))))) throw Error("Preferences unavailable");
    // Advance beyond the captured timestamp even if clocks differ. The exact
    // stored version stays in the predicate; no private value enters a URL.
    const updated_at = new Date(Math.max(Date.now(), existing.data ? Date.parse(existing.data.updated_at) + 1 : 0)).toISOString();
    const values = { ...patch, updated_at };
    const columns = ["user_id", "updated_at", ...fields].join(",");
    const write = existing.data
      ? supabase.from("user_preferences").update(values).eq("user_id", user.id).eq("updated_at", existing.data.updated_at)
      : supabase.from("user_preferences").upsert({ ...values, user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
    const saved = await awaitWithSignal(write.select(columns).abortSignal(signal).maybeSingle(), signal);
    if (saved.error) throw Error("Preference save unconfirmed");
    if (!saved.data) return response("Preferences changed; refresh before retrying.", 409);
    const row = z.record(z.string(), z.unknown()).parse(saved.data);
    if (row.user_id !== user.id || Date.parse(String(row.updated_at)) !== Date.parse(updated_at)
      || fields.some(key => JSON.stringify(row[key]) !== JSON.stringify(patch[key as keyof typeof patch]))) throw Error("Preference save unconfirmed");
    return NextResponse.json({ ok: true, saved: Object.fromEntries(fields.map(key => [key, row[key]])) }, { headers });
  } catch { return response("Could not confirm preference save.", 503); }
}
