// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const remote = vi.hoisted(() => vi.fn());
vi.mock("@/lib/preference-client", () => ({ saveUserPreferences: remote }));
import { parseRepositoryFilter, useRepositoryFilter, writeRepoFilter } from "@/lib/repository-filter";
import { saveRepositoryFilter as saveFilter } from "@/lib/repository-filter-save";
const saveRepositoryFilter = (ids: readonly string[]) => saveFilter(ids, remote);
import { RepositoryFilterDialog } from "@/components/github/repository-filter-dialog";
import type { GithubRepo } from "@/lib/github";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, storage: Storage;
const initial = ["99"];
function Probe({ serverAvailable = false }: { serverAvailable?: boolean }) { return <output>{JSON.stringify(useRepositoryFilter(initial, serverAvailable))}</output>; }
const snapshot = () => JSON.parse(host.textContent!);
const external = () => window.dispatchEvent(new StorageEvent("storage", { key: "visibleRepoIds", newValue: '["obsolete"]' }));
beforeEach(async () => {
  storage = new Storage(); vi.stubGlobal("localStorage", storage); remote.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<Probe />); }); act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("distinguishes an unavailable selection from a confirmed show-all value", async () => {
  expect(snapshot()).toEqual({ ids: [], available: false });
  await act(async () => root.render(<Probe serverAvailable />)); expect(snapshot()).toEqual({ ids: ["99"], available: true });
  act(() => { expect(writeRepoFilter([])).toBe(true); }); expect(snapshot()).toEqual({ ids: [], available: true });
});
it.each([["0"], ["9007199254740992"], [42], Array(501).fill("1"), "wrong", null])("refuses malformed filters without enabling automatic sync (%j)", value => {
  expect(parseRepositoryFilter(value)).toBeNull(); storage.setItem("visibleRepoIds", JSON.stringify(value)); act(external); expect(snapshot()).toEqual({ ids: [], available: false });
});
it("observes current cross-tab data without posting or echoing storage", () => {
  storage.setItem("visibleRepoIds", '["123","123"]'); const write = vi.spyOn(storage, "setItem"); act(external);
  expect(snapshot()).toEqual({ ids: ["123"], available: true }); expect(write).not.toHaveBeenCalled(); expect(remote).not.toHaveBeenCalled();
});
it("rejects oversized saved JSON before decoding a selection", () => {
  storage.setItem("visibleRepoIds", '"' + "x".repeat(10_001) + '"'); act(external);
  expect(snapshot()).toEqual({ ids: [], available: false });
});
it("does not publish an unconfirmed failed device write", () => {
  vi.spyOn(storage, "setItem").mockImplementation(() => { throw Error("Quota"); });
  act(() => { expect(writeRepoFilter(["123"])).toBe(false); }); expect(snapshot()).toEqual({ ids: [], available: false });
  act(() => { expect(writeRepoFilter(["123"], { allowMemoryFallback: true })).toBe(false); }); expect(snapshot()).toEqual({ ids: ["123"], available: true });
});
it("does not call a silently ignored device write persisted", () => {
  vi.spyOn(storage, "setItem").mockImplementation(() => undefined);
  act(() => { expect(writeRepoFilter(["123"])).toBe(false); }); expect(snapshot()).toEqual({ ids: [], available: false });
});
it("reports a local-only save when synchronization fails", async () => {
  remote.mockRejectedValue(Error("Offline")); let result;
  await act(async () => { result = await saveRepositoryFilter(["123"]); });
  expect(result).toEqual({ device: true, server: false, current: true }); expect(snapshot()).toEqual({ ids: ["123"], available: true });
});
it("requires a server receipt before applying a memory-only selection", async () => {
  vi.spyOn(storage, "setItem").mockImplementation(() => { throw Error("Quota"); });
  remote.mockRejectedValueOnce(Error("Offline"));
  await act(async () => { await expect(saveRepositoryFilter(["123"])).rejects.toThrow("unconfirmed"); }); expect(snapshot()).toEqual({ ids: [], available: false });
  let result; await act(async () => { result = await saveRepositoryFilter(["456"]); }); expect(result).toEqual({ device: false, server: true, current: true }); expect(snapshot()).toEqual({ ids: ["456"], available: true });
});
it("does not replace a newer cross-tab selection with a late server-only receipt", async () => {
  const write = vi.spyOn(storage, "setItem").mockImplementation(() => { throw Error("Quota"); });
  let release!: () => void; remote.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  let pending!: ReturnType<typeof saveRepositoryFilter>; act(() => { pending = saveRepositoryFilter(["123"]); });
  write.mockRestore(); storage.setItem("visibleRepoIds", '["456"]'); act(external);
  let result; await act(async () => { release(); result = await pending; });
  expect(result).toEqual({ device: false, server: true, current: false }); expect(snapshot()).toEqual({ ids: ["456"], available: true });
});
it("retains saved and newly selected ids that leave the provider result page", async () => {
  const repo = (id: number) => ({ id, full_name: `owner/repo-${id}`, private: true }) as GithubRepo;
  const save = vi.fn().mockResolvedValue(true), close = vi.fn();
  await act(async () => root.render(<RepositoryFilterDialog repos={[repo(123), repo(456)]} initialVisibleIds={["123", "999"]} saving={false} onSave={save} onClose={close} />));
  act(() => [...document.querySelectorAll("button")].find(button => button.textContent === "owner/repo-456")!.click());
  await act(async () => root.render(<RepositoryFilterDialog repos={[repo(123), repo(777)]} initialVisibleIds={["123", "999"]} saving={false} onSave={save} onClose={close} />));
  await act(async () => [...document.querySelectorAll("button")].find(button => ["Save", "Uložit"].includes(button.textContent!))!.click());
  expect(save).toHaveBeenCalledWith(["123", "999", "456"]);
});
