import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import {
  deleteProviderSecret,
  hasProviderSecret,
  writeProviderSecret,
} from "@/lib/bank/credentials";
import { isBankProviderId, type BankProviderId } from "@/lib/bank/provider";
import { getProvider } from "@/lib/bank/registry";

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
    // Without a service-role key nothing can be stored, so nothing is stored.
    for (const provider of TOKEN_PROVIDERS) stored[provider] = false;
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

  let body: { provider?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const provider = tokenProvider(body.provider);
  if (!provider) {
    return NextResponse.json(
      { error: "Unsupported provider." },
      { status: 400 },
    );
  }

  const token = body.token?.trim() ?? "";
  if (token.length < 16 || token.length > 512) {
    return NextResponse.json({ error: "Invalid token." }, { status: 400 });
  }

  let connectionId: string | null = null;
  try {
    const admin = createAdminClient();
    await writeProviderSecret(admin, user.id, provider, token);
    connectionId = await ensureConnection(admin, user.id, provider);
  } catch (err) {
    console.error("[api/bank/credentials] store failed:", err);
    return NextResponse.json(
      { error: "Could not store the token." },
      { status: 500 },
    );
  }

  // The caller syncs this id next; the sync is what proves the token works, so
  // the row starts as pending rather than claiming a link nobody verified.
  return NextResponse.json({ ok: true, connectionId });
}

/** A token provider has no redirect flow, so its `bank_connections` row is
 *  created here — that row is what puts it in the connection list, the sync
 *  loop and the daily cron. */
async function ensureConnection(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  provider: BankProviderId,
): Promise<string | null> {
  const { data: existing } = await admin
    .from("bank_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (existing) {
    await admin
      .from("bank_connections")
      .update({ status: "created", last_error: null })
      .eq("id", existing.id);
    return (existing as { id: string }).id;
  }
  const { data: created } = await admin
    .from("bank_connections")
    .insert({
      user_id: userId,
      provider,
      institution_name: getProvider(provider).label,
      reference: crypto.randomUUID(),
      status: "created",
    })
    .select("id")
    .single();
  return (created as { id: string } | null)?.id ?? null;
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

  try {
    const admin = createAdminClient();
    await deleteProviderSecret(admin, user.id, provider);
    // Forgetting the token also removes the connection it backed; imported
    // transactions stay, exactly as a disconnect leaves them.
    await admin
      .from("bank_connections")
      .delete()
      .eq("user_id", user.id)
      .eq("provider", provider);
  } catch (err) {
    console.error("[api/bank/credentials] delete failed:", err);
    return NextResponse.json(
      { error: "Could not remove the token." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
