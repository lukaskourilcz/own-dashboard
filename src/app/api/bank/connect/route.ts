import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { readTextPrefix } from "@/lib/bounded-text";
import { bankConsentUrl } from "@/lib/bank/flow";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { getProvider } from "@/lib/bank/registry";

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

  let body: { provider: string; institutionId: string; institutionName?: string };
  try {
    const prefix = await readTextPrefix(new Response(request.body), 4096);
    if (prefix.truncated) return NextResponse.json({ error: "Invalid body." }, { status: 413 });
    const parsed = z.object({ provider: z.enum(["gocardless", "fio", "enable-banking"]).default("gocardless"),
      institutionId: z.string().trim().min(1).max(256), institutionName: z.string().trim().max(160).optional() }).strict().safeParse(JSON.parse(prefix.text));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 });
    body = parsed.data;
  } catch { return NextResponse.json({ error: "Invalid body." }, { status: 400 }); }
  const limited = await rateLimit(user.id, { key: "bank-connect", limit: 5, windowSec: 60 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });

  const reference = crypto.randomUUID();
  const redirect = new URL("/api/bank/callback", request.url).toString();
  const institutionName = body.institutionName?.slice(0, 120) ?? null;

  try {
    const provider = getProvider(body.provider);
    if (!provider.beginLink || !(await provider.isConfigured(user.id))) return NextResponse.json({ error: "not-configured" }, { status: 503 });
    const link = await provider.beginLink({
      userId: user.id,
      institutionId: body.institutionId,
      institutionName,
      redirect,
      reference,
    });

    const consentUrl = bankConsentUrl(provider.id, link.consentUrl);
    if (!z.object({ providerRef: z.uuid(), consentExpiresAt: z.iso.datetime({ offset: true }).nullable() }).safeParse(link).success) throw new Error("Invalid provider receipt");
    const admin = createAdminClient();
    const { data: saved, error } = await admin.from("bank_connections").insert({
      user_id: user.id,
      provider: provider.id,
      provider_ref: link.providerRef,
      // Kept in step for GoCardless so nothing that still reads the original
      // column regresses; null for providers that have no requisition.
      requisition_id: provider.id === "gocardless" ? link.providerRef : null,
      institution_id: body.institutionId,
      institution_name: institutionName,
      reference,
      status: "created",
      consent_expires_at: link.consentExpiresAt,
    }).select("id").single();
    if (error || !z.uuid().safeParse(saved?.id).success) throw new Error("Connection not confirmed");
    return NextResponse.json({ link: consentUrl });
  } catch {
    return NextResponse.json(
      { error: "Could not start bank connection." },
      { status: 502 },
    );
  }
}
