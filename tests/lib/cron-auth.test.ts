import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// A route that gets past the gate reaches the service-role client first; this
// stand-in proves it got there without touching a database.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("admin-reached");
  },
}));

import { bearerMatches, bearerToken } from "@/lib/cron-auth";
import * as bankSync from "@/app/api/cron/bank-sync/route";
import * as jobsScrape from "@/app/api/cron/jobs-scrape/route";
import * as paymentMatch from "@/app/api/cron/payment-match/route";
import * as renewalWarnings from "@/app/api/cron/renewal-warnings/route";

const cronDir = new URL("../../src/app/api/cron/", import.meta.url);
const cronRoutes = readdirSync(cronDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const handlers: Record<string, (request: Request) => Promise<Response>> = {
  "bank-sync": bankSync.GET,
  "jobs-scrape": jobsScrape.GET,
  "payment-match": paymentMatch.GET,
  "renewal-warnings": renewalWarnings.GET,
};

function call(name: string, authorization?: string) {
  const headers = authorization ? { authorization } : undefined;
  return handlers[name](
    new Request(`https://example.test/api/cron/${name}`, { headers }),
  );
}

describe("bearerMatches", () => {
  it("accepts exactly Bearer <secret>", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects a wrong, missing or differently sized token", () => {
    expect(bearerMatches("Bearer nope", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer s3cret-and-more", "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
    expect(bearerMatches(null, "s3cret")).toBe(false);
  });

  it("fails closed when the secret is unset or blank", () => {
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer    ", "   ")).toBe(false);
  });

  it("reads the token after the scheme", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("/api/cron routes", () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => {
    delete process.env.CRON_SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  it("covers every route in src/app/api/cron", () => {
    expect(cronRoutes).toEqual(Object.keys(handlers).sort());
  });

  it("call the shared gate before anything else", () => {
    for (const name of cronRoutes) {
      const source = readFileSync(new URL(`${name}/route.ts`, cronDir), "utf8");
      expect(source, name).not.toMatch(/process\.env\.CRON_SECRET/);
      const body = source.slice(source.indexOf("export async function GET"));
      expect(body, name).toMatch(
        /^export async function GET\(request: Request\) \{\s+const rejected = rejectUnlessCron\(request\);\s+if \(rejected\) return rejected;/,
      );
    }
  });

  it.each(Object.keys(handlers))(
    "%s refuses every call while CRON_SECRET is unset",
    async (name) => {
      for (const header of [undefined, "Bearer ", "Bearer undefined", "Bearer x"]) {
        const res = await call(name, header);
        expect(res.status, String(header)).toBe(403);
      }
    },
  );

  it.each(Object.keys(handlers))(
    "%s refuses a wrong secret",
    async (name) => {
      process.env.CRON_SECRET = "the-real-secret";
      expect((await call(name)).status).toBe(403);
      expect((await call(name, "Bearer the-wrong-secret")).status).toBe(403);
      expect((await call(name, "the-real-secret")).status).toBe(403);
    },
  );

  it.each(Object.keys(handlers))(
    "%s lets Vercel Cron's header through",
    async (name) => {
      process.env.CRON_SECRET = "the-real-secret";
      const outcome = await call(name, "Bearer the-real-secret").then(
        (res) => res.status,
        (err: Error) => err.message,
      );
      expect(outcome).not.toBe(403);
    },
  );
});
