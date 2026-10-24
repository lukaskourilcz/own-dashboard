import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ user: true, authError: false, row: null as Record<string, unknown> | null, readError: false, writeError: false, suppressed: false, alter: false, race: false, writes: [] as Record<string, unknown>[], filters: [] as [string, unknown][], signal: undefined as AbortSignal | undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async (signal: AbortSignal) => {
  state.signal = signal;
  return { auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null }, error: state.authError ? {} : null }) }, from: () => {
    let patch: Record<string, unknown> | undefined, insert = false;
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder, eq: (key: string, value: unknown) => { filters.push([key, value]); state.filters.push([key, value]); return builder; }, abortSignal: () => builder,
      update: (value: Record<string, unknown>) => { patch = value; return builder; },
      upsert: (value: Record<string, unknown>, options: unknown) => { expect(options).toEqual({ onConflict: "user_id", ignoreDuplicates: true }); patch = value; insert = true; return builder; },
      maybeSingle: async () => {
        if (!patch) return { data: state.row, error: state.readError ? {} : null };
        state.writes.push(patch);
        if (state.writeError) return { data: null, error: { message: "PRIVATE DATABASE DETAIL" } };
        if (state.suppressed || state.race || (!insert && filters.some(([key, value]) => state.row?.[key] !== value))) return { data: null, error: null };
        state.row = { ...state.row, user_id: "owner", ...patch };
        return { data: state.alter ? { ...state.row, language: "wrong" } : state.row, error: null };
      },
    };
    return builder;
  } };
} }));
import { GET, PATCH } from "@/app/api/user/preferences/route";
const request = (body?: unknown, origin = "https://app.example") => new Request("https://app.example/api/user/preferences", { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { Object.assign(state, { user: true, authError: false, row: null, readError: false, writeError: false, suppressed: false, alter: false, race: false, writes: [], filters: [], signal: undefined }); });
it.each([null, [], 42, "bad", {}, { timezone: "not-a-zone" }, { timezone: 42 }, { nudge_hour: 24 }, { nudge_hour: -1 }, { nudge_hour: 1.5 }, { nudge_hour: "5" }, { display_currency: "XXX" }, { user_id: "foreign", theme: "dark" }, { language: "de" }, { notifications_renewals: "false" }, { dashboard_layout: ["unknown"] }, { selected_calendar_ids: Array(21).fill("primary") }, { visible_repo_ids: ["9007199254740992"] }, { cv_url_cs: "javascript:alert(1)" }, { cv_url_cs: "https://user:password@example.test" }])("rejects invalid patches before any write (%j)", async body => {
  const res = await PATCH(request(body)); expect(res.status).toBe(400); expect(res.headers.get("cache-control")).toBe("private, no-store"); expect(state.writes).toEqual([]);
});
it("confirms only normalized requested fields on creation, preserving explicit clears", async () => {
  const res = await PATCH(request({ timezone: null, nudge_hour: null, selected_calendar_ids: [], visible_repo_ids: [], dashboard_layout: ["todos", "todos"], display_currency: "CZK" }));
  expect(res.status).toBe(200); expect(await res.json()).toEqual({ ok: true, saved: { timezone: null, nudge_hour: null, selected_calendar_ids: [], visible_repo_ids: [], dashboard_layout: ["todos"], display_currency: "CZK" } });
  expect(state.writes[0]).toMatchObject({ user_id: "owner" });
});
it("uses the exact captured own-row version and advances a future clock", async () => {
  state.row = { user_id: "owner", updated_at: "2099-01-01T00:00:00.123456Z", theme: "light" };
  expect((await PATCH(request({ theme: "dark" }))).status).toBe(200);
  expect(state.filters).toContainEqual(["user_id", "owner"]); expect(state.filters).toContainEqual(["updated_at", "2099-01-01T00:00:00.123456Z"]);
  expect(Date.parse(String(state.writes[0].updated_at))).toBeGreaterThan(Date.parse("2099-01-01T00:00:00.123456Z"));
});
it.each(["suppressed", "race"] as const)("does not confirm a %s write", async field => { state[field] = true; expect((await PATCH(request({ language: "en" }))).status).toBe(409); });
it.each(["writeError", "alter", "readError", "authError"] as const)("does not confirm %s or expose private detail", async field => { state[field] = true; const res = await PATCH(request({ language: "en" })); expect(res.status).toBe(503); expect(await res.text()).not.toContain("PRIVATE"); });
it("rejects foreign or malformed existing metadata before writing", async () => {
  for (const row of [{ user_id: "foreign", updated_at: new Date().toISOString() }, { user_id: "owner", updated_at: "bad" }]) { state.row = row; expect((await PATCH(request({ theme: "dark" }))).status).toBe(503); }
  expect(state.writes).toEqual([]);
});
it("preserves authentication/origin checks and request cancellation", async () => {
  expect((await PATCH(request({}, "https://foreign.example"))).status).toBe(403); state.user = false; expect((await PATCH(request({})))).toHaveProperty("status", 401); state.user = true;
  const controller = new AbortController(); controller.abort("PRIVATE"); const req = new Request("https://app.example/api/user/preferences", { method: "PATCH", headers: { origin: "https://app.example" }, signal: controller.signal, body: "{}" });
  expect((await PATCH(req)).status).toBe(503); expect(state.writes).toEqual([]);
});
it("bounds request bodies", async () => { expect((await PATCH(request({ cv_url_cs: "x".repeat(70_000) }))).status).toBe(413); expect(state.writes).toEqual([]); });
it("returns private, typed defaults only for a confirmed missing row", async () => { const res = await GET(new Request("https://app.example/api/user/preferences")); expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ selected_calendar_ids: ["primary"], sync_available: true }); expect(state.signal).toBeInstanceOf(AbortSignal); });
it.each([{ user_id: "foreign" }, { user_id: "owner", theme: "wrong" }, { user_id: "owner", selected_calendar_ids: [42] }])("refuses invalid or foreign stored preferences (%j)", async row => { state.row = row; expect((await GET(new Request("https://app.example/api/user/preferences"))).status).toBe(503); });
it("normalizes retired widget/navigation values without reviving them", async () => { state.row = { user_id: "owner", dashboard_layout: ["quick-add", "todos", "todos"], hidden_navigation: ["pulse", "home", "settings"] }; const res = await GET(new Request("https://app.example/api/user/preferences")); expect(await res.json()).toMatchObject({ dashboard_layout: ["todos"], hidden_navigation: [] }); });
