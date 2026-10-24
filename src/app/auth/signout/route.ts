import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeGoogleAccess } from "@/lib/google-token";
import { rejectCrossOrigin } from "@/lib/csrf";
import { awaitWithSignal } from "@/lib/abortable";

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  const headers = { "cache-control": "private, no-store" };
  const signal = AbortSignal.timeout(25_000);
  try {
    const supabase = await createClient(signal);
    const { data: { user } } = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (user) {
      try {
        const revokeSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
        const receipt = await awaitWithSignal(revokeGoogleAccess(user.id, revokeSignal), revokeSignal);
        if (!receipt.upstreamRevoked) console.error("[auth/signout] google-revocation-unconfirmed");
      } catch { console.error("[auth/signout] google-revocation-unconfirmed"); }
    }
    signal.throwIfAborted();
    const result = await awaitWithSignal(supabase.auth.signOut(), signal);
    if (result.error) throw Error();
    return request.headers.get("accept")?.includes("application/json")
      ? NextResponse.json({ ok: true }, { headers })
      : NextResponse.redirect(new URL("/login", request.url), { status: 303, headers });
  } catch {
    return NextResponse.json({ error: "Sign-out could not be confirmed. Try again." }, { status: 503, headers });
  }
}
