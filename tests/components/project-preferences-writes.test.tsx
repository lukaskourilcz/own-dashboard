// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Storage } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/panels/settings-panel";
import { NavigationGuardProvider, useGuardedNavigation } from "@/components/navigation-guard";
import { qk } from "@/lib/queries/keys";
import { common } from "@/lib/i18n/sections/common";
import { projects as strings } from "@/lib/i18n/sections/projects";
import type { Project } from "@/lib/types";
import type { ProjectPreferencesReceipt } from "@/lib/project-preferences";
const state = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn(), exit: vi.fn(), error: vi.fn(), ok: vi.fn() }));
vi.mock("@/lib/project-preferences", async original => ({ ...await original<typeof import("@/lib/project-preferences")>(), setProjectPreferences: state.write }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ err: state.error, ok: state.ok }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const project: Project = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", name: "Fixture", slug: "fixture", repo_full_name: null, notes: "Original note", url: null, color: null, sort_order: 0, is_active: true, engagement: "own", created_at: "2026-10-24T09:00:00Z", updated_at: "2026-10-24T09:00:00Z" };
let host: HTMLDivElement, root: Root, client: QueryClient, rows: Project[];
function View() {
  const data = useQuery({ queryKey: qk.projects, initialData: [project], queryFn: state.read, staleTime: Infinity }).data as Project[];
  const navigate = useGuardedNavigation();
  return <><button onClick={() => navigate(state.exit)}>Exit fixture</button><SettingsPanel projects={data} setProjects={next => client.setQueryData(qk.projects, next)} syncPreferences={false} /></>;
}
function result(patch = { is_active: false } as ProjectPreferencesReceipt["values"], source = project): ProjectPreferencesReceipt {
  const previous_values = Object.fromEntries(Object.keys(patch).map(key => [key, source[key as keyof Project]]));
  const stamp = "2026-10-24T10:00:00Z"; rows = [{ ...source, ...patch, updated_at: stamp }];
  return { kind: "saved", id: project.id, user_id: project.user_id, values: patch, previous_values, source_updated_at: source.updated_at, updated_at: stamp };
}
const row = () => host.querySelector('[data-settings-project="fixture"]')!;
const toggle = () => row().querySelector<HTMLButtonElement>('[role="switch"]')!;
const segment = (label: string) => [...row().querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;
const clickExit = () => [...host.querySelectorAll("button")].find(button => button.textContent === "Exit fixture")!.click();
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubGlobal("localStorage", new Storage()); document.documentElement.lang = "en"; rows = [project];
  state.read.mockImplementation(async () => rows); state.write.mockImplementation(async (_client, source, patch) => result(patch, source));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><NavigationGuardProvider><View /></NavigationGuardProvider></QueryClientProvider>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); document.documentElement.lang = ""; vi.unstubAllGlobals(); });
it.each(["en", "cs"] as const)("waits for confirmation, blocks both controls and guards navigation while saving (%s)", async lang => {
  document.documentElement.lang = lang;
  // Remount through the same query client to apply the real language hook.
  await act(async () => root.render(<QueryClientProvider client={client}><NavigationGuardProvider><View /></NavigationGuardProvider></QueryClientProvider>));
  let release!: (value: ProjectPreferencesReceipt) => void;
  state.write.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { toggle().click(); toggle().click(); clickExit(); });
  expect(state.write).toHaveBeenCalledTimes(1); expect(toggle().disabled).toBe(true); expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(segment(strings[lang].engagementClient).disabled).toBe(true); expect(state.exit).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(common[lang].unsaved.pendingTitle);
  await act(async () => release(result()));
  expect(client.getQueryData<Project[]>(qk.projects)![0].is_active).toBe(false); expect(state.read).not.toHaveBeenCalled();
});
it("moves the project only after an engagement confirmation and updates its shared version", async () => {
  let release!: (value: ProjectPreferencesReceipt) => void; state.write.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => segment(strings.en.engagementClient).click());
  expect(client.getQueryData<Project[]>(qk.projects)![0].engagement).toBe("own"); expect(toggle().disabled).toBe(true);
  await act(async () => release(result({ engagement: "client" })));
  expect(client.getQueryData<Project[]>(qk.projects)![0]).toMatchObject({ engagement: "client", notes: "Original note", updated_at: "2026-10-24T10:00:00Z" });
  expect(toggle().disabled).toBe(false); expect(state.ok).toHaveBeenCalledTimes(1); expect(state.read).not.toHaveBeenCalled();
});
it("preserves and reconciles a newer note instead of applying an older classification response over it", async () => {
  let release!: (value: ProjectPreferencesReceipt) => void; state.write.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => segment(strings.en.engagementClient).click());
  const receipt = result({ engagement: "client" });
  rows = [{ ...rows[0], notes: "Later note", updated_at: "2026-10-24T11:00:00Z" }];
  await act(async () => { client.setQueryData(qk.projects, [{ ...rows[0], engagement: "own" }]); release(receipt); });
  expect(client.getQueryData<Project[]>(qk.projects)![0]).toMatchObject({ engagement: "client", notes: "Later note", updated_at: "2026-10-24T11:00:00Z" });
  expect(state.read).toHaveBeenCalledTimes(1);
});
it("reads after an ambiguous committed failure and never rolls a newer state back", async () => {
  state.write.mockImplementationOnce(async () => { rows = [{ ...project, is_active: false, notes: "Concurrent note", updated_at: "2026-10-24T10:00:00Z" }]; throw Error("Private backend details"); });
  await act(async () => toggle().click());
  expect(client.getQueryData<Project[]>(qk.projects)![0]).toMatchObject({ is_active: false, notes: "Concurrent note" });
  expect(state.error).toHaveBeenCalledWith(strings.en.preferenceSaveFailed); expect(JSON.stringify(state.error.mock.calls)).not.toContain("Private backend details");
});
it("shows a conflict without a false success and uses the refreshed version for a manual retry", async () => {
  const newer = { ...project, name: "Changed elsewhere", updated_at: "2026-10-24T10:00:00Z" }; rows = [newer];
  state.write.mockResolvedValueOnce({ kind: "conflict", id: project.id, user_id: project.user_id, values: { engagement: "own" }, previous_values: { engagement: "own" }, source_updated_at: newer.updated_at, updated_at: newer.updated_at });
  await act(async () => segment(strings.en.engagementClient).click());
  expect(state.error).toHaveBeenCalledWith(strings.en.preferenceConflict); expect(state.ok).not.toHaveBeenCalled();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => segment(strings.en.engagementClient).click());
  expect(state.write.mock.calls[1][1].updated_at).toBe(newer.updated_at); expect(state.ok).toHaveBeenCalledTimes(1);
});
