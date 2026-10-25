// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuestBoundary } from "@/components/guest-boundary";
import { OwnerPreferencesProvider } from "@/lib/owner-preferences";
import { GuestPreferencesProvider } from "@/lib/guest-preferences";
import { useCvLinks, useCzechCareerVisibility } from "@/lib/use-prefs";
import { guest } from "@/lib/i18n/sections/guest";
vi.mock("@/lib/i18n", () => ({ useDict: () => ({ guest: guest.en }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, storage: Storage, api: ReturnType<typeof useCvLinks>, career: ReturnType<typeof useCzechCareerVisibility>;
function Probe() { const value = useCvLinks(), visibility = useCzechCareerVisibility(); useLayoutEffect(() => { api = value; career = visibility; }); return <output>{JSON.stringify({ cs: value.cs, en: value.en, czech: visibility.showCzechCareer })}</output>; }
function Mirror() { const value = useCvLinks(); return <aside>{value.cs}</aside>; }
beforeEach(() => {
  storage = new Storage(); vi.stubGlobal("localStorage", storage); storage.setItem("cvUrlCs", "synthetic-owner-cs"); storage.setItem("cvUrlEn", "synthetic-owner-en"); storage.setItem("showCzechCareer", "1");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const snapshot = () => JSON.parse(host.querySelector("output")!.textContent!);
it("never sources personal tour fields from owner storage or primed owner caches on its first render", async () => {
  await act(async () => root.render(<OwnerPreferencesProvider ownerId="owner" initial={{ cv_url_cs: "synthetic-owner-cs", cv_url_en: "synthetic-owner-en", show_czech_career: true }}><Probe /></OwnerPreferencesProvider>)); expect(snapshot()).toEqual({ cs: "synthetic-owner-cs", en: "synthetic-owner-en", czech: true });
  await act(async () => root.render(null)); const read = vi.spyOn(storage,"getItem"), write = vi.spyOn(storage,"setItem");
  await act(async () => root.render(<GuestBoundary><Probe /><Mirror /></GuestBoundary>));
  expect(snapshot()).toEqual({ cs: "", en: "", czech: false }); expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("synthetic-owner");
});
it("shares tour edits in memory and preserves owner values after leaving the tour", async () => {
  await act(async () => root.render(<GuestBoundary><Probe /><Mirror /></GuestBoundary>)); const write = vi.spyOn(storage,"setItem");
  await act(async () => { api.setCs("synthetic-tour-cs"); api.setEn("synthetic-tour-en"); career.setShowCzechCareer(true); });
  expect(snapshot()).toEqual({ cs: "synthetic-tour-cs", en: "synthetic-tour-en", czech: true }); expect(host.querySelector("aside")!.textContent).toBe("synthetic-tour-cs"); expect(write).not.toHaveBeenCalled();
  await act(async () => root.render(<OwnerPreferencesProvider ownerId="owner" initial={{ cv_url_cs: "synthetic-owner-cs", cv_url_en: "synthetic-owner-en", show_czech_career: true }}><Probe /></OwnerPreferencesProvider>)); expect(snapshot()).toEqual({ cs: "synthetic-owner-cs", en: "synthetic-owner-en", czech: true });
  expect(storage.getItem("cvUrlCs")).toBe("synthetic-owner-cs"); expect(storage.getItem("cvUrlEn")).toBe("synthetic-owner-en");
});
it("drops the previous tour's memory when a new tour is mounted", async () => {
  await act(async () => root.render(<GuestBoundary><Probe /></GuestBoundary>)); await act(async () => api.setCs("synthetic-tour")); await act(async () => root.render(null));
  await act(async () => root.render(<GuestBoundary><Probe /></GuestBoundary>)); expect(snapshot()).toEqual({ cs: "", en: "", czech: false });
});
it("server-renders no device CV data", () => {
  const read = vi.spyOn(storage,"getItem"); const html = renderToStaticMarkup(<GuestPreferencesProvider><Probe /></GuestPreferencesProvider>);
  expect(html).not.toContain("synthetic-owner"); expect(read).not.toHaveBeenCalled();
});
