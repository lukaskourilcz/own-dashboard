// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NavigationGuardProvider, useGuardedNavigation } from "@/components/navigation-guard";
import { useProjectDetailsForm } from "@/components/projects/use-project-details-form";
import { projectDetailsHistory, type ProjectDetailsReceipt, type ProjectDetailsValues } from "@/lib/project-details";
import { common } from "@/lib/i18n/sections/common";
import { projects } from "@/lib/i18n/sections/projects";
import { qk } from "@/lib/queries/keys";
import type { Project } from "@/lib/types";
const state = vi.hoisted(() => ({ write: vi.fn(), lookup: vi.fn(), read: vi.fn(), exit: vi.fn(), opened: vi.fn() }));
vi.mock("@/lib/project-details", async original => ({ ...await original<typeof import("@/lib/project-details")>(), saveProjectDetails: state.write }));
vi.mock("@/lib/github", () => ({ loadRepositoryResult: state.lookup }));
vi.mock("@/lib/queries/fetchers", () => ({ fetchProjects: state.read }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/i18n", () => ({ useDict: () => ({ common: common.en, projects: projects.en }), useLang: () => ({ lang: "en" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ err: vi.fn() }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const project: Project = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", name: "Original", slug: "original", repo_full_name: null, repo_id: null,
  notes: "Private notes", url: null, color: null, sort_order: 0, is_active: true, engagement: "own", organization_id: null, previous_slugs: [], previous_repo_full_names: [],
  created_at: "2026-10-24T09:00:00Z", updated_at: "2026-10-24T09:00:00Z" };
let root: Root | undefined, host: HTMLDivElement, client: QueryClient, api: ReturnType<typeof useProjectDetailsForm>, rows: Project[], tick: number;
function confirmed(source: Project, values: ProjectDetailsValues): ProjectDetailsReceipt {
  const history = projectDetailsHistory(source, values), updated_at = `2026-10-24T10:00:${String(++tick).padStart(2, "0")}Z`;
  rows = [{ ...source, ...values, ...history, updated_at }];
  return { kind: "saved", id: source.id, user_id: source.user_id, values, ...history, source_updated_at: source.updated_at, updated_at };
}
function View() {
  const data = useQuery({ queryKey: qk.projects, queryFn: state.read, initialData: [project], staleTime: Infinity }).data as Project[];
  const details = useProjectDetailsForm(data, next => client.setQueryData(qk.projects, next), state.opened);
  useLayoutEffect(() => { api = details; });
  const navigate = useGuardedNavigation(); return <button onClick={() => navigate(state.exit)}>Exit fixture</button>;
}
beforeEach(async () => {
  vi.resetAllMocks(); rows = [project]; tick = 0; state.read.mockImplementation(async () => rows); state.write.mockImplementation(async (_client, source, values) => confirmed(source, values));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root!.render(<QueryClientProvider client={client}><NavigationGuardProvider><View /></NavigationGuardProvider></QueryClientProvider>));
  await act(async () => api.startEditProject(project));
});
afterEach(() => { act(() => root?.unmount()); host.remove(); client.clear(); });
const submit = () => api.submitProject({ preventDefault() {} } as React.FormEvent);
function click(text: string) { [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!.click(); }
it("protects a same-event edit and saves the latest raw form through the captured source", async () => {
  await act(async () => { api.setForm({ ...api.form, name: "Latest edit" }); click("Exit fixture"); });
  expect(state.exit).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(common.en.unsaved.title);
  await act(async () => click(common.en.unsaved.save));
  expect(state.write.mock.calls[0][1]).toEqual(project); expect(state.write.mock.calls[0][2].name).toBe("Latest edit");
  expect(client.getQueryData<Project[]>(qk.projects)![0]).toMatchObject({ name: "Latest edit", notes: "Private notes" }); expect(state.exit).toHaveBeenCalledTimes(1); expect(api.formOpen).toBe(false);
});
it("prevents two same-event submissions and retains a failed draft for retry", async () => {
  let release!: (value: ProjectDetailsReceipt) => void; state.write.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => api.setForm({ ...api.form, name: "Retained" })); let first!: Promise<void>, second!: Promise<void>;
  await act(async () => { first = submit(); second = submit(); }); expect(state.write).toHaveBeenCalledTimes(1); expect(api.saving).toBe(true);
  await act(async () => { release(confirmed(project, state.write.mock.calls[0][2])); await first; await second; }); expect(api.formOpen).toBe(false);
  await act(async () => api.startEditProject(rows[0])); await act(async () => api.setForm({ ...api.form, name: "Failed draft" })); state.write.mockRejectedValueOnce(Error("Private provider details"));
  await act(async () => submit()); expect(api.form.name).toBe("Failed draft"); expect(api.error).toBe(projects.en.preferenceSaveFailed); expect(api.formOpen).toBe(true);
  await act(async () => submit()); expect(client.getQueryData<Project[]>(qk.projects)![0].name).toBe("Failed draft");
});
it("retains conflicts and uses a refreshed source only after an explicit discard/reload", async () => {
  rows = [{ ...project, name: "External", notes: "Later note", updated_at: "2026-10-24T09:30:00Z" }];
  state.write.mockResolvedValueOnce({ kind: "conflict", id: project.id, user_id: project.user_id, source_updated_at: rows[0].updated_at, updated_at: rows[0].updated_at });
  await act(async () => api.setForm({ ...api.form, name: "My draft" })); await act(async () => submit());
  expect(api.formConflict).toBe(true); expect(api.form.name).toBe("My draft"); await act(async () => api.reloadProjectDetails());
  expect(document.body.textContent).toContain(common.en.unsaved.title); await act(async () => click(common.en.unsaved.discard)); expect(api.form.name).toBe("External");
  await act(async () => api.setForm({ ...api.form, name: "After review" })); await act(async () => submit());
  expect(state.write.mock.calls[1][1]).toMatchObject({ updated_at: "2026-10-24T09:30:00Z", notes: "Later note" });
});
it("cannot reopen a closed form when an older saved-detail read finally returns", async () => {
  let release!: (value: Project[]) => void; state.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => api.setForm({ ...api.form, name: "Draft before reload" })); let pending!: Promise<void>;
  await act(async () => { pending = api.reloadProjectDetails(); }); expect(api.reloading).toBe(true);
  await act(async () => api.closeForm()); await act(async () => click(common.en.unsaved.discard)); expect(api.formOpen).toBe(false);
  await act(async () => { release([{ ...project, name: "Late read" }]); await pending; });
  expect(api.formOpen).toBe(false); expect(state.opened).toHaveBeenCalledTimes(1);
});
it("aborts a pending form request on unmount and ignores a late acknowledgement", async () => {
  let release!: (value: ProjectDetailsReceipt) => void; state.write.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => api.setForm({ ...api.form, name: "Pending edit" })); let pending!: Promise<void>;
  await act(async () => { pending = submit(); }); const signal = state.write.mock.calls[0][3] as AbortSignal;
  act(() => { root!.unmount(); root = undefined; }); expect(signal.aborted).toBe(true);
  await act(async () => { release(confirmed(project, state.write.mock.calls[0][2])); await pending; });
  expect(client.getQueryData<Project[]>(qk.projects)![0].name).toBe("Original");
});
it("rejects invalid fields without writing and bounds an automatically generated slug", async () => {
  await act(async () => api.setForm({ ...api.form, url: "https://user:pass@example.com/" })); expect(api.valid).toBe(false);
  await act(async () => submit()); expect(api.error).toBe(projects.en.detailsInvalid); expect(state.write).not.toHaveBeenCalled();
  await act(async () => api.setForm({ ...api.form, name: "x".repeat(180), slug: "", url: "" })); expect(api.valid).toBe(true);
  await act(async () => submit()); expect(state.write.mock.calls[0][2].slug).toHaveLength(100);
});
it("keeps a removed project's form readable while refusing any further save", async () => {
  await act(async () => api.setForm({ ...api.form, name: "Uncommitted edit" }));
  await act(async () => { rows = []; client.setQueryData(qk.projects, []); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(api.formOpen).toBe(true); expect(api.form.name).toBe("Uncommitted edit"); expect(api.valid).toBe(false); expect(api.error).toBe(projects.en.detailsUnavailable);
  await act(async () => submit()); expect(state.write).not.toHaveBeenCalled();
});
