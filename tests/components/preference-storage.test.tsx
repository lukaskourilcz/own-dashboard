// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import { subscribeStoredPreference } from "@/lib/preference-storage";
import { useTheme } from "@/lib/use-theme";
import { useLang } from "@/lib/i18n/lang";
import { useDisplayCurrency, useTasksPerCategory, useNavVisibility, useCvLinks } from "@/lib/use-prefs";
import { useDashboardLayout } from "@/lib/use-dashboard-layout";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const cleanups: (() => void)[] = [];
afterEach(() => { act(() => root?.unmount()); host?.remove(); cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); document.documentElement.lang = "cs"; document.documentElement.classList.remove("dark"); });
function external(key: string | null) { window.dispatchEvent(new StorageEvent("storage", { key })); }
it("shares one observer, ignores unrelated/session events and removes it after the last subscriber", () => {
  vi.stubGlobal("localStorage", new Storage());
  const listeners = new Set<() => void>(), first = vi.fn(), second = vi.fn(), changed = vi.fn();
  const stopFirst = subscribeStoredPreference("synthetic-pref", listeners, first, changed), stopSecond = subscribeStoredPreference("synthetic-pref", listeners, second, changed); cleanups.push(stopFirst, stopSecond);
  external("other"); window.dispatchEvent(new StorageEvent("storage", { key: "synthetic-pref", storageArea: window.sessionStorage })); expect(changed).not.toHaveBeenCalled();
  external("synthetic-pref"); expect(changed).toHaveBeenCalledOnce(); expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  stopFirst(); external(null); expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledTimes(2);
  stopSecond(); external("synthetic-pref"); expect(changed).toHaveBeenCalledTimes(2);
});
it("reconciles a defined value written before subscription and changes made while unmounted", () => {
  const storage = new Storage(); vi.stubGlobal("localStorage", storage); const listeners = new Set<() => void>(), notify = vi.fn(); let snapshot = "light";
  const reconcile = () => { snapshot = storage.getItem("synthetic-theme") ?? "light"; };
  storage.setItem("synthetic-theme", "dark"); const stop = subscribeStoredPreference("synthetic-theme", listeners, notify, reconcile); cleanups.push(stop);
  expect(snapshot).toBe("dark"); stop(); storage.setItem("synthetic-theme", "light");
  cleanups.push(subscribeStoredPreference("synthetic-theme", listeners, notify, reconcile)); expect(snapshot).toBe("light");
});
it("preserves an in-memory change after unmount when storage did not change", () => {
  const storage = new Storage(); vi.stubGlobal("localStorage", storage); storage.setItem("synthetic-pref", "persisted");
  const listeners = new Set<() => void>(); let value = "persisted"; const reconcile = () => { value = storage.getItem("synthetic-pref")!; };
  const stop = subscribeStoredPreference("synthetic-pref", listeners, () => {}, reconcile); cleanups.push(stop); value = "local write unavailable"; stop();
  cleanups.push(subscribeStoredPreference("synthetic-pref", listeners, () => {}, reconcile)); expect(value).toBe("local write unavailable");
});
function Probe() {
  const { theme } = useTheme(), { lang } = useLang(), { currency } = useDisplayCurrency(), { count } = useTasksPerCategory(), { hidden } = useNavVisibility(), { cs } = useCvLinks(), { layout } = useDashboardLayout();
  return <output>{JSON.stringify({ theme, lang, currency, count, hidden, cs, layout })}</output>;
}
async function mount() {
  const storage = new Storage(); vi.stubGlobal("localStorage", storage); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<Probe/>); }); return storage;
}
function snapshot() { return JSON.parse(host.textContent!); }
it("updates subscribed preferences from current storage without persisting/reposting an event", async () => {
  const storage = await mount(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  storage.setItem("theme", "dark"); storage.setItem("lang", "en"); storage.setItem("displayCurrency", "EUR"); storage.setItem("tasksPerCategory", "10");
  storage.setItem("hiddenNavSections", JSON.stringify(["tasks"])); storage.setItem("cvUrlCs", "https://docs.example.test/synthetic"); storage.setItem("dashboardLayout", JSON.stringify(["crons"]));
  const write = vi.spyOn(storage, "setItem");
  act(() => { for (const key of ["theme", "lang", "displayCurrency", "tasksPerCategory", "hiddenNavSections", "cvUrlCs", "dashboardLayout"]) external(key); });
  expect(snapshot()).toEqual({ theme: "dark", lang: "en", currency: "EUR", count: 10, hidden: ["tasks"], cs: "", layout: ["crons"] });
  expect(document.documentElement.classList.contains("dark")).toBe(true); expect(document.documentElement.lang).toBe("en"); expect(write).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it("ignores an old event value and rejects malformed financial/task preferences", async () => {
  const storage = await mount(); storage.setItem("theme", "dark"); storage.setItem("displayCurrency", "INVALID"); storage.setItem("tasksPerCategory", "0.5");
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "light" })); external("displayCurrency"); external("tasksPerCategory"); });
  expect(snapshot()).toMatchObject({ theme: "dark", currency: "CZK", count: 5 });
  storage.clear(); act(() => external(null)); expect(snapshot()).toMatchObject({ lang: "cs", currency: "CZK", count: 5, hidden: [], cs: "" });
});
