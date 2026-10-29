import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ session: {} as Record<string, unknown>, failed: false, exchange: vi.fn(), google: vi.fn(), github: vi.fn(), verify: vi.fn(), revoke: vi.fn(), getUser: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: state.exchange, getUser: state.getUser, signOut: state.signOut } }) }));
vi.mock("@/lib/google-token", () => ({ storeGoogleTokens: state.google, revokeGoogleAccess: state.revoke }));
vi.mock("@/lib/github-token", () => ({ storeGitHubTokens: state.github }));
vi.mock("@/lib/oauth-grant-verification", () => ({ verifyOAuthGrant: state.verify }));
import { GET } from "@/app/auth/callback/route";
import { POST as signOut } from "@/app/auth/signout/route";
beforeEach(() => {
  vi.restoreAllMocks(); state.session = {}; state.failed = false;
  state.google.mockReset(); state.github.mockReset(); state.verify.mockReset().mockResolvedValue(null);
  state.getUser.mockReset().mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  state.revoke.mockReset().mockResolvedValue({ upstreamRevoked: true }); state.signOut.mockReset().mockResolvedValue({ error: null });
  state.exchange.mockReset().mockImplementation(async () => ({ data: { session: state.session, user: { id: "owner", user_metadata: {}, identities: [] } }, error: state.failed ? {} : null }));
});
const callback = (next: string, extra = "") => GET(new Request(`https://app.example/auth/callback?code=synthetic-code&next=${encodeURIComponent(next)}${extra}`));
it.each(["https://elsewhere.example/", "//elsewhere.example", "/\\elsewhere.example", "/\n/elsewhere.example", "/\t/elsewhere.example", "/\r/elsewhere.example", "/\\name:synthetic@app.example/path", "javascript:alert(1)"])("keeps a normalized hostile redirect on the app origin (%#)", async next => {
  expect((await callback(next)).headers.get("location")).toBe("https://app.example/");
});
it.each(["/projects/example?tab=notes#draft", "/safe/..//elsewhere.example", "/?capture=1"])("preserves safe internal destinations without reparsing the normalized path (%#)", async next => {
  const target = (await callback(next)).headers.get("location")!;
  expect(new URL(target).origin).toBe("https://app.example"); expect(target).toBe(new URL(next, "https://app.example").href);
});
it("failed session exchange never follows next, even when it is valid", async () => {
  state.failed = true; expect((await callback("/projects")).headers.get("location")).toBe("https://app.example/login?error=auth");
});
it("logs fixed storage failure codes without private provider causes", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  state.session = { provider_token: "synthetic-inert-fixture", provider_refresh_token: "synthetic-inert-refresh-fixture" };
  state.verify.mockResolvedValueOnce({ provider: "google", accessToken: "synthetic-access", refreshToken: "synthetic-refresh", googleSub: "trusted-sub", expiresInSeconds: 3600, scopes: [] });
  state.google.mockRejectedValue(new Error("Synthetic private provider cause"));
  await callback("/"); expect(state.google.mock.calls[0][0].expiresInSeconds).toBe(3600); expect(log).toHaveBeenLastCalledWith("[auth/callback] google-token-storage-unconfirmed");
  state.verify.mockResolvedValueOnce({ provider: "github", accessToken: "synthetic-access", refreshToken: null, githubId: 123, githubLogin: "trusted", expiresInSeconds: null, scopes: [] });
  state.github.mockRejectedValue(new Error("Synthetic private provider cause"));
  await callback("/", "&link=github"); expect(log).toHaveBeenLastCalledWith("[auth/callback] github-token-storage-unconfirmed");
});
it("a best-effort sign-out revocation logs only its fixed failure code", async () => {
  state.revoke.mockRejectedValueOnce(new Error("Synthetic private provider cause"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const result = await signOut(new Request("https://app.example/auth/signout", { method: "POST", headers: { origin: "https://app.example" } }));
  expect(result.status).toBe(303); expect(log).toHaveBeenCalledWith("[auth/signout] google-revocation-unconfirmed");
  expect(state.signOut).toHaveBeenCalledTimes(1);
});

it("chooses storage from the verified grant, regardless of the link URL hint", async () => {
  state.verify.mockResolvedValueOnce({ provider: "google", accessToken: "synthetic-access", refreshToken: "synthetic-refresh", googleSub: "trusted-sub", expiresInSeconds: 3600, scopes: ["calendar"] });
  await callback("/", "&link=github"); expect(state.google).toHaveBeenCalledOnce(); expect(state.github).not.toHaveBeenCalled();
  state.verify.mockResolvedValueOnce({ provider: "github", accessToken: "synthetic-access", refreshToken: null, githubId: 123, githubLogin: "trusted", expiresInSeconds: null, scopes: [] });
  await callback("/"); expect(state.github).toHaveBeenCalledOnce();
});
it("keeps sign-in available after verification failure and logs only its fixed code", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {}); state.verify.mockRejectedValue(Error("Synthetic private token cause"));
  const result = await callback("/projects"); expect(result.headers.get("location")).toBe("https://app.example/projects");
  expect(state.google).not.toHaveBeenCalled(); expect(state.github).not.toHaveBeenCalled(); expect(log).toHaveBeenCalledWith("[auth/callback] provider-token-verification-unconfirmed");
});

