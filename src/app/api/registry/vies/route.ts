import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { EU_VAT_COUNTRIES, mapViesResult, parseVatId, VIES_CHECK_ENDPOINT } from "@/lib/tax-registry";

/**
 * Check one EU VAT number against the public VIES REST service.
 *
 * Credential-free, and nothing is written here: the browser mutation owns the
 * Supabase write, so own-only RLS applies unchanged.
 *
 * VIES forwards the question to the member state that issued the number, and
 * those national services go down routinely. An outage therefore answers 200
 * with `status: "unavailable"` rather than a 5xx — a failed request must be
 * visible as an unfinished check, not as a broken dashboard, and must never
 * read as an invalid VAT id.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const limited = await rateLimit(user.id, { key: "registry-vies", limit: 20, windowSec: 60 });
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { vatId?: string };
  const parsed = parseVatId(body.vatId ?? "");
  if (!parsed || !EU_VAT_COUNTRIES.has(parsed.countryCode)) {
    return NextResponse.json({ error: "not-eu-vat-id" }, { status: 400 });
  }

  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(VIES_CHECK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ countryCode: parsed.countryCode, vatNumber: parsed.number }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(String(response.status));
    const result = mapViesResult(await response.json());
    return NextResponse.json({ ...result, vatId: `${parsed.countryCode}${parsed.number}`, checkedAt });
  } catch {
    return NextResponse.json({
      status: "unavailable",
      name: "",
      address: "",
      vatId: `${parsed.countryCode}${parsed.number}`,
      checkedAt,
    });
  }
}
