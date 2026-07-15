import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Rate limiting for the App-Router API routes, with two backends behind one
// call:
//
//   1. Upstash Redis (distributed) — used automatically when
//      UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set. Holds across
//      every serverless instance; the right choice once an AI route can cost
//      real money.
//   2. In-memory sliding counter — the fallback when Upstash isn't configured,
//      or if a Redis call fails (so we never hard-fail a request on the
//      limiter). Per-instance only, but enough to blunt obvious abuse.

export type RateLimitConfig = {
  /** Namespace so different routes don't share a budget. */
  key: string;
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
};

export type RateLimitResult = { ok: boolean; retryAfter: number };

/* ---- in-memory fallback -------------------------------------------------- */

const buckets = new Map<string, { count: number; resetAt: number }>();

function inMemory(id: string, cfg: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const k = `${cfg.key}:${id}`;
  const e = buckets.get(k);
  if (!e || e.resetAt <= now) {
    buckets.set(k, { count: 1, resetAt: now + cfg.windowSec * 1000 });
    return { ok: true, retryAfter: 0 };
  }
  if (e.count >= cfg.limit) {
    return { ok: false, retryAfter: Math.ceil((e.resetAt - now) / 1000) };
  }
  e.count += 1;
  return { ok: true, retryAfter: 0 };
}

/* ---- distributed backend (Upstash) --------------------------------------- */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const limiterCache = new Map<string, Ratelimit>();
let redisClient: Redis | null = null;

/** A cached Upstash limiter for this config, or null when unconfigured. */
function getUpstash(cfg: RateLimitConfig): Ratelimit | null {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const cached = limiterCache.get(cfg.key);
  if (cached) return cached;
  if (!redisClient) {
    redisClient = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
  }
  const limiter = new Ratelimit({
    redis: redisClient,
    // `capacity` requests per `windowSec` seconds.
    limiter: Ratelimit.slidingWindow(cfg.limit, `${cfg.windowSec} s` as `${number} s`),
    prefix: `rl:${cfg.key}`,
    analytics: false,
  });
  limiterCache.set(cfg.key, limiter);
  return limiter;
}

/** Consume one unit for `id`. Prefers Upstash, falls back to in-memory. */
export async function rateLimit(
  id: string,
  cfg: RateLimitConfig,
): Promise<RateLimitResult> {
  const limiter = getUpstash(cfg);
  if (!limiter) return inMemory(id, cfg);
  try {
    const { success, reset } = await limiter.limit(id);
    return {
      ok: success,
      retryAfter: success ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
    };
  } catch {
    return inMemory(id, cfg);
  }
}

/** Best-effort client IP from proxy headers, for anonymous-request keys. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
