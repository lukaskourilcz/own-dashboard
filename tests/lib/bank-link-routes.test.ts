import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ user: true, configured: true, limited: false, readError: false, missing: false, foreign: false, writeError: false, missingReceipt: false,
  begin: vi.fn(), consent: vi.fn(), institutions: vi.fn(), from: vi.fn(), patch: {} as Record<string, unknown>, insert: {} as Record<string, unknown> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: !state.limited, retryAfter: 60 }) }));
vi.mock("@/lib/bank/registry", () => ({ getProvider: (id: string) => ({ id, isConfigured: async () => state.configured, beginLink: state.begin, getConsent: state.consent, listInstitutions: state.institutions }) }));
import { POST as connect } from "@/app/api/bank/connect/route";
import { GET as callback } from "@/app/api/bank/callback/route";
import { GET as institutions } from "@/app/api/bank/institutions/route";
const id = "11111111-1111-4111-8111-111111111111", reference = "22222222-2222-4222-8222-222222222222", version = "2026-10-24T00:00:00Z";
const link = "https://ob.gocardless.com/psd2/start/11111111-1111-4111-8111-111111111111/BANK";
const req = (body: unknown, origin = "https://app.example") => new Request("https://app.example/api/bank/connect", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
const valid = { provider: "gocardless", institutionId: "SYNTHETIC_BANK", institutionName: "Synthetic bank" };
const returned = () => callback(new Request(`https://app.example/api/bank/callback?ref=${reference}`));
beforeEach(() => {
  Object.assign(state, { user: true, configured: true, limited: false, readError: false, missing: false, foreign: false, writeError: false, missingReceipt: false, patch: {}, insert: {} });
  state.begin.mockReset().mockResolvedValue({ providerRef: id, consentUrl: link, consentExpiresAt: null });
  state.consent.mockReset().mockResolvedValue({ status: "linked", expiresAt: null, error: "Synthetic private provider detail" });
  state.institutions.mockReset().mockResolvedValue([{ id: "BANK", name: "Synthetic bank", bic: null, logo: null }]);
  state.from.mockReset().mockImplementation(() => {
    const filters = new Map<string, unknown>(); let updating = false;
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.set(key, value); return q; },
      insert: (row: Record<string, unknown>) => { state.insert = row; return q; }, update: (patch: Record<string, unknown>) => { updating = true; state.patch = patch; return q; },
      maybeSingle: async () => { expect(filters.get("user_id")).toBe("owner"); expect(filters.get("reference")).toBe(reference); return { data: state.missing ? null : { id, user_id: state.foreign ? "another" : "owner", reference, provider: "gocardless", updated_at: version }, error: state.readError ? {} : null }; },
      single: async () => { if (updating) { expect(filters.get("user_id")).toBe("owner"); expect(filters.get("updated_at")).toBe(version); } return { data: state.missingReceipt ? null : { id }, error: state.writeError ? {} : null }; },
    }; return q;
  });
});
it.each([null, [], {}, { ...valid, institutionId: 12 }, { ...valid, provider: "unknown" }, { ...valid, extra: true }])("refuses malformed consent requests before provider work (%#)", async body => {
  expect((await connect(req(body))).status).toBe(400); expect(state.begin).not.toHaveBeenCalled(); expect(state.from).not.toHaveBeenCalled();
});
it("preserves auth/CSRF/size/rate boundaries", async () => {
  expect((await connect(req(valid, "https://other.test"))).status).toBe(403);
  state.user = false; expect((await connect(req(valid))).status).toBe(401); state.user = true;
  expect((await connect(req({ ...valid, institutionName: "x".repeat(4097) }))).status).toBe(413);
  state.limited = true; expect((await connect(req(valid))).status).toBe(429); expect(state.begin).not.toHaveBeenCalled();
});
it("returns a link only after a confirmed owned connection insert", async () => {
  expect(await (await connect(req(valid))).json()).toEqual({ link }); expect(state.insert.user_id).toBe("owner"); expect(state.insert.provider_ref).toBe(id);
  state.writeError = true; expect((await connect(req(valid))).status).toBe(502); state.writeError = false;
  state.missingReceipt = true; expect((await connect(req(valid))).status).toBe(502);
});
it("refuses invalid links/unavailable providers and redacts exceptions", async () => {
  state.configured = false; expect((await connect(req(valid))).status).toBe(503); expect(state.begin).not.toHaveBeenCalled(); state.configured = true;
  state.begin.mockResolvedValueOnce({ providerRef: id, consentUrl: "javascript:alert(1)", consentExpiresAt: null });
  expect((await connect(req(valid))).status).toBe(502); expect(state.from).not.toHaveBeenCalled();
  state.begin.mockRejectedValueOnce(new Error("Synthetic private provider detail")); const result = await connect(req(valid)); expect(await result.text()).not.toContain("Synthetic private provider detail");
});
it("callback success requires owned reads, a versioned write receipt and fixed persisted errors", async () => {
  expect((await returned()).headers.get("location")).toBe("https://app.example/finances?bank=linked"); expect(state.patch.last_error).toBeNull();
  state.consent.mockResolvedValue({ status: "error", expiresAt: null, error: "Synthetic private provider detail" });
  expect((await returned()).headers.get("location")).toContain("bank=error"); expect(state.patch.last_error).toBe("bank-sync-failed");
  state.consent.mockResolvedValue({ status: "linked", expiresAt: null }); state.writeError = true; expect((await returned()).headers.get("location")).toContain("bank=error");
});
it("callback rejects missing/foreign/failed reads without provider or write calls", async () => {
  for (const key of ["missing", "foreign", "readError"] as const) { state[key] = true; expect((await returned()).headers.get("location")).toContain("bank=error"); state[key] = false; }
  expect(state.consent).not.toHaveBeenCalled(); expect(state.patch).toEqual({});
  state.user = false; expect((await returned()).headers.get("location")).toBe("https://app.example/login");
});
it("institution lists validate query, capability and complete response shape", async () => {
  const get = (query = "country=cz") => institutions(new Request(`https://app.example/api/bank/institutions?${query}`));
  expect((await get("country=cz-extra")).status).toBe(400); expect((await get("provider=unknown")).status).toBe(400);
  expect((await get()).status).toBe(200); expect(state.institutions).toHaveBeenCalledWith("cz");
  state.institutions.mockResolvedValue({ results: [] }); expect((await get()).status).toBe(502);
  state.configured = false; expect((await get()).status).toBe(503); state.configured = true; state.limited = true; expect((await get()).status).toBe(429);
});
