// @vitest-environment happy-dom
import { act, useRef, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NavigationGuardProvider, useGuardedNavigation } from "@/components/navigation-guard";
import { useProjectNotesAutosave } from "@/components/projects/use-project-notes-autosave";
import type { NoteEditorHandle } from "@/components/notes/note-editor";
import { common } from "@/lib/i18n/sections/common";
import { qk } from "@/lib/queries/keys";
import type { Project } from "@/lib/types";
import { ProjectNotesSizeError, type ProjectNotesReceipt } from "@/lib/project-notes";
const state = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn(), text: "", exit: vi.fn() }));
vi.mock("@/lib/project-notes", async original => ({ ...await original<typeof import("@/lib/project-notes")>(), saveProjectNotes: state.write }));
vi.mock("@/lib/queries/fetchers", () => ({ fetchProjects: state.read }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/i18n", () => ({ useDict: () => ({ common: common.en }), useLang: () => ({ lang: "en" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const project: Project = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", name: "Fixture", slug: "fixture", repo_full_name: null, url: null, color: null, notes: "Original", sort_order: 0, is_active: true, created_at: "2026-10-24T09:00:00Z", updated_at: "2026-10-24T09:00:00Z" };
let host: HTMLDivElement, root: Root, client: QueryClient, api: ReturnType<typeof useProjectNotesAutosave>, rows: Project[], tick: number;
function confirmed(source: Project, body: string): ProjectNotesReceipt {
  const saved = { ...source, notes: body, updated_at: `2026-10-24T10:00:${String(++tick).padStart(2, "0")}Z` }; rows = [saved];
  return { kind: "saved", id: source.id, user_id: source.user_id, notes_hash: "a".repeat(64), source_notes_hash: "b".repeat(64), source_updated_at: source.updated_at, updated_at: saved.updated_at };
}
function View() {
  const data = useQuery({ queryKey: qk.projects, initialData: [project], queryFn: state.read }).data as Project[];
  const editor = useRef({ toMarkdown: async () => state.text } as NoteEditorHandle);
  const autosave = useProjectNotesAutosave(data[0], next => client.setQueryData(qk.projects, next), editor);
  useLayoutEffect(() => { api = autosave; });
  const navigate = useGuardedNavigation();
  return <button onClick={() => navigate(state.exit)}>Exit fixture</button>;
}
beforeEach(async () => {
  vi.resetAllMocks(); rows = [project]; tick = 0; state.text = project.notes;
  state.read.mockImplementation(async () => rows); state.write.mockImplementation(async (_client, source, text) => confirmed(source, text));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><NavigationGuardProvider><View /></NavigationGuardProvider></QueryClientProvider>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); vi.useRealTimers(); });
