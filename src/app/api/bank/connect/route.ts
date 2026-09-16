import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { getProvider } from "@/lib/bank/registry";
import { UnknownBankProviderError } from "@/lib/bank/provider";

/**
 * Begin linking a bank: ask the provider for a consent link and hand back the
 * URL the browser should redirect to. We stash the pending connection (keyed by
 * a random reference) so the callback can finalise it. The provider is stored
 * on the row, which is what lets every later step resolve the right adapter.
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

  let body: { provider?: string; institutionId?: string; institutionName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  let provider;
  try {
    provider = getProvider(body.provider?.trim() || "gocardless");
  } catch (err) {
    if (err instanceof UnknownBankProviderError) {
      return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
    }
    throw err;
  }

  if (!provider.beginLink || !(await provider.isConfigured(user.id))) {
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }

  const institutionId = body.institutionId?.trim();
  if (!institutionId) {
    return NextResponse.json(
      { error: "institutionId is required." },
      { status: 400 },
    );
  }

  const reference = crypto.randomUUID();
  const redirect = new URL("/api/bank/callback", request.url).toString();
  const institutionName = body.institutionName?.slice(0, 120) ?? null;

  try {
    const link = await provider.beginLink({
      userId: user.id,
      institutionId,
      institutionName,
      redirect,
      reference,
    });

    const admin = createAdminClient();
    const { error } = await admin.from("bank_connections").insert({
      user_id: user.id,
      provider: provider.id,
      provider_ref: link.providerRef,
      // Kept in step for GoCardless so nothing that still reads the original
      // column regresses; null for providers that have no requisition.
      requisition_id: provider.id === "gocardless" ? link.providerRef : null,
      institution_id: institutionId,
      institution_name: institutionName,
      reference,
      status: "created",
      consent_expires_at: link.consentExpiresAt,
    });
    if (error) throw error;

    return NextResponse.json({ link: link.consentUrl });
  } catch (err) {
    console.error("[api/bank/connect] failed:", err);
    return NextResponse.json(
      { error: "Could not start bank connection." },
      { status: 502 },
    );
  }
}
