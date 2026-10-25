// @vitest-environment happy-dom
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Storage } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OwnerPreferencesProvider, useOwnerPreferences } from "@/lib/owner-preferences";
import { GuestPreferencesProvider } from "@/lib/guest-preferences";
import { useCvLinks, useCzechCareerVisibility } from "@/lib/use-prefs";
import { PreferenceHydrator, type SyncedUiPreferences } from "@/components/preference-hydrator";
import { DEFAULT_UI_PREFERENCES } from "@/lib/ui-preferences-contract";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, storage: Storage, api: ReturnType<typeof useCvLinks>, owner: ReturnType<typeof useOwnerPreferences>;
const url = (id: string) => `https://docs.example.test/${id}`;
function Probe() { const links = useCvLinks(), visibility = useCzechCareerVisibility(), scope = useOwnerPreferences(); useLayoutEffect(() => { api = links; owner = scope; }); return <output>{JSON.stringify({ cs: links.cs, en: links.en, czech: visibility.showCzechCareer })}</output>; }
const values = (cs = "", czech = false) => ({ cv_url_cs: cs, cv_url_en: "", show_czech_career: czech });
function View({ id = "owner-a", preferences, seed = false, guest = false }: { id?: string; preferences?: SyncedUiPreferences; seed?: boolean; guest?: boolean }) {
  const content = <>{preferences && <PreferenceHydrator preferences={preferences} />}<Probe /></>;
  return <StrictMode><OwnerPreferencesProvider ownerId={id} initial={seed && preferences?.sync_available ? values(preferences.cv_url_cs, preferences.show_czech_career) : undefined}>{guest ? <GuestPreferencesProvider>{content}</GuestPreferencesProvider> : content}</OwnerPreferencesProvider></StrictMode>;
}
const preferences = (available: boolean, cs = url("server")) => ({ ...DEFAULT_UI_PREFERENCES, cv_url_cs: cs, sync_available: available });
const key = (id = "owner-a", field = "cv_url_cs") => `owner-preference:${id}:${field}`;
const snapshot = () => JSON.parse(host.querySelector("output")!.textContent!);
beforeEach(() => { storage = new Storage(); vi.stubGlobal("localStorage", storage); storage.setItem("cvUrlCs", url("legacy")); storage.setItem("showCzechCareer", "1"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("does not read or adopt legacy unowned values and hydrates after an unavailable first copy", async () => {
  const read = vi.spyOn(storage, "getItem");
  await act(async () => root.render(<View preferences={preferences(false)} />));
  expect(snapshot()).toEqual({ cs: "", en: "", czech: false }); expect(read.mock.calls.some(([key]) => key === "cvUrlCs" || key === "showCzechCareer")).toBe(false);
  await act(async () => root.render(<View preferences={preferences(true)} />)); expect(snapshot().cs).toBe(url("server"));
  expect(storage.getItem("cvUrlCs")).toBe(url("legacy"));
});
it("switches owner on the first render and restores only that owner's draft", async () => {
  await act(async () => root.render(<View />)); await act(async () => api.setCs(url("a-draft")));
  await act(async () => root.render(<View id="owner-b" />)); expect(snapshot().cs).toBe("");
  await act(async () => api.setCs(url("b-draft"))); await act(async () => root.render(<View />)); expect(snapshot().cs).toBe(url("a-draft"));
  expect(JSON.parse(storage.getItem(key("owner-b"))!).value).toBe(url("b-draft"));
});
it("preserves a newer draft during late hydration and only clears dirty state for its exact confirmed value", async () => {
  await act(async () => root.render(<View preferences={preferences(false)} />)); await act(async () => api.setCs(url("draft")));
  await act(async () => root.render(<View preferences={preferences(true)} />)); expect(snapshot().cs).toBe(url("draft"));
  act(() => owner!.confirm({ cv_url_cs: url("old") })); expect(JSON.parse(storage.getItem(key())!).dirty).toBe(true);
  act(() => owner!.confirm({ cv_url_cs: url("draft") })); expect(JSON.parse(storage.getItem(key())!).dirty).toBe(false);
  await act(async () => root.render(null)); await act(async () => root.render(<View seed preferences={preferences(true, url("fresh-server"))} />)); expect(snapshot().cs).toBe(url("fresh-server"));
});
it("does not overwrite an owner-scoped unsaved draft with a fresh server seed", async () => {
  storage.setItem(key(), JSON.stringify({ value: url("retained"), dirty: true }));
  await act(async () => root.render(<View seed preferences={preferences(true)} />)); expect(snapshot().cs).toBe(url("retained"));
});
it("reconciles same-owner current storage and ignores foreign events without echoing a request or write", async () => {
  await act(async () => root.render(<View />)); storage.setItem(key("owner-b"), JSON.stringify({ value: url("foreign"), dirty: true }));
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: key("owner-b") }))); expect(snapshot().cs).toBe("");
  storage.setItem(key(), JSON.stringify({ value: url("peer"), dirty: true })); const write = vi.spyOn(storage, "setItem"), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: key(), newValue: JSON.stringify({ value: url("stale"), dirty: true }) })));
  expect(snapshot().cs).toBe(url("peer")); expect(write).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it("retains an in-memory draft when storage refuses writes, including after subscription resumes", async () => {
  await act(async () => root.render(<View />)); vi.spyOn(storage, "setItem").mockImplementation(() => { throw Error("blocked"); });
  await act(async () => api.setCs(url("memory"))); expect(snapshot().cs).toBe(url("memory"));
  act(() => owner!.hydrate(values(url("older-server")))); expect(snapshot().cs).toBe(url("memory"));
});
it("server-renders only the captured owner's seed and a nested guest never inherits it", () => {
  const read = vi.spyOn(storage, "getItem"); const initial = values(url("owned"), true);
  expect(renderToStaticMarkup(<OwnerPreferencesProvider ownerId="owner-a" initial={initial}><Probe /></OwnerPreferencesProvider>)).toContain(url("owned"));
  expect(renderToStaticMarkup(<OwnerPreferencesProvider ownerId="owner-a" initial={initial}><GuestPreferencesProvider><Probe /></GuestPreferencesProvider></OwnerPreferencesProvider>)).not.toContain(url("owned")); expect(read).not.toHaveBeenCalled();
});
it.each(["{", JSON.stringify({ value: 42, dirty: true }), '"' + "x".repeat(10_001) + '"'])("refuses malformed owner drafts (%s)", async raw => {
  storage.setItem(key(), raw); await act(async () => root.render(<View />)); expect(snapshot().cs).toBe("");
});

it("cancels a captured scope on owner switch and provides a usable replacement under Strict Mode", async () => {
  await act(async () => root.render(<View />)); const earlier = owner!.capture(); expect(earlier.signal.aborted).toBe(false);
  await act(async () => root.render(<View id="owner-b" />)); expect(earlier.signal.aborted).toBe(true);
  expect(owner!.capture().ownerId).toBe("owner-b"); expect(owner!.capture().signal.aborted).toBe(false);
});