function click(text: string) { ([...document.querySelectorAll("button")].find(button => button.textContent === text)!).click(); }
it("finishes an earlier write before starting the next and carries its confirmed base forward", async () => {
  let release!: (value: ProjectNotesReceipt) => void;
  state.write.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let first!: Promise<boolean>, second!: Promise<boolean>;
  await act(async () => { first = api.save("Earlier"); second = api.save("Latest"); });
  expect(state.write).toHaveBeenCalledTimes(1); expect(api.pending).toBe(true);
  await act(async () => { release(confirmed(project, "Earlier")); expect(await first).toBe(true); expect(await second).toBe(true); });
  expect(state.write.mock.calls[1][1].notes).toBe("Earlier"); expect(client.getQueryData<Project[]>(qk.projects)![0].notes).toBe("Latest"); expect(api.dirty).toBe(false); expect(api.pending).toBe(false);
});
it("guards immediate rich-editor changes and flushes the current document before leaving", async () => {
  state.text = "Before the debounce";
  await act(async () => { api.markDirty(); click("Exit fixture"); });
  expect(state.exit).not.toHaveBeenCalled(); expect(state.write).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(common.en.unsaved.title);
  await act(async () => click(common.en.unsaved.save));
  expect(state.write.mock.calls[0][2]).toBe(state.text); expect(state.exit).toHaveBeenCalledTimes(1);
});
it("keeps newer keystrokes dirty when an older identical queued save finishes", async () => {
  let release!: (value: ProjectNotesReceipt) => void; state.write.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let first!: Promise<boolean>, same!: Promise<boolean>;
  await act(async () => { first = api.save("Earlier"); same = api.save("Earlier"); api.markDirty(); state.text = "Newer unconverted keystrokes"; });
  await act(async () => { release(confirmed(project, "Earlier")); await first; await same; });
  expect(api.dirty).toBe(true); expect(api.saved).toBe(false); expect(api.pending).toBe(false);
});
it("stops later queued writes after a failure and retains the newest document for a manual retry", async () => {
  state.write.mockRejectedValueOnce(Error("Fixture unavailable"));
  let first!: Promise<boolean>, later!: Promise<boolean>;
  await act(async () => { first = api.save("Earlier"); later = api.save("Latest"); expect(await first).toBe(false); expect(await later).toBe(false); });
  expect(state.write).toHaveBeenCalledTimes(1); expect(api.failed).toBe(true); expect(api.dirty).toBe(true); expect(client.getQueryData<Project[]>(qk.projects)![0].notes).toBe("Original");
  state.text = "Latest"; await act(async () => { expect(await api.flush()).toBe(true); });
  expect(state.write).toHaveBeenCalledTimes(2); expect(api.dirty).toBe(false); expect(client.getQueryData<Project[]>(qk.projects)![0].notes).toBe("Latest");
});
it("reconciles an ambiguous committed attempt before retrying a newer document", async () => {
  state.write.mockImplementationOnce(async (_client, source, text) => { confirmed(source, text); throw Error("Lost acknowledgement"); });
  await act(async () => { expect(await api.save("Committed earlier")).toBe(false); });
  await act(async () => {}); expect(client.getQueryData<Project[]>(qk.projects)![0].notes).toBe("Committed earlier");
  state.text = "Latest"; await act(async () => { expect(await api.flush()).toBe(true); });
  expect(state.write.mock.calls[1][1].notes).toBe("Committed earlier"); expect(api.failed).toBe(false);
});
it("requires explicit replacement of a conflict and serializes newer edits behind it", async () => {
  const changed = { ...project, notes: "Other editor", updated_at: "2026-10-24T09:30:00Z" }; rows = [changed];
  const conflict: ProjectNotesReceipt = { kind: "conflict", id: project.id, user_id: project.user_id, notes_hash: "c".repeat(64), source_notes_hash: "c".repeat(64), source_updated_at: changed.updated_at, updated_at: changed.updated_at };
  state.write.mockResolvedValueOnce(conflict);
  await act(async () => { expect(await api.save("Draft")).toBe(false); });
  await act(async () => { expect(await api.save("Newer draft")).toBe(false); });
  expect(state.write).toHaveBeenCalledTimes(1); expect(api.conflict).toEqual(conflict); expect(await api.flush()).toBe(false);
  let release!: (value: ProjectNotesReceipt) => void; state.write.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  state.text = "Explicit replacement"; let replacement!: Promise<boolean>, later!: Promise<boolean>;
  await act(async () => { replacement = api.flush(true); await Promise.resolve(); });
  await act(async () => { later = api.save("Typed during replacement"); });
  expect(state.write.mock.calls[1][3]).toEqual(conflict);
  await act(async () => { release(confirmed(changed, "Explicit replacement")); await replacement; await later; });
  expect(state.write.mock.calls[2][1].notes).toBe("Explicit replacement"); expect(api.conflict).toBeNull(); expect(api.dirty).toBe(false);
});
it("reloads the saved note and ignores callbacks retained by an editor discarded during unmount", async () => {
  const oldSave = api.save;
  await act(async () => { api.markDirty(); }); rows = [{ ...project, notes: "Fresh saved note", updated_at: "2026-10-24T09:30:00Z" }];
  await act(async () => { expect(await api.reloadSaved()).toBe(true); });
  expect(api.seed).toBe("Fresh saved note"); expect(api.generation).toBeGreaterThan(0); expect(api.dirty).toBe(false);
  await act(async () => { expect(await oldSave("Obsolete cleanup")).toBe(false); }); expect(state.write).not.toHaveBeenCalled();
});
it("does not discard edits made while a saved-note reload was pending", async () => {
  let release!: (value: Project[]) => void; state.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { api.markDirty(); }); let reload!: Promise<boolean>;
  await act(async () => { reload = api.reloadSaved(); });
  await act(async () => { api.markDirty(); state.text = "Typed while loading"; });
  await act(async () => { release([{ ...project, notes: "Fresh saved note" }]); expect(await reload).toBe(false); });
  expect(api.dirty).toBe(true); expect(api.generation).toBe(0);
});

it("an earlier saved-status timer cannot hide a newer pending write", async () => {
  vi.useFakeTimers();
  await act(async () => { expect(await api.save("First confirmed")).toBe(true); });
  let release!: (value: ProjectNotesReceipt) => void; state.write.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let pending!: Promise<boolean>;
  await act(async () => { api.markDirty(); pending = api.save("Later pending"); });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(api.pending).toBe(true); expect(api.dirty).toBe(true); expect(api.saved).toBe(false);
  await act(async () => { release(confirmed(rows[0], "Later pending")); await pending; });
});
it("adopts fresh saved text while clean without letting an obsolete editor callback write it back", async () => {
  const obsolete = api.save;
  await act(async () => {
    client.setQueryData(qk.projects, [{ ...project, notes: "Fresh external note", updated_at: "2026-10-24T09:30:00Z" }]);
    // React Query publishes observer notifications on its next scheduled batch.
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(api.seed).toBe("Fresh external note"); expect(api.dirty).toBe(false);
  await act(async () => { expect(await obsolete("Obsolete original")).toBe(false); }); expect(state.write).not.toHaveBeenCalled();
});

it("keeps an overbound draft and requires an edit before it can be saved again", async () => {
  const reads = state.read.mock.calls.length;
  state.write.mockRejectedValueOnce(new ProjectNotesSizeError());
  await act(async () => { expect(await api.save("Overbound fixture")).toBe(false); });
  expect(state.read).toHaveBeenCalledTimes(reads);
  expect(api.tooLarge).toBe(true); expect(api.dirty).toBe(true); expect(api.failed).toBe(true);
  await act(async () => { api.markDirty(); state.text = "Shortened"; }); expect(api.tooLarge).toBe(false);
  await act(async () => { expect(await api.flush()).toBe(true); }); expect(api.dirty).toBe(false);
});

it("suppresses an old editor debounce while an explicit saved-note reload is pending", async () => {
  let release!: (value: Project[]) => void; state.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { api.markDirty(); }); let reload!: Promise<boolean>;
  await act(async () => { reload = api.reloadSaved(); });
  await act(async () => { expect(await api.save("Earlier debounced draft")).toBe(false); });
  expect(state.write).not.toHaveBeenCalled();
  await act(async () => { release([project]); expect(await reload).toBe(true); }); expect(api.dirty).toBe(false); expect(api.seed).toBe(project.notes);
});
