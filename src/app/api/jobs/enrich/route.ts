import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { jobPageTitleFields, normalizeJobUrl } from "@/lib/jobs/enrich";

type JinaResponse = {
  data?: { title?: string; description?: string; content?: string; url?: string };
};

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const limited = await rateLimit(user.id, { key: "job-enrich", limit: 20, windowSec: 60 });
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { url?: string };
  const url = normalizeJobUrl(body.url ?? "");
  if (!url) return NextResponse.json({ error: "A valid URL is required." }, { status: 400 });

  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "application/json",
        "X-Return-Format": "markdown",
        ...(process.env.JINA_API_KEY ? { Authorization: `Bearer ${process.env.JINA_API_KEY}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(String(response.status));
    const page = (await response.json()) as JinaResponse;
    const data = page.data ?? {};
    const fields = jobPageTitleFields(data.title ?? "");
    const description = (data.content || data.description || "").trim().slice(0, 30_000);
    if (!fields.title) throw new Error("missing-title");
    return NextResponse.json({ url: data.url || url, ...fields, description });
  } catch {
    return NextResponse.json(
      { error: "Could not read that page. Complete the fields manually." },
      { status: 502 },
    );
  }
}
