import { NextResponse } from "next/server";
import { z } from "zod";
import { readTextPrefix } from "@/lib/bounded-text";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { getProvider } from "@/lib/bank/registry";
import type { BankConnection } from "@/lib/types";

/**
 * Disconnect a linked bank: ask the provider's adapter to revoke upstream, then
 * drop our row. Already-imported transactions are left in place (they're the
 * user's data); only the live link is removed.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let id: string;
  try {
    const prefix = await readTextPrefix(new Response(request.body), 4096);
    if (prefix.truncated) return NextResponse.json({ error: "Invalid body." }, { status: 413 });
    const parsed = z.object({ id: z.uuid() }).strict().safeParse(JSON.parse(prefix.text));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 });
    id = parsed.data.id;
  } catch { return NextResponse.json({ error: "Invalid body." }, { status: 400 }); }
  const limited = await rateLimit(user.id, { key: "bank-disconnect", limit: 5, windowSec: 60 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });

  const admin = createAdminClient();
  const { data, error: readError } = await admin
    .from("bank_connections")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (readError) return NextResponse.json({ error: "Bank connection unavailable." }, { status: 502 });
  if (!data) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const conn = data as BankConnection;

  // Best-effort revoke upstream; proceed with local delete regardless, and an
  // unregistered provider value must not strand the row either.
  let upstreamRevoked = false;
  try {
    const provider = getProvider(conn.provider);
    if (await provider.isConfigured(user.id)) {
      await provider.revoke(conn);
      upstreamRevoked = true;
    }
  } catch { /* Local disconnect still stops future pulls; report unconfirmed revocation. */ }

  const { data: removed, error } = await admin
    .from("bank_connections")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id).eq("updated_at", conn.updated_at).select("id").single();
  if (error || removed?.id !== id) {
    return NextResponse.json(
      { error: "Could not disconnect." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, upstreamRevoked });
}
