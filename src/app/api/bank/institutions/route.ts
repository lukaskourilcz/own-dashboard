import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/bank/registry";
import { UnknownBankProviderError } from "@/lib/bank/provider";

/**
 * List the banks a provider offers for a country (default Czech Republic) so
 * the UI can render a picker. Requires a signed-in user; returns a trimmed
 * shape. Providers without an institution picker — a token API such as Fio —
 * answer 503 rather than an empty list, so the dialog can say why.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const url = new URL(request.url);
  const country = (url.searchParams.get("country") ?? "cz").slice(0, 2).toLowerCase();
  const providerId = url.searchParams.get("provider") ?? "gocardless";

  let provider;
  try {
    provider = getProvider(providerId);
  } catch (err) {
    if (err instanceof UnknownBankProviderError) {
      return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
    }
    throw err;
  }

  if (!provider.listInstitutions || !(await provider.isConfigured(user.id))) {
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }

  try {
    const institutions = await provider.listInstitutions(country);
    return NextResponse.json({ provider: provider.id, institutions });
  } catch (err) {
    console.error("[api/bank/institutions] failed:", err);
    return NextResponse.json(
      { error: "Could not load banks." },
      { status: 502 },
    );
  }
}
