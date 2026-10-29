// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NavigationGuardProvider, useGuardedNavigation } from "@/components/navigation-guard";
import { useProjectDeletion } from "@/components/projects/use-project-deletion";
import { ProjectDeleteConflict } from "@/lib/project-deletion";
import { common } from "@/lib/i18n/sections/common";
import { projects } from "@/lib/i18n/sections/projects";
import { qk } from "@/lib/queries/keys";
import type { Project } from "@/lib/types";
const state = vi.hoisted(() => ({ write: vi.fn(), confirm: vi.fn(), deleted: vi.fn(), exit: vi.fn() }));
vi.mock("@/lib/project-deletion", async original => ({ ...await original<typeof import("@/lib/project-deletion")>(), deleteOwnedProject: state.write }));
vi.mock("@/components/ui/confirmation-dialog", () => ({ useConfirmation: () => state.confirm }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/i18n", () => ({ useDict: () => ({ common: common.en, projects: projects.en }), useLang: () => ({ lang: "en" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const project: Project = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", name: "Fixture", slug: "fixture", repo_full_name: null,
  notes: "Private note", url: null, color: null, sort_order: 0, is_active: true, created_at: "2026-10-24T09:00:00Z", updated_at: "2026-10-24T09:00:00Z" };
let root: Root | undefined, host: HTMLDivElement, client: QueryClient, api: ReturnType<typeof useProjectDeletion>;
function View() { const deletion = useProjectDeletion(state.deleted), navigate = useGuardedNavigation(); useLayoutEffect(() => { api = deletion; }); return <><output>{deletion.pendingId ?? "idle"}</output><button onClick={() => navigate(state.exit)}>Exit fixture</button></>; }
beforeEach(async () => {
  vi.resetAllMocks(); state.confirm.mockResolvedValue(true); state.write.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.projects, [project]);
  await act(async () => root!.render(<QueryClientProvider client={client}><NavigationGuardProvider><View /></NavigationGuardProvider></QueryClientProvider>));
});
afterEach(() => { act(() => root?.unmount()); host.remove(); client.clear(); });
it("serializes confirmation and same-event deletes and protects pending navigation", async () => {
  let confirm!: (value: boolean) => void, done!: () => void; state.confirm.mockImplementation(() => new Promise(resolve => { confirm = resolve; })); state.write.mockImplementation(() => new Promise<void>(resolve => { done = resolve; }));
  await act(async () => { api.remove(project); api.remove(project); }); expect(state.confirm).toHaveBeenCalledTimes(1); expect(api.pendingId).toBe(project.id);
  await act(async () => confirm(true)); expect(state.write).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector("button")!.click()); expect(state.exit).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(common.en.unsaved.pendingTitle);
  await act(async () => { done(); await new Promise(resolve => setTimeout(resolve, 0)); }); expect(state.deleted).toHaveBeenCalledWith(project); expect(host.querySelector("output")!.textContent).toBe("idle"); expect(api.pendingId).toBeNull(); expect(state.confirm).toHaveBeenCalledTimes(1); expect(state.exit).toHaveBeenCalledTimes(1);
});
it("does not write, clear caches or refetch after cancellation", async () => {
  state.confirm.mockResolvedValue(false); const invalidate = vi.spyOn(client, "invalidateQueries"); await act(async () => api.remove(project));
  expect(state.write).not.toHaveBeenCalled(); expect(state.deleted).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled(); expect(api.failure).toBeNull();
});
it("refuses a project changed in the cache while the confirmation was open", async () => {
  let confirm!: (value: boolean) => void; state.confirm.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
  await act(async () => api.remove(project)); client.setQueryData(qk.projects, [{ ...project, notes: "New optimistic text" }]); await act(async () => confirm(true));
  expect(state.write).not.toHaveBeenCalled(); expect(state.deleted).not.toHaveBeenCalled(); expect(api.failure).toEqual({ id: project.id, message: projects.en.deleteConflict });
});
it("reports a version conflict or lost reply safely and reconciles related collections", async () => {
  const invalidate = vi.spyOn(client, "invalidateQueries"); state.write.mockRejectedValueOnce(new ProjectDeleteConflict()); await act(async () => api.remove(project));
  expect(api.failure?.message).toBe(projects.en.deleteConflict); expect(state.deleted).not.toHaveBeenCalled(); expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.projectCosts });
  state.write.mockRejectedValueOnce(Error("Private backend text")); await act(async () => api.remove(project)); expect(api.failure?.message).toBe(projects.en.deleteFailed);
  await act(async () => api.remove(project)); expect(api.failure).toBeNull(); expect(state.deleted).toHaveBeenCalledTimes(1);
});
it("aborts on unmount and ignores a delayed confirmed response", async () => {
  let done!: () => void; state.write.mockImplementation(() => new Promise<void>(resolve => { done = resolve; })); await act(async () => api.remove(project));
  const signal = state.write.mock.calls[0][2] as AbortSignal; act(() => { root!.unmount(); root = undefined; }); expect(signal.aborted).toBe(true);
  await act(async () => done()); expect(state.deleted).not.toHaveBeenCalled();
});
it("abandons an unanswered confirmation when its caller unmounts", async () => {
  state.confirm.mockImplementation(() => new Promise(() => {})); await act(async () => api.remove(project)); act(() => { root!.unmount(); root = undefined; });
  await act(async () => {}); expect(state.write).not.toHaveBeenCalled(); expect(state.deleted).not.toHaveBeenCalled();
});
