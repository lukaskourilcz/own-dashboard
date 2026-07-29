import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/ai-links/enrich  { url }
 *
 * "Auto-fill" for the AI-links form. Reads the target page with Jina Reader
 * (https://r.jina.ai — keyless; JINA_API_KEY optional to raise limits) to get a
 * real title + description. Read-only: it never writes to Supabase; the client
 * applies the result to the form.
 */

type Body = { url?: string };

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

async function readWithJina(
  url: string,
): Promise<{ title: string; description: string } | null> {
  const jinaKey = process.env.JINA_API_KEY;
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "application/json",
        "X-Return-Format": "markdown",
        ...(jinaKey ? { Authorization: `Bearer ${jinaKey}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { title?: string; description?: string };
    };
    const d = json.data ?? {};
    return {
      title: (d.title ?? "").trim(),
      description: (d.description ?? "").trim(),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const rl = await rateLimit(user.id, {
    key: "ai-enrich",
    limit: 20,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const url = normalizeUrl(body.url ?? "");
  if (!url) {
    return NextResponse.json({ error: "A valid URL is required." }, { status: 400 });
  }

  const page = await readWithJina(url);
  if (!page || !page.title) {
    return NextResponse.json(
      { error: "Couldn't read that page. Fill the fields in manually." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    title: page.title,
    description: page.description,
    category_id: null,
    pricing: null,
  });
}
