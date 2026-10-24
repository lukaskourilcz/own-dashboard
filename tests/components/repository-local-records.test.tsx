// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Storage } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ReposPanel } from "@/components/panels/repos-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { qk } from "@/lib/queries/keys";
import { github } from "@/lib/i18n/sections/github";
import { setReposDisconnected } from "@/lib/github-queries";
import type { RepoNote } from "@/lib/types";
const state = vi.hoisted(() => ({ err: vi.fn(), ok: vi.fn(), save: vi.fn(), user: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => state }));
vi.mock("@/components/ui/confirmation-dialog", () => ({ useConfirmation: () => async () => true }));
vi.mock("@/lib/supabase/user", () => ({ currentUserId: () => state.user() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/repository-records", async load => ({ ...await load<object>(), saveRepositoryNote: (_client: unknown, expected: RepoNote, body: string) => state.save(expected, body) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base: RepoNote = { id: "33333333-3333-4333-8333-333333333333", user_id: "11111111-1111-4111-8111-111111111111", repo_id: "123", repo_full_name: "owner/previous-name", body: "My saved project note", sort_order: 1, created_at: "2026-10-24T04:00:00Z", updated_at: "2026-10-24T04:00:00Z" };
const other = { ...base, id: "44444444-4444-4444-8444-444444444444", repo_id: "456", repo_full_name: "owner/fixture", body: "Different repository note" };
const repo = { id: 123, name: "fixture", full_name: "owner/fixture", owner: "owner", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/owner/fixture", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
let host: HTMLDivElement, root: Root, client: QueryClient;
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); state.user.mockReset(); vi.restoreAllMocks(); document.documentElement.lang = "cs"; });
async function mount(connected: boolean) {
  vi.stubGlobal("localStorage", new Storage()); document.documentElement.lang = "en"; host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.repos, connected ? { kind: "ok", repos: [repo], checkedAt: Date.now() } : { kind: "disconnected" });
  function View() { const [notes, setNotes] = useState([base, other]); return <ReposPanel initialVisibleIds={[]} repoFullName={repo.full_name} repoId={123} repoNotes={notes} setRepoNotes={setNotes} repoLinks={[]} setRepoLinks={() => undefined} />; }
  await act(async () => root.render(<QueryClientProvider client={client}><TooltipProvider><View /></TooltipProvider></QueryClientProvider>));
}
async function settle(check: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); check(); }); }
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === label)!;
it("keeps only the linked repository's owned notes editable without inventing provider metadata", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); await mount(false);
  expect(host.textContent).toContain(base.body); expect(host.textContent).not.toContain(other.body); expect(host.textContent).toContain(github.en.localRecordsAvailable);
  expect(button(github.en.saveNotes).disabled).toBe(true); expect(button(github.en.editNote).disabled).toBe(false); expect(host.textContent).not.toContain(github.en.privateLabel); expect(host.textContent).not.toContain(github.en.never); expect(fetcher).not.toHaveBeenCalled();
});
it("retains the same in-progress editor through disconnect and verified reconnection", async () => {
  await mount(true); act(() => button(github.en.editNote).click()); const field = host.querySelector<HTMLTextAreaElement>("textarea")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Keep this draft"); field.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => setReposDisconnected(client)); await settle(() => expect(host.textContent).toContain(github.en.localRecordsAvailable));
  expect(host.querySelector("textarea")).toBe(field); expect(field.value).toBe("Keep this draft"); expect(button(github.en.saveNotes).disabled).toBe(true);
  act(() => client.setQueryData(qk.repos, { kind: "ok", repos: [repo], checkedAt: Date.now() + 1 })); await settle(() => expect(button(github.en.saveNotes).disabled).toBe(false));
  expect(host.querySelector("textarea")).toBe(field); expect(field.value).toBe("Keep this draft");
});
it("saves a local edit with its captured owned version while GitHub remains disconnected", async () => {
  state.save.mockImplementation(async (expected: RepoNote, body: string) => ({ ...expected, body, updated_at: "2026-10-24T04:01:00Z" })); await mount(false); act(() => button(github.en.editNote).click()); const field = host.querySelector<HTMLTextAreaElement>("textarea")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Saved without GitHub"); field.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button(github.en.doneEditing).click()); await settle(() => expect(host.querySelector("textarea")).toBeNull());
  expect(state.save).toHaveBeenCalledWith(base, "Saved without GitHub"); expect(host.textContent).toContain("Saved without GitHub"); expect(button(github.en.saveNotes).disabled).toBe(true);
});

it("releases Add note after an unresponsive identity check without creating a row", async () => {
  const stop = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(stop.signal); state.user.mockImplementation(() => new Promise(() => undefined)); await mount(false);
  act(() => button(github.en.addNote).click()); await settle(() => expect(state.user).toHaveBeenCalledOnce()); expect(button(github.en.addNote).disabled).toBe(true);
  await act(async () => stop.abort("PRIVATE")); await settle(() => expect(button(github.en.addNote).disabled).toBe(false));
  expect(host.textContent).toContain(base.body); expect(state.err).toHaveBeenCalledWith(github.en.noteSaveErr);
});
it("releases disconnect controls and retains owned data after a stalled acknowledgement body", async () => {
  const stop = new AbortController(), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel })); vi.spyOn(AbortSignal, "timeout").mockReturnValue(stop.signal); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response)); await mount(true);
  act(() => button(github.en.disconnect).click()); await settle(() => expect(response.body!.locked).toBe(true)); expect(button(github.en.disconnect).disabled).toBe(true);
  await act(async () => stop.abort("PRIVATE")); await settle(() => expect(button(github.en.disconnect).disabled).toBe(false));
  expect(host.textContent).toContain(base.body); expect(client.getQueryData(qk.repos)).toMatchObject({ kind: "ok" }); expect(cancel).toHaveBeenCalledOnce(); expect(state.err).toHaveBeenCalledWith(github.en.disconnectErr);
});
