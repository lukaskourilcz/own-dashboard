// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RelinkGoogleButton } from "@/components/calendar/relink-cta";
import { NavigationGuardProvider, useUnsavedDraft } from "@/components/navigation-guard";
import { common } from "@/lib/i18n/sections/common";
import { relink } from "@/lib/i18n/sections/relink";
const state = vi.hoisted(() => ({ start: vi.fn(), discard: vi.fn(), dirty: false }));
vi.mock("@/lib/google-auth", () => ({ relinkGoogle: state.start }));
vi.mock("@/lib/i18n", () => ({ useDict: () => ({ common: common.en, relink: relink.en }), useLang: () => ({ lang: "en" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement;
function Draft() { useUnsavedDraft({ get dirty() { return state.dirty; }, canSave: false, save: async () => false, discard: () => { state.dirty = false; state.discard(); } }); return <RelinkGoogleButton />; }
beforeEach(() => { vi.resetAllMocks(); state.dirty = false; host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root!.render(<NavigationGuardProvider><Draft /></NavigationGuardProvider>)); });
afterEach(() => { act(() => root?.unmount()); host.remove(); });
const button = () => host.querySelector<HTMLButtonElement>("button")!;
function click(text: string) { [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!.click(); }
it("refuses same-event duplicate starts and keeps the redirect state while navigation begins", async () => {
  let done!: (value: unknown) => void; state.start.mockImplementationOnce(() => new Promise(resolve => { done = resolve; })); await act(async () => { button().click(); button().click(); });
  expect(state.start).toHaveBeenCalledTimes(1); expect(button().disabled).toBe(true); expect(button().getAttribute("aria-busy")).toBe("true");
  await act(async () => done({})); expect(button().disabled).toBe(true);
});
it("catches a rejection, announces one translated error associated with its action and allows retry", async () => {
  state.start.mockRejectedValueOnce(Error("Private backend detail")); await act(async () => button().click()); expect(button().disabled).toBe(false);
  const alert = host.querySelector('[role="alert"]')!; expect(alert.textContent).toBe(relink.en.failed); expect(button().getAttribute("aria-describedby")).toBe(alert.id); expect(host.textContent).not.toContain("Private backend detail");
  state.start.mockResolvedValueOnce({}); await act(async () => button().click()); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(state.start).toHaveBeenCalledTimes(2);
});
it("handles a returned failure without exposing provider text", async () => {
  state.start.mockResolvedValueOnce({ error: "Private provider text" }); await act(async () => button().click()); expect(host.querySelector('[role="alert"]')!.textContent).toBe(relink.en.failed); expect(button().disabled).toBe(false);
});
it("aborts its caller on unmount and ignores a late rejection", async () => {
  let reject!: (value: unknown) => void; state.start.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })); await act(async () => button().click()); const signal = state.start.mock.calls[0][0] as AbortSignal;
  act(() => { root!.unmount(); root = undefined; }); expect(signal.aborted).toBe(true); await act(async () => reject(Error("Late failure"))); expect(host.textContent).toBe("");
});
it("protects an existing draft before starting any OAuth preparation", async () => {
  state.dirty = true; state.start.mockResolvedValueOnce({}); await act(async () => button().click()); expect(state.start).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(common.en.unsaved.title);
  await act(async () => click(common.en.unsaved.stay)); expect(state.discard).not.toHaveBeenCalled();
  await act(async () => button().click()); await act(async () => click(common.en.unsaved.discard)); expect(state.discard).toHaveBeenCalledTimes(1); expect(state.start).toHaveBeenCalledTimes(1);
});
