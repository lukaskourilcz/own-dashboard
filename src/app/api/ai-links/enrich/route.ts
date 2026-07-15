import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/ai-links/enrich  { url, categories?: {id,name}[] }
 *
 * "Auto-fill" for the AI-links form. Reads the target page with Jina Reader
 * (https://r.jina.ai — keyless; JINA_API_KEY optional to raise limits) to get a
 * real title + description, and — when ANTHROPIC_API_KEY is set — asks Claude
 * Haiku to pick the best-matching category from the user's own list, tighten
 * the description, and guess a pricing tier (free / freemium / paid).
 *
 * Degrades cleanly: no Jina reachability → 502; no Anthropic key → returns the
 * Jina title/description with category/pricing left null. Read-only: it never
 * writes to Supabase, the client applies the result to the form.
 */

type Body = { url?: string; categories?: Array<{ id: string; name: string }> };

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
): Promise<{ title: string; description: string; content: string } | null> {
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
      data?: { title?: string; description?: string; content?: string };
    };
    const d = json.data ?? {};
    return {
      title: (d.title ?? "").trim(),
      description: (d.description ?? "").trim(),
      content: (d.content ?? "").slice(0, 4000),
    };
  } catch {
    return null;
  }
}

const PRICING = new Set(["free", "freemium", "paid"]);

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

  // 20 enrichments/min/user — Jina + a model call are not free to spam.
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
  if (!page || (!page.title && !page.content)) {
    return NextResponse.json(
      { error: "Couldn't read that page. Fill the fields in manually." },
      { status: 502 },
    );
  }

  const result: {
    title: string;
    description: string;
    category_id: string | null;
    pricing: string | null;
  } = {
    title: page.title,
    description: page.description,
    category_id: null,
    pricing: null,
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const categories = Array.isArray(body.categories) ? body.categories : [];
  if (apiKey && (page.title || page.content)) {
    try {
      const baseURL = process.env.ANTHROPIC_BASE_URL?.trim();
      const client = new Anthropic(baseURL ? { apiKey, baseURL } : { apiKey });
      const catNames = categories.map((c) => c.name);
      const msg = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system:
          "You catalogue AI/developer tools for a personal dashboard. Given a page, " +
          "return STRICT JSON only (no prose) with keys: " +
          '"description" (<=120 chars, plain, what the tool is good for), ' +
          '"category" (choose the single best from the provided list, or null if none fit), ' +
          '"pricing" (one of "free","freemium","paid", or null if unclear). ' +
          '"freemium" means a real free tier plus paid plans.',
        messages: [
          {
            role: "user",
            content:
              `Categories: ${catNames.length ? catNames.join(", ") : "(none)"}\n\n` +
              `Title: ${page.title}\n\n` +
              `Page content:\n${page.content}`,
          },
        ],
      });
      const text = msg.content.find((b) => b.type === "text");
      if (text && "text" in text) {
        const match = text.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as {
            description?: string;
            category?: string;
            pricing?: string;
          };
          if (parsed.description) result.description = parsed.description.slice(0, 200);
          if (parsed.pricing && PRICING.has(parsed.pricing)) result.pricing = parsed.pricing;
          if (parsed.category) {
            const hit = categories.find(
              (c) => c.name.toLowerCase() === parsed.category!.toLowerCase(),
            );
            if (hit) result.category_id = hit.id;
          }
        }
      }
    } catch {
      // Model failed — keep the Jina title/description; not fatal.
    }
  }

  return NextResponse.json(result);
}
