import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { marketingPilotConfiguration, type MarketingPilot } from "@/lib/marketing/pilot";
import { previewPilotRetired } from "@/lib/marketing/preview-pilot";

function activePilot(): MarketingPilot | null {
  if (previewPilotRetired("generation-pilot", process.env)) return null;
  try {
    return marketingPilotConfiguration(process.env.MARKETING_PILOT_OWNER_ID ?? "");
  } catch {
    return null;
  }
}

function privateResponse(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function held(status: number): NextResponse {
  return privateResponse(NextResponse.json({ error: status === 404 ? "not_found" : "auth_failed" }, { status }));
}

function destination(raw: string | null, origin: string): URL {
  const fallback = new URL("/marketing", origin);
  if (!raw || raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//") ||
      /[\u0000-\u0020\u007f\\]/.test(raw) || /%(?:2f|5c)/i.test(raw)) return fallback;
  try {
    const target = new URL(raw, origin);
    return target.origin === origin && !target.username && !target.password ? target : fallback;
  } catch {
    return fallback;
  }
}

/** A real one-time Auth exchange, available only inside the bounded preview pilot. */
export async function GET(request: NextRequest) {
  const pilot = activePilot();
  if (!pilot) return held(404);
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  if (searchParams.get("type") !== "email" || !tokenHash || !/^[A-Za-z0-9_-]{32,256}$/.test(tokenHash) ||
      [...searchParams.keys()].some((key) => !["token_hash", "type", "next"].includes(key)) ||
      ["token_hash", "type", "next"].some((key) => searchParams.getAll(key).length > 1)) return held(400);

  // The ordinary helper commits immediately. Buffer the official SDK's writes
  // here so a foreign verified user can never receive a new session cookie.
  const pending = new Map<string, Parameters<SetAllCookies>[0][number]>();
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => { for (const cookie of cookies) pending.set(cookie.name, cookie); },
      } },
    );
    const reject = async (status: number): Promise<NextResponse> => {
      try { await supabase.auth.signOut({ scope: "local" }); } catch { /* No SDK cookies are committed. */ }
      return held(activePilot() ? status : 404);
    };
    try {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
      if (error || !data.user || !data.session || data.user.id !== pilot.ownerId ||
          data.session.user.id !== pilot.ownerId) return reject(401);
      const current = activePilot();
      if (!current || current.ownerId !== pilot.ownerId || current.startsAt !== pilot.startsAt ||
          current.expiresAt !== pilot.expiresAt) return reject(404);
      const response = privateResponse(NextResponse.redirect(destination(searchParams.get("next"), origin), 303));
      for (const { name, value, options } of pending.values()) response.cookies.set(name, value, options);
      return response;
    } catch {
      return reject(401);
    }
  } catch {
    return held(activePilot() ? 503 : 404);
  }
}
