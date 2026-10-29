// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { relinkGoogle } from "@/lib/google-auth";
const state = vi.hoisted(() => ({ signIn: vi.fn(), guest: false }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithOAuth: state.signIn } }) }));
vi.mock("@/lib/guest-requests", () => ({ isGuestTour: () => state.guest, guestReadOnlyError: () => "Guest read only" }));
const backend = "https://backend.example", callback = () => `${window.location.origin}/auth/callback?next=/`;
const url = () => `${backend}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callback())}`;
let assign: ReturnType<typeof vi.spyOn>;
beforeEach(() => { state.guest = false; state.signIn.mockReset().mockResolvedValue({ data: { url: url() }, error: null }); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", backend); assign = vi.spyOn(window.location, "assign").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("prepares PKCE without SDK navigation, preserves consent/offline/calendar scopes and navigates only to its configured auth endpoint", async () => {
  expect(await relinkGoogle()).toEqual({}); const input = state.signIn.mock.calls[0][0];
  expect(input).toMatchObject({ provider: "google", options: { skipBrowserRedirect: true, redirectTo: callback(), queryParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" } } });
  expect(input.options.scopes.split(" ")).toEqual(["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"]);
  expect(assign).toHaveBeenCalledWith(url());
});
it("never starts OAuth in the guest tour or with a cancelled caller", async () => {
  state.guest = true; expect(await relinkGoogle()).toEqual({ error: "Guest read only" }); state.guest = false;
  const controller = new AbortController(); controller.abort(); expect((await relinkGoogle(controller.signal)).error).toBeTruthy(); expect(state.signIn).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
});
it("handles rejected or error-bearing provider preparation without leaking details", async () => {
  for (const response of [{ data: { url: url() }, error: { message: "Private provider detail" } }, { data: { url: null }, error: null }]) {
    state.signIn.mockResolvedValueOnce(response); expect(await relinkGoogle()).toEqual({ error: "Google authorization unavailable" });
  }
  state.signIn.mockRejectedValueOnce(Error("Private provider detail")); expect(await relinkGoogle()).toEqual({ error: "Google authorization unavailable" }); expect(assign).not.toHaveBeenCalled();
});
it("rejects foreign origins, credentials, wrong endpoint/provider/callback, fragments and overbound URLs", async () => {
  for (const target of ["javascript:alert(1)", url().replace(backend,"https://foreign.example"), url().replace(backend,"https://user:pass@backend.example"), url().replace("/authorize?", "/other?"),
    url().replace("provider=google","provider=github"), url().replace(encodeURIComponent(callback()), encodeURIComponent("https://foreign.example/auth/callback")), `${url()}#fragment`, `${url()}&extra=${"x".repeat(8192)}`]) {
    state.signIn.mockResolvedValueOnce({ data: { url: target }, error: null }); expect((await relinkGoogle()).error).toBeTruthy();
  }
  expect(assign).not.toHaveBeenCalled();
});
it("does not navigate when a hung preparation settles after caller cancellation", async () => {
  let release!: (value: unknown) => void; state.signIn.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); const controller = new AbortController(), pending = relinkGoogle(controller.signal);
  controller.abort(); expect((await pending).error).toBeTruthy(); release({ data: { url: url() }, error: null }); await Promise.resolve(); await Promise.resolve(); expect(assign).not.toHaveBeenCalled();
});
it("limits a hung preparation to fifteen seconds and allows an explicit retry", async () => {
  const controller = new AbortController(), timeout = vi.spyOn(AbortSignal,"timeout").mockReturnValueOnce(controller.signal); state.signIn.mockImplementationOnce(() => new Promise(() => {}));
  const pending = relinkGoogle(); controller.abort(); expect((await pending).error).toBeTruthy(); expect(timeout).toHaveBeenCalledWith(15000); expect(assign).not.toHaveBeenCalled();
  expect(await relinkGoogle()).toEqual({}); expect(assign).toHaveBeenCalledTimes(1);
});
it("accepts a configured local auth origin with a base path and rejects an invalid public configuration", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321/base/"); const local = url().replace(backend, "http://localhost:54321/base"); state.signIn.mockResolvedValueOnce({ data: { url: local }, error: null }); expect(await relinkGoogle()).toEqual({}); expect(assign).toHaveBeenCalledWith(local);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url"); expect((await relinkGoogle()).error).toBeTruthy(); expect(assign).toHaveBeenCalledTimes(1);
});
