// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PublishToRepoDialog } from "@/components/github/publish-to-repo-dialog";
import { ReposPanel } from "@/components/panels/repos-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { github } from "@/lib/i18n/sections/github";
import { qk } from "@/lib/queries/keys";
import type { GithubRepo } from "@/lib/github";
const state = vi.hoisted(() => ({ ok: vi.fn(), err: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => state }));
vi.mock("@/lib/github-auth", () => ({ connectGitHub: vi.fn(async () => { throw Error("invented fixture"); }) }));
vi.mock("@/components/ui/confirmation-dialog", () => ({ useConfirmation: () => async () => true }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement, client: QueryClient;
const repo: GithubRepo = { id: 123, name: "fixture", full_name: "owner/fixture", owner: "owner", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/owner/fixture", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
const close = vi.fn();
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); document.documentElement.lang = "cs"; });
async function render(getMarkdown: () => Promise<string>, connected = true) {
  vi.stubGlobal("localStorage", new Storage()); document.documentElement.lang = "en";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.setQueryData(qk.repos, connected ? { kind: "ok", repos: [repo] } : { kind: "disconnected" });
  await act(async () => root!.render(<QueryClientProvider client={client}><PublishToRepoDialog getMarkdown={getMarkdown} defaultFileName="fixture" defaultMessage="Save fixture" onClose={close}/></QueryClientProvider>));
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === text)!;
it("locks fields and dismissal while exporting, then restores them with the same draft after failure", async () => {
  let reject!: (error: Error) => void;
  await render(() => new Promise((_resolve, failure) => { reject = failure; }));
  const path = document.querySelector<HTMLInputElement>("input")!;
  await act(async () => { button(github.en.commit).click(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(path.disabled).toBe(true); expect(button(github.en.cancel).disabled).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-busy")).toBe("true");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(close).not.toHaveBeenCalled();
  await act(async () => reject(Error("invented fixture")));
  expect(state.err).toHaveBeenCalledWith(github.en.notesPushErr); expect(path.disabled).toBe(false); expect(path.value).toBe("notes/fixture.md");
});
it("retains the dialog after an expired connection", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  await render(async () => "Reviewed fixture"); await act(async () => { button(github.en.commit).click(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(state.err).toHaveBeenCalledWith(github.en.reconnect); expect(close).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLInputElement>("input")?.value).toBe("notes/fixture.md");
});
it("shows an existing file without claiming a new commit or changing repository activity", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ path: "notes/fixture.md", updated: true, unchanged: true, commit: null, content: { sha: "a".repeat(40), html_url: "https://github.com/owner/fixture/blob/main/notes/fixture.md" } })));
  await render(async () => "Reviewed fixture"); await act(async () => { button(github.en.commit).click(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(state.ok).toHaveBeenCalledWith(github.en.alreadySaved);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(github.en.alreadySaved);
  expect(client.getQueryData(qk.repos)).toEqual({ kind: "ok", repos: [repo] });
  expect(document.querySelector('a[target="_blank"]')?.getAttribute("href")).toContain("/blob/main/");
});
it("restores a failed connection button without leaking the private cause", async () => {
  await render(async () => "Fixture", false); await act(async () => button(github.en.connect).click());
  expect(state.err).toHaveBeenCalledWith(github.en.connectErr); expect(button(github.en.connect).disabled).toBe(false);
});
it("keeps a typed file draft when GitHub disconnects during the write", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  await render(async () => "Unused fixture");
  await act(async () => root!.render(<QueryClientProvider client={client}><TooltipProvider><ReposPanel initialVisibleIds={[]} repoNotes={[]} setRepoNotes={() => undefined} repoLinks={[]} setRepoLinks={() => undefined}/></TooltipProvider></QueryClientProvider>));
  const write = document.querySelector<HTMLButtonElement>(`button[aria-label="${github.en.writeFile}"]`)!;
  await act(async () => write.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  const path = dialog.querySelector<HTMLInputElement>("input")!;
  const content = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(path, "notes/recovery.md"); path.dispatchEvent(new Event("input", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(content, "Keep my reviewed draft"); content.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { button(github.en.commit).click(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(state.err).toHaveBeenCalledWith(github.en.reconnect); expect(client.getQueryData(qk.repos)).toEqual({ kind: "disconnected" });
  expect(document.querySelector('[role="dialog"]')).toBe(dialog); expect(path.value).toBe("notes/recovery.md"); expect(content.value).toBe("Keep my reviewed draft"); expect(content.disabled).toBe(false);
});
