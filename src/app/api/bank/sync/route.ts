import { awaitWithSignal } from "@/lib/abortable";
import { bankSyncSignal } from "@/lib/bank/sync-budget";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { readTextPrefix } from "@/lib/bounded-text";
import { configuredProviders } from "@/lib/bank/registry";
import { syncConnection, syncConnectionById } from "@/lib/bank-sync-server";
import type { BankConnection } from "@/lib/types";

export const maxDuration = 60;

const inputSchema = z.object({ connectionId: z.string().trim().pipe(z.uuid()).optional() }).strict();

/** Empty input explicitly syncs all owned connections. Malformed input must
 * never widen a selected-connection request into a full bank pull. */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  let body: z.infer<typeof inputSchema>;
  try {
    const prefix = await readTextPrefix(new Response(request.body), 4096);
    if (prefix.truncated) return NextResponse.json({ error: "Invalid body." }, { status: 413 });
    const parsed = inputSchema.safeParse(prefix.text.trim() ? JSON.parse(prefix.text) : {});
    if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 });
    body = parsed.data;
  } catch { return NextResponse.json({ error: "Invalid body." }, { status: 400 }); }
  const limited = await rateLimit(user.id, { key: "bank-sync", limit: 5, windowSec: 60 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  const signal = bankSyncSignal(request);
  try {
    const providers = await awaitWithSignal(configuredProviders(user.id, signal), signal);
    signal.throwIfAborted();
    if (providers.length === 0) return NextResponse.json({ error: "not-configured" }, { status: 503 });
    const admin = createAdminClient(signal);
    if (body.connectionId) {
      const result = await awaitWithSignal(syncConnectionById(admin, user.id, body.connectionId, signal), signal);
      if (!result) return NextResponse.json({ error: "Not found." }, { status: 404 });
      if (result.status !== "linked") return NextResponse.json({ error: "bank-sync-incomplete" }, { status: result.status === "error" ? 502 : 409 });
      return NextResponse.json({ inserted: result.inserted, banks: 1, accounts: result.accountsLinked });
    }
    const query = admin.from("bank_connections").select("*", { count: "exact" }).eq("user_id", user.id).limit(51).abortSignal(signal);
    const { data, count, error } = await awaitWithSignal(query, signal);
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count !== data.length || data.length > 50
      || data.some(conn => conn.user_id !== user.id)) throw new Error("Connections unavailable");
    let inserted = 0, accounts = 0, banks = 0, failed = 0;
    const connections = data as BankConnection[];
    for (let index = 0; index < connections.length; index++) {
      if (signal.aborted) { failed += connections.length - index; break; }
      try {
        const result = await awaitWithSignal(syncConnection(admin, connections[index], signal), signal);
        if (result.status !== "linked") { failed++; continue; }
        inserted += result.inserted; accounts += result.accountsLinked; banks++;
      } catch { failed++; }
    }
    return NextResponse.json({ inserted, banks, accounts, failed, ...(failed > 0 ? { error: "bank-sync-incomplete" } : {}) }, { status: failed > 0 ? 502 : 200 });
  } catch {
    return NextResponse.json({ error: "Bank sync could not be confirmed. Refresh before retrying." }, { status: 502 });
  }
}
