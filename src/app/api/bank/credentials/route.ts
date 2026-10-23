import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { readTextPrefix } from "@/lib/bounded-text";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import {
  hasProviderSecret,
} from "@/lib/bank/credentials";
import { isBankProviderId, type BankProviderId } from "@/lib/bank/provider";

/**
 * The only path by which a per-user bank provider secret enters the system, and
 * it never leaves it. A stored token is written with the service role into
 * `bank_provider_credentials`, and every response here reports presence as a
 * boolean — no value, no prefix, no length.
 *
 * Today that means the Fio API token, which the owner generates read-only
 * inside Fio internet banking. GoCardless and Enable Banking are app-level env
 * credentials and are not settable from the browser at all.
 */

const TOKEN_PROVIDERS: BankProviderId[] = ["fio"];

function tokenProvider(value: unknown): BankProviderId | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!isBankProviderId(trimmed)) return null;
  return TOKEN_PROVIDERS.includes(trimmed) ? trimmed : null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const stored: Record<string, boolean> = {};
  try {
    const admin = createAdminClient();
    for (const provider of TOKEN_PROVIDERS) {
      stored[provider] = await hasProviderSecret(admin, user.id, provider);
    }
  } catch {
    return NextResponse.json({ error: "Credential status unavailable." }, { status: 503 });
  }

  return NextResponse.json(
    { stored },
    { headers: { "cache-control": "private, no-store" } },
  );
}

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

  let body: { provider: "fio"; token: string };
  try {
    const prefix = await readTextPrefix(new Response(request.body), 4096);
    if (prefix.truncated) return NextResponse.json({ error: "Invalid body." }, { status: 413 });
    const parsed = z.object({ provider: z.literal("fio"), token: z.string().trim().min(16).max(512) }).strict().safeParse(JSON.parse(prefix.text));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 });
    body = parsed.data;
  } catch { return NextResponse.json({ error: "Invalid body." }, { status: 400 }); }
  const limited = await rateLimit(user.id, { key: "bank-credentials", limit: 5, windowSec: 60 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });

  let connectionId: string;
  try {
    const { data, error } = await createAdminClient().rpc("store_bank_token", { p_user_id: user.id, p_provider: body.provider, p_secret: body.token });
    const receipt = z.uuid().safeParse(data);
    if (error || !receipt.success) throw new Error("Store unconfirmed");
    connectionId = receipt.data;
  } catch {
    return NextResponse.json({ error: "Could not confirm token storage. Refresh before retrying." }, { status: 500 });
  }

  // The caller syncs this id next; the sync is what proves the token works, so
  // the row starts as pending rather than claiming a link nobody verified.
  return NextResponse.json({ ok: true, connectionId });
}

export async function DELETE(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const provider = tokenProvider(
    new URL(request.url).searchParams.get("provider"),
  );
  if (!provider) {
    return NextResponse.json(
      { error: "Unsupported provider." },
      { status: 400 },
    );
  }

  const limited = await rateLimit(user.id, { key: "bank-credentials", limit: 5, windowSec: 60 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("forget_bank_token", { p_user_id: user.id, p_provider: provider });
    if (error || data !== true) throw new Error("Removal unconfirmed");
  } catch {
    return NextResponse.json(
      { error: "Could not remove the token." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
