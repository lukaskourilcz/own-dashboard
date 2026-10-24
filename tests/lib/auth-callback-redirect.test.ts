import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ session: {} as Record<string, unknown>, failed: false, exchange: vi.fn(), google: vi.fn(), github: vi.fn(), verify: vi.fn(), revoke: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: state.exchange, getUser: async () => ({ data: { user: { id: "owner" } } }), signOut: state.signOut } }) }));
vi.mock("@/lib/google-token", () => ({ storeGoogleTokens: state.google, revokeGoogleAccess: state.revoke }));
vi.mock("@/lib/github-token", () => ({ storeGitHubTokens: state.github }));
vi.mock("@/lib/oauth-grant-verification", () => ({ verifyOAuthGrant: state.verify }));
import { GET } from "@/app/auth/callback/route";
import { POST as signOut } from "@/app/auth/signout/route";
beforeEach(() => {
  vi.restoreAllMocks(); state.session = {}; state.failed = false;
  state.google.mockReset(); state.github.mockReset(); state.verify.mockReset().mockResolvedValue(null);
  state.revoke.mockReset().mockRejectedValue(new Error("Synthetic private provider cause")); state.signOut.mockReset().mockResolvedValue({ error: null });
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
