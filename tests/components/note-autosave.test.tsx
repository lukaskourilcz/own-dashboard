// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useNoteAutosave, type NoteDocument } from "@/components/notes/use-note-autosave";
import type { Note } from "@/lib/types";

const state = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({ update: (doc: unknown) => ({ eq: (_field: string, id: string) => ({ select: () => ({ single: () => state.write(id, doc) }) }) }) }) }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, client: QueryClient, api: ReturnType<typeof useNoteAutosave>;
let rows: Note[];
const report = vi.fn();
const base = { id: "n1", title: "Original", content: [], plain_text: "", project_id: "project", tags: ["work"], updated_at: "2026-10-23T12:00:00Z" } as unknown as Note;
const doc = (title: string): NoteDocument => ({ title, content: [{ type: "paragraph", content: [{ type: "text", text: title }] }], plainText: title });
const receipt = (id: string, fields: Record<string, unknown>) => ({ data: { ...base, id, ...fields, project_id: "stale-project", tags: [], updated_at: "2026-10-23T12:01:00Z" }, error: null });
async function mount() {
  state.write.mockReset(); report.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient();
  function Harness() { const [notes, setNotes] = useState([base, { ...base, id: "n2" }]); rows = notes; api = useNoteAutosave(setNotes, report); return null; }
  await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); });

it("retains an independently failed draft for each note and retries them all", async () => {
  await mount();
  state.write.mockResolvedValue({ data: null, error: { message: "offline" } });
  await act(async () => {
    api.markDirty("n1"); await api.save("n1", doc("First draft"));
    api.markDirty("n2"); await api.save("n2", doc("Second draft"));
  });
  expect([...api.errors]).toEqual(["n1", "n2"]);
  expect(api.drafts.n1.title).toBe("First draft"); expect(api.drafts.n2.title).toBe("Second draft");
  state.write.mockImplementation(async (id, fields) => receipt(id, fields));
  let saved = false;
  await act(async () => { saved = await api.saveAll(null); });
  expect(saved).toBe(true); expect(api.dirty.size).toBe(0); expect(api.errors.size).toBe(0);
  expect(rows.map(note => note.title)).toEqual(["First draft", "Second draft"]);
  expect(rows[0].project_id).toBe("project"); expect(rows[0].tags).toEqual(["work"]);
});
it("an older confirmation cannot mark newer undebounced keystrokes saved", async () => {
  await mount();
  let release!: () => void;
  state.write.mockImplementationOnce((id, fields) => new Promise(resolve => { release = () => resolve(receipt(id, fields)); }));
  let first!: Promise<boolean>;
  await act(async () => { api.markDirty("n1"); first = api.save("n1", doc("Earlier")); await Promise.resolve(); });
  await act(async () => { api.markDirty("n1"); release(); await first; });
  expect(api.dirty.has("n1")).toBe(true);
  state.write.mockImplementation(async (id, fields) => receipt(id, fields));
  let saved = false;
  await act(async () => { saved = await api.saveAll({ noteId: "n1", doc: doc("Latest before debounce") }); });
  expect(saved).toBe(true); expect(rows[0].title).toBe("Latest before debounce");
});
it("serializes different writes and coalesces an identical in-flight flush", async () => {
  await mount();
  let release!: () => void;
  state.write.mockImplementationOnce((id, fields) => new Promise(resolve => { release = () => resolve(receipt(id, fields)); }))
    .mockImplementation(async (id, fields) => receipt(id, fields));
  let first!: Promise<boolean>, duplicate!: Promise<boolean>, latest!: Promise<boolean>;
  await act(async () => {
    api.markDirty("n1"); first = api.save("n1", doc("Earlier")); duplicate = api.save("n1", doc("Earlier"));
    api.markDirty("n1"); latest = api.save("n1", doc("Latest")); await Promise.resolve();
  });
  expect(state.write).toHaveBeenCalledTimes(1);
  await act(async () => { release(); await first; await duplicate; await latest; });
  expect(state.write).toHaveBeenCalledTimes(2); expect(rows[0].title).toBe("Latest"); expect(api.dirty.size).toBe(0);
});
it("does not overwrite an undo with an already queued newer document", async () => {
  await mount(); state.write.mockImplementation(async (id, fields) => receipt(id, fields));
  await act(async () => { api.markDirty("n1"); await api.save("n1", doc("Original draft")); });
  let release!: () => void;
  state.write.mockImplementationOnce((id, fields) => new Promise(resolve => { release = () => resolve(receipt(id, fields)); }))
    .mockImplementation(async (id, fields) => receipt(id, fields));
  let changed!: Promise<boolean>, undone!: Promise<boolean>;
  await act(async () => {
    api.markDirty("n1"); changed = api.save("n1", doc("Changed"));
    api.markDirty("n1"); undone = api.save("n1", doc("Original draft")); await Promise.resolve();
  });
  await act(async () => { release(); await changed; await undone; });
  expect(rows[0].title).toBe("Original draft"); expect(state.write).toHaveBeenCalledTimes(3); expect(api.dirty.size).toBe(0);
});

it("retains a draft when a nominal success does not confirm the owned document", async () => {
  await mount();
  state.write.mockResolvedValue({ data: [], error: null });
  let saved = true;
  await act(async () => { api.markDirty("n1"); saved = await api.save("n1", doc("Unconfirmed draft")); });
  expect(saved).toBe(false); expect(api.dirty.has("n1")).toBe(true);
  expect(api.drafts.n1.title).toBe("Unconfirmed draft"); expect(rows[0].title).toBe("Original");
});

it("does not save an old editor's unmount callback after an explicit discard", async () => {
  await mount();
  const closingEditorSave = api.save;
  await act(async () => { api.markDirty("n1"); api.discardAll(); });
  let saved = true;
  await act(async () => { saved = await closingEditorSave("n1", doc("Discarded before debounce")); });
  expect(saved).toBe(false); expect(state.write).not.toHaveBeenCalled(); expect(api.dirty.size).toBe(0);
  // Discarding a same-panel navigation also resets the editor; future edits
  // still work instead of leaving autosave permanently disabled.
  state.write.mockImplementation(async (id, fields) => receipt(id, fields));
  await act(async () => { api.markDirty("n1"); await api.save("n1", doc("A fresh edit")); });
  expect(rows[0].title).toBe("A fresh edit"); expect(api.dirty.size).toBe(0);
});

it("skips a discarded queued write while retaining a request already sent", async () => {
  await mount();
  let release!: () => void;
  state.write.mockImplementationOnce((id, fields) => new Promise(resolve => { release = () => resolve(receipt(id, fields)); }));
  let first!: Promise<boolean>, queued!: Promise<boolean>;
  await act(async () => {
    api.markDirty("n1"); first = api.save("n1", doc("Already sent"));
    api.markDirty("n1"); queued = api.save("n1", doc("Discard this queued edit")); await Promise.resolve();
  });
  expect(state.write).toHaveBeenCalledOnce();
  await act(async () => { api.discardAll(); release(); await first; await queued; });
  expect(state.write).toHaveBeenCalledOnce(); expect(rows[0].title).toBe("Already sent");
  expect(api.dirty.size).toBe(0); expect(api.errors.size).toBe(0); expect(report).not.toHaveBeenCalled();
});
