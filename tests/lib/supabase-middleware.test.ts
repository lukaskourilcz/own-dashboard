import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CookieMethodsServer } from "@supabase/ssr";
const state = vi.hoisted(() => ({ user: true, calls: 0, refresh: true, twice: false }));
vi.mock("@supabase/ssr", () => ({ createServerClient: (_url: string, _key: string, { cookies }: { cookies: CookieMethodsServer }) => {
  state.calls++;
  return { auth: { getUser: async () => {
    if (state.refresh) await cookies.setAll!([
      { name: "audit-session.0", value: "synthetic-session-only", options: { path: "/", secure: true, sameSite: "lax", maxAge: 3600 } },
      { name: "audit-session.1", value: "", options: { path: "/", maxAge: 0 } },
    ], { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Expires: "0", Pragma: "no-cache" });
    if (state.twice) await cookies.setAll!([{ name: "audit-second", value: "synthetic-second-only", options: { path: "/" } }], {});
    return { data: { user: state.user ? { id: "owner" } : null } };
  } } };
} }));
import { updateSession } from "@/lib/supabase/middleware";
beforeEach(() => { state.user = true; state.calls = 0; state.refresh = true; state.twice = false; });
it.each([[false, "/projects", "/login"], [true, "/login", "/"]] as const)("retains refresh and deletion cookies with cache headers on redirect (%s)", async (user, path, target) => {
  state.user = user;
  const request = new NextRequest(`https://app.example${path}?audit=1`), response = await updateSession(request);
  expect(response.status).toBe(307); expect(response.headers.get("location")).toBe(`https://app.example${target}?audit=1`);
  expect(response.cookies.get("audit-session.0")).toMatchObject({ value: "synthetic-session-only", path: "/", secure: true, sameSite: "lax", maxAge: 3600 });
  expect(response.cookies.get("audit-session.1")).toMatchObject({ value: "", maxAge: 0 });
  expect(request.cookies.get("audit-session.0")?.value).toBe("synthetic-session-only");
  expect(response.headers.get("cache-control")).toContain("private"); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("expires")).toBe("0"); expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.has("x-middleware-next")).toBe(false);
  expect(response.headers.has("x-middleware-request-cookie")).toBe(false);
});
it("retains all refresh state across repeated SDK callbacks on the normal response", async () => {
  state.twice = true;
  const response = await updateSession(new NextRequest("https://app.example/projects"));
  expect(response.status).toBe(200); expect(response.cookies.getAll()).toHaveLength(3); expect(response.headers.get("cache-control")).toContain("no-store");
});
it.each(["/guest", "/guest/example", "/dev-preview", "/dev-preview/example", "/api/bank/sync"])("keeps the intentional public/self-authenticating boundary for %s", async path => {
  expect((await updateSession(new NextRequest(`https://app.example${path}`))).status).toBe(200); expect(state.calls).toBe(0);
});
it.each(["/guestbook", "/dev-preview-other", "/apiculture", "/author", "/login-other"])("does not treat an unrelated route as a public prefix: %s", async path => {
  state.user = false; state.refresh = false;
  expect((await updateSession(new NextRequest(`https://app.example${path}`))).status).toBe(307); expect(state.calls).toBe(1);
});
it("does not invent refreshed cookie state when the SDK makes no change", async () => {
  state.refresh = false;
  const response = await updateSession(new NextRequest("https://app.example/projects"));
  expect(response.cookies.getAll()).toEqual([]); expect(response.headers.has("cache-control")).toBe(false);
});
