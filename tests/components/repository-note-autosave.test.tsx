// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useRepositoryNoteAutosave } from "@/components/github/use-repository-note-autosave";
import type { RepoNote } from "@/lib/types";
const state = vi.hoisted(() => ({ save: vi.fn(), guard: undefined as unknown }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/repository-records", () => ({ saveRepositoryNote: (_client: unknown, expected: RepoNote, body: string) => state.save(expected, body) }));
vi.mock("@/components/navigation-guard", () => ({ useUnsavedDraft: (draft: unknown) => { state.guard = draft; } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, api: ReturnType<typeof useRepositoryNoteAutosave>, rows: RepoNote[];
const failure = vi.fn(), reconcile = vi.fn();
const base: RepoNote = { id: "33333333-3333-4333-8333-333333333333", user_id: "11111111-1111-4111-8111-111111111111", repo_id: "123", repo_full_name: "owner/fixture", body: "Original", sort_order: 1, created_at: "2026-10-24T04:00:00Z", updated_at: "2026-10-24T04:00:00Z" };
const saved = (expected: RepoNote, body: string) => ({ ...expected, body, updated_at: "2026-10-24T04:01:00Z" });
async function mount() {
  state.save.mockReset(); failure.mockClear(); reconcile.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  function Harness() { const [notes, setNotes] = useState([base]); rows = notes; api = useRepositoryNoteAutosave(setNotes, failure, reconcile); return null; }
  await act(async () => root.render(<Harness/>));
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.useRealTimers(); });
it("keeps undebounced edits out of confirmed data and registers them with navigation", async () => {
  await mount(); await act(async () => api.change(base, "Unsaved"));
  expect(rows[0].body).toBe("Original"); expect(api.drafts[base.id]).toBe("Unsaved"); expect(state.guard).toMatchObject({ dirty: true, canSave: true }); expect(state.save).not.toHaveBeenCalled();
});
it("retains failed text and retries without falsely confirming an older document", async () => {
  await mount(); state.save.mockRejectedValueOnce(Error("Synthetic failure"));
  await act(async () => { api.change(base, "Retained draft"); await api.save(base.id); });
  expect(api.errors.has(base.id)).toBe(true); expect(rows[0]).toEqual(base); expect(api.drafts[base.id]).toBe("Retained draft"); expect(reconcile).toHaveBeenCalledOnce();
  state.save.mockImplementation(async (expected, body) => saved(expected, body)); let ok = false;
  await act(async () => { ok = await api.saveAll(); }); expect(ok).toBe(true); expect(api.drafts).toEqual({}); expect(api.errors.size).toBe(0); expect(rows[0].body).toBe("Retained draft");
});
it("serializes saves against their preceding confirmed version and coalesces identical flushes", async () => {
  await mount(); let release!: () => void;
  state.save.mockImplementationOnce((expected, body) => new Promise(resolve => { release = () => resolve(saved(expected, body)); })).mockImplementation(async (expected, body) => saved(expected, body));
  let first!: Promise<boolean>, duplicate!: Promise<boolean>, second!: Promise<boolean>;
  await act(async () => { api.change(base, "First"); first = api.save(base.id); duplicate = api.save(base.id); api.change(base, "Second"); second = api.save(base.id); });
  expect(state.save).toHaveBeenCalledTimes(1); expect(rows[0]).toEqual(base);
  await act(async () => { release(); await first; await duplicate; await second; });
  expect(state.save).toHaveBeenCalledTimes(2); expect(state.save.mock.calls[1][0].body).toBe("First"); expect(rows[0].body).toBe("Second"); expect(api.drafts).toEqual({}); expect(api.pending.size).toBe(0);
});
it("keeps newer keystrokes dirty when an older save completes", async () => {
  await mount(); let release!: () => void;
  state.save.mockImplementationOnce((expected, body) => new Promise(resolve => { release = () => resolve(saved(expected, body)); })); let first!: Promise<boolean>;
  await act(async () => { api.change(base, "Earlier"); first = api.save(base.id); api.change(base, "Newest before debounce"); });
  let ok = true; await act(async () => { release(); ok = await first; });
  expect(ok).toBe(false); expect(api.drafts[base.id]).toBe("Newest before debounce"); expect(rows[0].body).toBe("Earlier");
});
it("prevents queued saves after discard and keeps any already confirmed write", async () => {
  await mount(); let release!: () => void;
  state.save.mockImplementationOnce((expected, body) => new Promise(resolve => { release = () => resolve(saved(expected, body)); })); let first!: Promise<boolean>, queued!: Promise<boolean>;
  await act(async () => { api.change(base, "Already sent"); first = api.save(base.id); api.change(base, "Queued"); queued = api.save(base.id); api.discardAll(); });
  await act(async () => { release(); await first; await queued; });
  expect(state.save).toHaveBeenCalledOnce(); expect(rows[0].body).toBe("Already sent"); expect(api.drafts).toEqual({}); expect(api.pending.size).toBe(0);
});
it("flushes the newest undebounced edit before navigation", async () => {
  await mount(); state.save.mockImplementation(async (expected, body) => saved(expected, body)); let ok = false;
  await act(async () => { api.change(base, "No timer wait"); ok = await api.saveAll(); });
  expect(ok).toBe(true); expect(rows[0].body).toBe("No timer wait"); expect(state.guard).toMatchObject({ dirty: false });
});
