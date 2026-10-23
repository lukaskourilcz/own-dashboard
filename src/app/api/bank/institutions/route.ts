import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { bankInstitutionsResponse } from "@/lib/bank/flow";
import { createClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/bank/registry";

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
  const parsed = z.object({ country: z.string().regex(/^[a-zA-Z]{2}$/), provider: z.enum(["gocardless", "fio", "enable-banking"]) }).safeParse({
    country: url.searchParams.get("country") ?? "cz", provider: url.searchParams.get("provider") ?? "gocardless",
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid query." }, { status: 400 });
  const limited = await rateLimit(user.id, { key: "bank-institutions", limit: 10, windowSec: 60 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  try {
    const provider = getProvider(parsed.data.provider);
    if (!provider.listInstitutions || !(await provider.isConfigured(user.id))) return NextResponse.json({ error: "not-configured" }, { status: 503 });
    const { institutions } = bankInstitutionsResponse.parse({ institutions: await provider.listInstitutions(parsed.data.country.toLowerCase()) });
    if (new Set(institutions.map(institution => institution.id)).size !== institutions.length) throw new Error("Invalid institution list");
    return NextResponse.json({ provider: provider.id, institutions }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Could not load banks." },
      { status: 502 },
    );
  }
}
