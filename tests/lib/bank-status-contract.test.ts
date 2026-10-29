import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ user: true, table: "", reads: vi.fn(), providers: vi.fn(), admin: true, hanging: false }));
const builder = (table: string) => {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), limit: vi.fn(() => q),
    abortSignal: vi.fn(() => q), maybeSingle: () => state.reads(table),
    then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => Promise.resolve(state.reads(table)).then(resolve, reject) };
  return q;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null } }) }, from: (table: string) => builder(table) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { if (!state.admin) throw Error("Synthetic private detail"); return { from: (table: string) => builder(table) }; } }));
vi.mock("@/lib/bank/registry", () => ({ providerAvailability: (...args: unknown[]) => state.providers(...args) }));
import { GET } from "@/app/api/integrations/status/route";
import { bankProvidersResponse } from "@/lib/bank/flow";
const rows = [{ user_id: "owner", provider: "gocardless", status: "linked", last_synced_at: null }];
beforeEach(() => {
  state.user = true; state.admin = true;
  state.providers.mockReset().mockResolvedValue([
    { id: "gocardless", label: "GoCardless", configured: true, supportsInstitutionPicker: true },
    { id: "fio", label: "Fio banka", configured: false, supportsInstitutionPicker: false },
  ]);
  state.reads.mockReset().mockImplementation(table => table === "bank_connections" ? { data: rows, count: 1, error: null } : { data: null, error: null });
});
it("preserves picker capabilities and owner-scoped metadata without exposing credentials", async () => {
  const response = await GET(); expect(response.status).toBe(200);
  const data = await response.json(); const providers = bankProvidersResponse.parse(data).bank.providers;
  expect(providers).toEqual([
    { id: "gocardless", label: "GoCardless", configured: true, connected: true, supportsInstitutionPicker: true },
    { id: "fio", label: "Fio banka", configured: false, connected: false, supportsInstitutionPicker: false },
  ]);
  expect(data.google.connected).toBe(false); expect(data.github.connected).toBe(false);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(state.providers.mock.calls[0]).toEqual(["owner", expect.any(AbortSignal)]);
});
it.each(["bank_connections", "google_oauth", "github_tokens"])("does not turn a failed %s read into disconnected state", async table => {
  state.reads.mockImplementation(name => name === table ? { data: null, error: { message: "Synthetic private detail" } } : name === "bank_connections" ? { data: rows, count: 1 } : { data: null });
  const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private detail");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it.each([
  { data: rows, count: 2 }, { data: null, count: 0 },
  { data: [{ ...rows[0], user_id: "foreign" }], count: 1 },
  { data: [{ ...rows[0], provider: "unknown" }], count: 1 },
  { data: [{ ...rows[0], last_synced_at: "bad-date" }], count: 1 },
  { data: Array(51).fill(rows[0]), count: 51 },
])("refuses capped, foreign or malformed bank metadata", async result => {
  state.reads.mockImplementation(table => table === "bank_connections" ? result : { data: null });
  expect((await GET()).status).toBe(503);
});
it("refuses unavailable provider checks, missing admin config and foreign private metadata", async () => {
  state.providers.mockRejectedValueOnce(Error("Synthetic private detail")); expect((await GET()).status).toBe(503);
  state.admin = false; expect((await GET()).status).toBe(503); state.admin = true;
  state.reads.mockResolvedValue({ data: { user_id: "foreign" } }); expect((await GET()).status).toBe(503);
});
it("requires authentication before any metadata read", async () => {
  state.user = false; expect((await GET()).status).toBe(401); expect(state.reads).not.toHaveBeenCalled(); expect(state.providers).not.toHaveBeenCalled();
});
it("bounds a configuration check that never settles", async () => {
  const controller = new AbortController(); const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  try {
    state.providers.mockReturnValue(new Promise(() => undefined)); const pending = GET();
    await vi.waitFor(() => expect(state.providers).toHaveBeenCalled()); controller.abort();
    expect((await pending).status).toBe(503);
  } finally { timeout.mockRestore(); }
});
