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
  try {
    if ((await configuredProviders(user.id)).length === 0) return NextResponse.json({ error: "not-configured" }, { status: 503 });
    const admin = createAdminClient();
    if (body.connectionId) {
      const result = await syncConnectionById(admin, user.id, body.connectionId);
      if (!result) return NextResponse.json({ error: "Not found." }, { status: 404 });
      if (result.status !== "linked") return NextResponse.json({ error: "bank-sync-incomplete" }, { status: result.status === "error" ? 502 : 409 });
      return NextResponse.json({ inserted: result.inserted, banks: 1, accounts: result.accountsLinked });
    }
    const { data, count, error } = await admin.from("bank_connections").select("*", { count: "exact" }).eq("user_id", user.id).limit(51);
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count !== data.length || data.length > 50
      || data.some(conn => conn.user_id !== user.id)) throw new Error("Connections unavailable");
    let inserted = 0, accounts = 0, banks = 0, failed = 0;
    for (const conn of data as BankConnection[]) {
      try {
        const result = await syncConnection(admin, conn);
        if (result.status !== "linked") { failed++; continue; }
        inserted += result.inserted; accounts += result.accountsLinked; banks++;
      } catch { failed++; }
    }
    return NextResponse.json({ inserted, banks, accounts, failed, ...(failed > 0 ? { error: "bank-sync-incomplete" } : {}) }, { status: failed > 0 ? 502 : 200 });
  } catch {
    return NextResponse.json({ error: "Bank sync could not be confirmed. Refresh before retrying." }, { status: 502 });
  }
}
