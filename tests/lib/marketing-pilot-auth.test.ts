import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CookieMethodsServer } from "@supabase/ssr";

const mocks = vi.hoisted(() => ({ create: vi.fn(), verify: vi.fn(), signOut: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: (...args: unknown[]) => mocks.create(...args) }));
import { GET } from "@/app/api/auth/marketing-pilot/confirm/route";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const tokenHash = "a".repeat(64);
let cookieAdapter: CookieMethodsServer;
function request(next?: string) {
  const url = new URL("https://preview.example.test/api/auth/marketing-pilot/confirm");
  url.searchParams.set("token_hash", tokenHash); url.searchParams.set("type", "email");
  if (next !== undefined) url.searchParams.set("next", next);
  return new NextRequest(url, { headers: { Cookie: "existing=test-only-existing-cookie" } });
}
function verified(user = owner, sessionUser = user) {
  cookieAdapter.setAll?.([{ name: "sb-test-auth-token", value: "test-only-sdk-session", options: { path: "/", httpOnly: true, sameSite: "lax" } }], {});
  return { data: { user: { id: user }, session: { user: { id: sessionUser } } }, error: null };
}
function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toContain("private");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("MARKETING_PILOT_OWNER_ID", owner);
  vi.stubEnv("MARKETING_PILOT_STARTS_AT", "2026-10-13T09:11:07Z"); vi.stubEnv("MARKETING_PILOT_EXPIRES_AT", "2026-10-15T09:10:00Z");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-only.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-only-publishable-key");
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.create.mockImplementation((_url: string, _key: string, options: { cookies: CookieMethodsServer }) => {
    cookieAdapter = options.cookies; return { auth: { verifyOtp: mocks.verify, signOut: mocks.signOut } };
  });
  mocks.verify.mockImplementation(async () => verified()); mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("real OTP exchange restricted to the preview marketing pilot", () => {
  it.each(["production", "development", ""])("returns private 404 without Auth calls in %s", async (env) => {
    vi.stubEnv("VERCEL_ENV", env); const response = await GET(request());
    expect(response.status).toBe(404); expectPrivate(response); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([
    { MARKETING_PILOT_OWNER_ID: undefined },
    { MARKETING_PILOT_OWNER_ID: "not-a-uuid" },
    { MARKETING_PILOT_STARTS_AT: "2026-10-14T00:00:00Z" },
    { MARKETING_PILOT_EXPIRES_AT: "2026-10-13T12:00:00Z" },
    { MARKETING_PILOT_EXPIRES_AT: "2026-10-16T00:00:00Z" },
  ])("hides partial, malformed or inactive pilot configuration %j", async (patch) => {
    for (const [name, value] of Object.entries(patch)) vi.stubEnv(name, value);
    const response = await GET(request()); expect(response.status).toBe(404); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("hides an absent pilot tuple rather than inheriting ordinary admission", async () => {
    for (const name of ["MARKETING_PILOT_OWNER_ID", "MARKETING_PILOT_STARTS_AT", "MARKETING_PILOT_EXPIRES_AT"]) vi.stubEnv(name, undefined);
    expect((await GET(request())).status).toBe(404); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("uses real verifyOtp inputs and commits only SDK cookies after both owner identities match", async () => {
    const input = request("/marketing?brand=devshark"); const response = await GET(input);
    expect(mocks.verify).toHaveBeenCalledWith({ token_hash: tokenHash, type: "email" });
    expect(cookieAdapter.getAll()).toEqual([{ name: "existing", value: "test-only-existing-cookie" }]);
    expect(input.cookies.getAll()).toEqual([{ name: "existing", value: "test-only-existing-cookie" }]);
    expect(response.status).toBe(303); expect(response.headers.get("Location")).toBe("https://preview.example.test/marketing?brand=devshark");
    expect(response.headers.get("Set-Cookie")).toContain("sb-test-auth-token=test-only-sdk-session");
    expect(response.headers.get("Location")).not.toContain(tokenHash); expectPrivate(response); expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it.each([[other, other], [owner, other], [other, owner]])("never commits foreign user/session cookies (%s, %s), even if signOut fails", async (user, sessionUser) => {
    mocks.verify.mockImplementation(async () => verified(user, sessionUser)); mocks.signOut.mockRejectedValue(new Error("test-only-network-failure"));
    const response = await GET(request()); expect(response.status).toBe(401); expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Location")).toBeNull(); expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" }); expectPrivate(response);
  });
  it("discards every buffered cookie on a verification error or throw", async () => {
    for (const throws of [false, true]) {
      mocks.verify.mockImplementation(async () => { verified(); if (throws) throw new Error("test-only-token-error"); return { data: { user: null, session: null }, error: { message: "test-only-token-error" } }; });
      const response = await GET(request()); expect(response.status).toBe(401); expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(await response.text()).not.toContain(tokenHash); expectPrivate(response);
    }
  });
  it("requires a real returned session as well as the real returned user", async () => {
    mocks.verify.mockImplementation(async () => { verified(); return { data: { user: { id: owner }, session: null }, error: null }; });
    const response = await GET(request()); expect(response.status).toBe(401); expect(response.headers.get("Set-Cookie")).toBeNull();
  });
  it("rechecks expiry after the OTP network wait before committing any cookies", async () => {
    mocks.verify.mockImplementation(async () => { const data = verified(); vi.setSystemTime(new Date("2026-10-15T09:10:00Z")); return data; });
    mocks.signOut.mockRejectedValue(new Error("test-only-network-failure"));
    const response = await GET(request()); expect(response.status).toBe(404); expect(response.headers.get("Set-Cookie")).toBeNull(); expect(response.headers.get("Location")).toBeNull();
  });
  it("holds changed pilot ownership during verification", async () => {
    mocks.verify.mockImplementation(async () => { const result = verified(); vi.stubEnv("MARKETING_PILOT_OWNER_ID", other); return result; });
    const response = await GET(request()); expect(response.status).toBe(404); expect(response.headers.get("Set-Cookie")).toBeNull();
  });
  it.each(["https://foreign.example/", "//foreign.example/", "/\\foreign.example/", "/%2f%2fforeign.example/", "/%5cforeign.example/", "/\n/foreign.example/"])("defaults unsafe next=%j to the same-origin marketing view", async (next) => {
    const response = await GET(request(next)); expect(response.status).toBe(303); expect(response.headers.get("Location")).toBe("https://preview.example.test/marketing");
  });
  it("rejects non-email types, duplicate token parameters and oversized tokens before Auth", async () => {
    for (const modify of [
      (url: URL) => url.searchParams.set("type", "recovery"),
      (url: URL) => url.searchParams.append("token_hash", tokenHash),
      (url: URL) => url.searchParams.set("token_hash", "a".repeat(257)),
    ]) {
      const url = new URL(request().url); modify(url); const response = await GET(new NextRequest(url));
      expect(response.status).toBe(400); expect(response.headers.get("Set-Cookie")).toBeNull(); expectPrivate(response);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
