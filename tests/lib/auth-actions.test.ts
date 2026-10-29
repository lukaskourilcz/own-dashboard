import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ guest: false }));
vi.mock("@/lib/guest-requests", () => ({ isGuestTour: () => state.guest, guestReadOnlyError: () => "Sign-out unavailable in preview" }));
import { requestSignOut } from "@/lib/auth-actions";
beforeEach(() => { state.guest = false; });
afterEach(() => vi.unstubAllGlobals());
it("shares one confirmed request across UI consumers, then releases it", async () => {
  let release!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
  const a = requestSignOut(), b = requestSignOut(); expect(a).toBe(b); expect(fetcher).toHaveBeenCalledOnce(); release(Response.json({ ok: true })); await a;
  await requestSignOut(); expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { accept: "application/json" }, redirect: "error" });
});
it.each([503, 200])("rejects unconfirmed receipts and permits retry (%s)", async status => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: false, error: "synthetic-private" }, { status })).mockResolvedValueOnce(Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
  await expect(requestSignOut()).rejects.toThrow("Sign-out unconfirmed"); await expect(requestSignOut()).resolves.toBeUndefined();
});
it("does not send a sign-out request from a public fixture", async () => {
  state.guest = true; const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); await expect(requestSignOut()).rejects.toThrow("preview"); expect(fetcher).not.toHaveBeenCalled();
});
