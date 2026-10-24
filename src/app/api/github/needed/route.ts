import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGitHubFetcher } from "@/lib/github-token";
import { rejectCrossOrigin } from "@/lib/csrf";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { rateLimit } from "@/lib/rate-limit";
import { neededBatchInput, neededBatchResultSchema } from "@/lib/needed-batch-contract";
import { readNeededBatch } from "@/lib/needed-batch-server";
export const maxDuration = 30;
const headers = { "cache-control": "private, no-store" };
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  try {
    const client = await createClient(signal);
    const { data: { user } } = await awaitWithSignal(client.auth.getUser(), signal);
    if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
    const body = await awaitWithSignal(readTextPrefix(new Response(request.body), 65_536), signal);
    if (body.truncated) return NextResponse.json({ error: "Request too large." }, { status: 413, headers });
    let json: unknown;
    try { json = JSON.parse(body.text); } catch { return NextResponse.json({ error: "Invalid repository request." }, { status: 400, headers }); }
    const input = neededBatchInput.safeParse(json);
    if (!input.success) return NextResponse.json({ error: "Invalid repository request." }, { status: 400, headers });
    const limited = await awaitWithSignal(rateLimit(user.id, { key: "github-needed", limit: 6, windowSec: 60 }), signal);
    if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { ...headers, "retry-after": String(limited.retryAfter) } });
    const result = await readNeededBatch(input.data.repos, createGitHubFetcher(user.id, signal), signal);
    return NextResponse.json(neededBatchResultSchema.parse(result), { headers });
  } catch { return NextResponse.json({ error: "Repository lists unavailable." }, { status: 503, headers }); }
}
