import { z } from "zod";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { providerAvailability } from "@/lib/bank/registry";
import { awaitWithSignal } from "@/lib/abortable";
import { integrationStatusSchema } from "@/lib/integration-status";

const bankRow = z.object({
  user_id: z.string(), provider: z.enum(["gocardless", "fio", "enable-banking"]),
  status: z.enum(["created", "linked", "expired", "error"]), last_synced_at: z.iso.datetime({ offset: true }).nullable(),
});
const headers = { "cache-control": "private, no-store" };

/** Connection/configuration metadata only. A failed read must not report a
 * disconnected account or offer another connection for an unknown state. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
  const signal = AbortSignal.timeout(12_000);
  try {
    const admin = createAdminClient(signal);
    const [bankResult, providers, googleResult, githubResult] = await awaitWithSignal(Promise.all([
      supabase.from("bank_connections").select("user_id,status,last_synced_at,provider", { count: "exact" })
        .eq("user_id", user.id).limit(51).abortSignal(signal),
      providerAvailability(user.id, signal),
      admin.from("google_oauth").select("user_id").eq("user_id", user.id).abortSignal(signal).maybeSingle(),
      admin.from("github_tokens").select("user_id").eq("user_id", user.id).abortSignal(signal).maybeSingle(),
    ]), signal);
    const banks = z.array(bankRow).max(50).parse(bankResult.data);
    if (bankResult.error || googleResult.error || githubResult.error || !Array.isArray(banks)
      || !Number.isSafeInteger(bankResult.count) || bankResult.count !== banks.length || banks.length > 50
      || banks.some(item => item.user_id !== user.id)
      || (googleResult.data && googleResult.data.user_id !== user.id)
      || (githubResult.data && githubResult.data.user_id !== user.id)) throw new Error("Integration status unavailable");
    const connectedProviders = new Set(banks.filter(item => item.status === "linked").map(item => item.provider));
    const lastSync = banks.map(item => item.last_synced_at).filter((value): value is string => typeof value === "string")
      .sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;
    const result = integrationStatusSchema.parse({
      google: { connected: Boolean(googleResult.data), configured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) },
      github: { connected: Boolean(githubResult.data), configured: Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET) },
      bank: { connected: connectedProviders.size > 0, configured: providers.some(provider => provider.configured), last_synced_at: lastSync,
        providers: providers.map(provider => ({ ...provider, connected: connectedProviders.has(provider.id) })) },
      email: { configured: Boolean(process.env.RESEND_API_KEY) },
    });
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json({ error: "Integration status unavailable." }, { status: 503, headers });
  }
}
