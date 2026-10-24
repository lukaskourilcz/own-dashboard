// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordLastLoad, useLastLoad } from "@/lib/on-demand-load";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const first = "owner:first:opportunities", other = "owner:second:opportunities", preview = "preview:opportunities", at = "2026-10-24T10:00:00.000Z";
let root: Root, host: HTMLDivElement;
function Probe({ scope = first }: { scope?: string }) { const value = useLastLoad(scope); return <output>{JSON.stringify(value)}</output>; }
const key = (scope: string) => `on-demand-load:${scope}`;
const stored = (counts: unknown = { opportunities: 2 }, date = at) => JSON.stringify({ at: date, counts });
const snapshot = () => JSON.parse(host.textContent!);
beforeEach(() => { sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); sessionStorage.clear(); });
it("separates owner/preview scopes and ignores unscoped legacy metadata", async () => {
  sessionStorage.setItem(key("opportunities"),stored({ opportunities: 999 })); sessionStorage.setItem(key(first),stored({ opportunities: 2 })); sessionStorage.setItem(key(other),stored({ opportunities: 7 }));
  await act(async () => root.render(<Probe />)); expect(snapshot().counts.opportunities).toBe(2);
  await act(async () => root.render(<Probe scope={other} />)); expect(snapshot().counts.opportunities).toBe(7);
  await act(async () => root.render(<Probe scope={preview} />)); expect(snapshot()).toBeNull();
  await act(async () => recordLastLoad(preview,{ opportunities: 3, platforms: 0 })); expect(snapshot().counts).toEqual({ opportunities: 3, platforms: 0 }); expect(JSON.parse(sessionStorage.getItem(key(first))!).counts.opportunities).toBe(2);
});
it("records only bounded nonnegative whole counts and keeps the last confirmed metadata on malformed writes", async () => {
  await act(async () => root.render(<Probe />)); await act(async () => recordLastLoad(first,{ opportunities: 2 })); const original = sessionStorage.getItem(key(first));
  for (const counts of [{ opportunities: -1 }, { opportunities: 1.5 }, { opportunities: Infinity }, { opportunities: Number.MAX_SAFE_INTEGER + 1 }, { opportunities: NaN }, Object.fromEntries(Array.from({ length: 21 },(_, i)=>[`key${i}`,i])), { ["k".repeat(65)]: 1 }]) await act(async () => recordLastLoad(first,counts));
  expect(sessionStorage.getItem(key(first))).toBe(original); expect(snapshot().counts).toEqual({ opportunities: 2 });
  recordLastLoad("opportunities",{ opportunities: 8 }); recordLastLoad("owner::opportunities",{ opportunities: 8 }); expect(sessionStorage.getItem(key("opportunities"))).toBeNull();
});
it("rejects malformed, impossible, negative, fractional and overbound stored metadata", async () => {
  for (const raw of ["x".repeat(4097), "{", "[]", "null", stored([],at), stored({ opportunities: -1 }), stored({ opportunities: .5 }), stored({ opportunities: "2" }), stored({ opportunities: 2 },"2026-02-31T10:00:00.000Z"), stored({ opportunities: 2 },"today"), JSON.stringify({ at, counts: {}, extra: true })]) {
    sessionStorage.setItem(key(first),raw); await act(async () => { root.render(<Probe />); window.dispatchEvent(new PageTransitionEvent("pageshow")); }); expect(snapshot()).toBeNull();
  }
});
it("reconciles resumed session metadata and scoped storage events without writing it again", async () => {
  await act(async () => root.render(<Probe />)); sessionStorage.setItem(key(first),stored({ opportunities: 4 })); const set = vi.spyOn(sessionStorage,"setItem");
  await act(async () => window.dispatchEvent(new PageTransitionEvent("pageshow"))); expect(snapshot().counts.opportunities).toBe(4); expect(set).not.toHaveBeenCalled();
  sessionStorage.setItem(key(first),stored({ opportunities: 5 })); await act(async () => window.dispatchEvent(new StorageEvent("storage",{ key:key(first), storageArea: sessionStorage }))); expect(snapshot().counts.opportunities).toBe(5);
  sessionStorage.removeItem(key(first)); await act(async () => window.dispatchEvent(new StorageEvent("storage",{ key:null, storageArea: sessionStorage }))); expect(snapshot()).toBeNull();
});
it("degrades to unknown metadata when session storage is blocked", async () => {
  vi.spyOn(window,"sessionStorage","get").mockImplementation(() => { throw Error("Storage blocked"); }); await act(async () => root.render(<Probe />));
  await act(async () => recordLastLoad(first,{ opportunities: 1 })); expect(snapshot()).toBeNull();
});