it("recovers to login when the code exchange throws without forwarding its cause", async () => {
  state.exchange.mockRejectedValue(Error("Synthetic private exchange detail"));
  expect((await callback("/projects")).headers.get("location")).toBe("https://app.example/login?error=auth");
  expect(state.verify).not.toHaveBeenCalled();
});

it("does not redirect or claim a successful sign-out after an SDK error", async () => {
  state.signOut.mockResolvedValue({ error: Error("Synthetic private logout detail") });
  const result = await signOut(new Request("https://app.example/auth/signout", { method: "POST", headers: { origin: "https://app.example", accept: "application/json" } }));
  expect(result.status).toBe(503); expect(result.headers.get("location")).toBeNull(); expect(await result.text()).not.toContain("private logout");
});
it("provides the explicit successful JSON receipt without a navigation redirect", async () => {
  const result = await signOut(new Request("https://app.example/auth/signout", { method: "POST", headers: { origin: "https://app.example", accept: "application/json" } }));
  expect(result.status).toBe(200); expect(await result.json()).toEqual({ ok: true }); expect(result.headers.get("cache-control")).toBe("private, no-store");
});
it("ends a hanging code exchange before verification or storage", async () => {
  const controller = new AbortController(), original = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 20000 ? controller.signal : original(ms));
  state.exchange.mockReturnValue(new Promise(() => undefined)); const pending = callback("/projects"); await vi.waitFor(() => expect(state.exchange).toHaveBeenCalled()); controller.abort();
  expect((await pending).headers.get("location")).toBe("https://app.example/login?error=auth"); expect(state.verify).not.toHaveBeenCalled();
});
it("ends a hanging sign-out without an unconfirmed redirect", async () => {
  const controller = new AbortController(), original = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 25000 ? controller.signal : original(ms));
  state.signOut.mockReturnValue(new Promise(() => undefined));
  const pending = signOut(new Request("https://app.example/auth/signout", { method: "POST", headers: { origin: "https://app.example" } }));
  await vi.waitFor(() => expect(state.signOut).toHaveBeenCalled()); controller.abort(); expect((await pending).status).toBe(503);
});

it('does not revoke a cached Google grant when user verification reports an error', async () => {
 state.getUser.mockResolvedValue({ data: { user: { id: 'synthetic-cached-owner' } }, error: Error('Synthetic private auth failure') });
 const result = await signOut(new Request('https://app.example/auth/signout', { method: 'POST', headers: { origin: 'https://app.example', accept: 'application/json' } }));
 expect(state.revoke).not.toHaveBeenCalled(); expect(state.signOut).toHaveBeenCalledOnce(); expect(result.status).toBe(200); expect(await result.json()).toEqual({ ok: true });
});
