import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ create: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []), options: null as Record<string, unknown> | null }));
vi.mock("@supabase/ssr", () => ({ createServerClient: (...args: unknown[]) => { state.create(...args); return {}; } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: state.getAll, set: state.set }) }));
import { createClient } from "@/lib/supabase/server";
beforeEach(() => { state.create.mockReset(); state.set.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
const options = () => state.create.mock.calls.at(-1)![2] as { global?: { fetch: typeof fetch }; cookies: { getAll: () => unknown[]; setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void } };
it("keeps deadlines per client and refuses late cookie writes after cancellation", async () => {
  const controller = new AbortController(); await createClient(controller.signal); const bounded = options();
  expect(bounded.global?.fetch).toBeTypeOf("function");
  bounded.cookies.setAll([{ name: "synthetic-cookie", value: "synthetic-value", options: { path: "/" } }]); expect(state.set).toHaveBeenCalledOnce();
  controller.abort(); bounded.cookies.setAll([{ name: "synthetic-cookie", value: "synthetic-late-value", options: {} }]); expect(state.set).toHaveBeenCalledOnce();
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(bounded.global!.fetch("https://synthetic.invalid")).rejects.toMatchObject({ name: "AbortError" }); expect(fetcher).not.toHaveBeenCalled();
  await createClient(); expect(options().global).toBeUndefined();
});
it("preserves existing cookie handling and tolerates read-only Server Component cookies", async () => {
  await createClient(); const ordinary = options(); expect(ordinary.cookies.getAll()).toEqual([]);
  state.set.mockImplementation(() => { throw Error("read-only cookies"); });
  expect(() => ordinary.cookies.setAll([{ name: "synthetic-cookie", value: "synthetic-value", options: {} }])).not.toThrow();
});
