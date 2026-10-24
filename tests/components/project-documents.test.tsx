// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectDocPanel } from "@/components/projects/project-doc-panel";
import { ProjectKnowledgePanel } from "@/components/projects/project-knowledge-panel";
import { common } from "@/lib/i18n/sections/common";
import { professional } from "@/lib/i18n/sections/professional";
const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/github", () => ({ loadRepoFile: state.read }));
vi.mock("@/lib/i18n", () => ({ useDict: () => ({ common: common.en, professional: professional.en }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement, client: QueryClient;
const ok = (name: string) => ({ kind: "ok", content: `# ${name}`, sha: "a".repeat(40), htmlUrl: null });
function view(kind = "doc", repo = "owner/first") { return <QueryClientProvider client={client}>{kind === "knowledge" ? <ProjectKnowledgePanel repoFullName={repo} /> : <ProjectDocPanel repoFullName={repo} file="scaling.md" fallbackFile="stack-and-scaling.md" title="Scaling" description="Document fixture" />}</QueryClientProvider>; }
beforeEach(() => { vi.resetAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); });
afterEach(() => { act(() => root?.unmount()); host.remove(); client.clear(); });
it.each(["doc", "knowledge"])("cancels a %s document read when the workspace unmounts and ignores its late result", async kind => {
  let release!: (value: unknown) => void; state.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await act(async () => root!.render(view(kind)));
  const signal = state.read.mock.calls[0][3] as AbortSignal; expect(signal.aborted).toBe(false); act(() => { root!.unmount(); root = undefined; }); expect(signal.aborted).toBe(true);
  await act(async () => release(ok("Late source"))); expect([...client.getQueryCache().getAll()].every(query => query.state.data === undefined)).toBe(true);
});
it("does not fetch the legacy filename after a primary read completes on a cancelled workspace", async () => {
  let release!: (value: unknown) => void; state.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await act(async () => root!.render(view()));
  act(() => { root!.unmount(); root = undefined; }); await act(async () => release({ kind: "not-found" })); expect(state.read).toHaveBeenCalledTimes(1);
});
it("keeps a later repository's document visible when its earlier read finishes", async () => {
  let release!: (value: unknown) => void; state.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValueOnce(ok("Current source"));
  await act(async () => root!.render(view())); await act(async () => { root!.render(view("doc", "owner/second")); await new Promise(resolve => setTimeout(resolve,0)); });
  await act(async () => { release(ok("Earlier source")); await new Promise(resolve => setTimeout(resolve,0)); });
  expect(host.textContent).toContain("Current source"); expect(host.textContent).not.toContain("Earlier source"); expect(state.read.mock.calls[0][3].aborted).toBe(true);
});
