import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ user: true, limited: false, revoke: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null } }) } }) }));
vi.mock("@/lib/github-token", () => ({ revokeGitHubAccess: state.revoke }));
vi.mock("@/lib/google-token", () => ({ revokeGoogleAccess: state.revoke }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: !state.limited, retryAfter: 60 }) }));
import { POST as github } from "@/app/api/github/disconnect/route";
import { POST as google } from "@/app/api/google/disconnect/route";
beforeEach(() => { state.user = true; state.limited = false; state.revoke.mockReset().mockResolvedValue({ upstreamRevoked: false }); });
const request = (origin = "https://app.example") => new Request("https://app.example/api/provider/disconnect", { method: "POST", headers: { origin } });
for (const route of [google, github]) {
  it("retains owner/origin/rate boundaries before revocation", async () => {
    expect((await route(request("https://other.example"))).status).toBe(403); state.user = false; expect((await route(request())).status).toBe(401); state.user = true;
    state.limited = true; expect((await route(request())).status).toBe(429); expect(state.revoke).not.toHaveBeenCalled();
  });
  it("reports local-only confirmation separately and redacts failed removal", async () => {
    const response = await route(request()); expect(await response.json()).toEqual({ ok: true, upstreamRevoked: false }); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(state.revoke).toHaveBeenCalledWith("owner");
    state.revoke.mockRejectedValue(Error("synthetic-private")); const failed = await route(request()); expect(failed.status).toBe(500); expect(await failed.text()).not.toContain("synthetic-private");
  });
}
