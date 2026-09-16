import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { providerAvailability } from "@/lib/bank/registry";

/**
 * Connection and configuration state only. Every value here is a boolean or a
 * timestamp: no token, key or secret may ever enter this response, which is
 * what the Settings note promises the reader.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: banks } = await supabase.from("bank_connections").select("status,last_synced_at,institution_name,provider").eq("user_id", user.id);
  // Which providers are usable is the registry's answer, not a GoCardless env
  // check: an install with only a Fio token must not report bank sync as off.
  const providers = await providerAvailability(user.id);
  const connectedProviders = new Set((banks ?? []).filter((item) => item.status === "linked").map((item) => item.provider as string));
  let google = false;
  let github = false;
  try {
    const admin = createAdminClient();
    const [googleResult, githubResult] = await Promise.all([
      admin.from("google_oauth").select("user_id").eq("user_id", user.id).maybeSingle(),
      admin.from("github_tokens").select("user_id").eq("user_id", user.id).maybeSingle(),
    ]);
    google = Boolean(googleResult.data);
    github = Boolean(githubResult.data);
  } catch {
    // Local environments without a service-role key can still report the
    // user's own bank rows and configured provider availability.
  }

  return NextResponse.json({
    google: { connected: google, configured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) },
    github: { connected: github, configured: Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET) },
    bank: { connected: (banks ?? []).some((item) => item.status === "linked"), configured: providers.some((provider) => provider.configured), last_synced_at: (banks ?? []).map((item) => item.last_synced_at).filter(Boolean).sort().at(-1) ?? null, providers: providers.map((provider) => ({ id: provider.id, label: provider.label, configured: provider.configured, connected: connectedProviders.has(provider.id) })) },
    email: { configured: Boolean(process.env.RESEND_API_KEY) },
  }, { headers: { "cache-control": "private, no-store" } });
}
