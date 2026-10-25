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
it("keeps a supplied phase fetcher and the total lifetime on each actual request", async () => {
 const total = new AbortController(), first = new AbortController(), second = new AbortController();
 let phase = first.signal;
 const seen: AbortSignal[] = [], wire = vi.fn<typeof fetch>(async (_input, init) => { seen.push(init!.signal!); return new Response('synthetic'); });
 const phaseFetch: typeof fetch = (input, init) => wire(input, { ...init, signal: AbortSignal.any([phase, init!.signal!]) });
 await createClient(total.signal, phaseFetch); const bounded = options().global!.fetch;
 await bounded('https://synthetic.invalid/first'); phase = second.signal; await bounded('https://synthetic.invalid/second');
 first.abort(); expect(seen.map(signal => signal.aborted)).toEqual([true, false]);
 total.abort(); expect(seen.map(signal => signal.aborted)).toEqual([true, true]);
 await expect(bounded('https://synthetic.invalid/late')).rejects.toMatchObject({ name: 'AbortError' }); expect(wire).toHaveBeenCalledTimes(2);
});
