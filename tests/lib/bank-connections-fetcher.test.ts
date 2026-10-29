import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ data: [] as unknown, count: 0 as number | null, error: null as unknown, retry: vi.fn(), signal: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => {
  const query = { select: () => query, order: () => query, limit: () => query,
    retry: (value: boolean) => { state.retry(value); return query; },
    abortSignal: async (value: AbortSignal) => { state.signal(value); return { data: state.data, count: state.count, error: state.error }; },
  }; return query;
} }) }));
import { fetchBankConnections } from "@/lib/queries/fetchers";
beforeEach(() => { state.data = []; state.count = 0; state.error = null; state.retry.mockClear(); state.signal.mockClear(); });
it("returns complete empty data with explicit retry control and a finite read signal", async () => {
  expect(await fetchBankConnections()).toEqual([]); expect(state.retry).toHaveBeenCalledWith(false);
  expect(state.signal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
});
it.each([
  { data: [], count: null }, { data: [], count: 1 }, { data: null, count: 0 },
  { data: [{ id: "c1", user_id: "owner" }, { id: "c1", user_id: "owner" }], count: 2 },
  { data: [{ id: 123, user_id: "owner" }], count: 1 }, { data: [], count: 0, error: {} },
])("refuses capped, malformed or failed reads (%#)", async patch => {
  Object.assign(state, patch); await expect(fetchBankConnections()).rejects.toThrow("Bank connections unavailable");
});
