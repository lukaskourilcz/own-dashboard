import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { ARES_SUBJECT_ENDPOINT, isValidIco, mapAresSubject, normalizeIco } from "@/lib/tax-registry";

/**
 * Look one Czech IČO up in the public ARES economic-subject register.
 *
 * Credential-free: no account, no API key, no environment variable. The only
 * thing that leaves the deployment is the registration number being looked up.
 * Nothing is written here — the browser mutation owns the Supabase write, so
 * own-only RLS applies unchanged.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const limited = await rateLimit(user.id, { key: "registry-ares", limit: 20, windowSec: 60 });
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { ico?: string };
  const ico = normalizeIco(body.ico ?? "");
  if (!isValidIco(ico)) {
    return NextResponse.json({ error: "invalid-ico" }, { status: 400 });
  }

  try {
    const response = await fetch(`${ARES_SUBJECT_ENDPOINT}/${ico}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    if (!response.ok) throw new Error(String(response.status));
    // Only the mapped fields are returned; the raw register payload is large
    // and carries data this product has no use for.
    const subject = mapAresSubject(await response.json());
    if (!subject) throw new Error("unmapped");
    return NextResponse.json({ ...subject, checkedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "ares-unavailable" }, { status: 502 });
  }
}
