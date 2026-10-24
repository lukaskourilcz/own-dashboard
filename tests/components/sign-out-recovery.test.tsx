// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/nav/sidebar";
import { NavigationGuardProvider, useUnsavedDraft } from "@/components/navigation-guard";
import { nav } from "@/lib/i18n/sections/nav";
import { common } from "@/lib/i18n/sections/common";
const state = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ err: state.error }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); state.error.mockReset(); document.documentElement.lang = "cs"; });
function Draft() {
  const [dirty, setDirty] = useState(true);
  useUnsavedDraft({ dirty, canSave: true, save: async () => { setDirty(false); return true; }, discard: () => setDirty(false) });
  return <p>{dirty ? "Retained fixture draft" : "Saved or discarded fixture draft"}</p>;
}
const sidebar = <Sidebar tab="home" setTab={() => undefined} projects={[]} onOpenProject={() => undefined} user={{ name: "Fixture", email: "fixture@example.invalid", avatar_url: null }} syncPreferences />;
async function render(lang: "en" | "cs", dirty = false) {
  vi.stubGlobal("localStorage", new Storage()); document.documentElement.lang = lang;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<TooltipProvider><NavigationGuardProvider>{dirty && <Draft />}{sidebar}</NavigationGuardProvider></TooltipProvider>));
}
for (const lang of ["en", "cs"] as const) it(`${lang}: failed sign-out retains the app and enables retry with localized feedback`, async () => {
  let release!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { release = resolve; })); vi.stubGlobal("fetch", fetcher);
  await render(lang);
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${nav[lang].signOut}"]`)!;
  await act(async () => button.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(button.disabled).toBe(true); expect(button.getAttribute("aria-busy")).toBe("true"); expect(fetcher).toHaveBeenCalledOnce();
  await act(async () => { release(Response.json({ error: "synthetic-private" }, { status: 503 })); });
  expect(button.disabled).toBe(false); expect(state.error).toHaveBeenCalledWith(nav[lang].signOutFailed); expect(host.textContent).not.toContain("synthetic-private");
});
it("checks the unsaved-draft guard before any logout or provider revocation request", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "unavailable" }, { status: 503 })); vi.stubGlobal("fetch", fetcher);
  await render("en", true);
  const form = host.querySelector("form[action='/auth/signout']")!;
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(fetcher).not.toHaveBeenCalled();
  const stay = [...document.querySelectorAll("button")].find(button => button.textContent === common.en.unsaved.stay)!;
  await act(async () => stay.click()); expect(fetcher).not.toHaveBeenCalled(); expect(host.textContent).toContain("Retained fixture draft");
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const discard = [...document.querySelectorAll("button")].find(button => button.textContent === common.en.unsaved.discard)!;
  await act(async () => discard.click()); expect(fetcher).toHaveBeenCalledOnce(); expect(state.error).toHaveBeenCalledWith(nav.en.signOutFailed);
});

it("starts a new login document only after the successful receipt", async () => {
  const navigate = vi.spyOn(window.location, "replace").mockImplementation(() => {});
  const fetcher = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
  await render("en"); const form = host.querySelector("form[action='/auth/signout']")!;
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(navigate).toHaveBeenCalledWith(new URL("/login", window.location.origin).href); expect(state.error).not.toHaveBeenCalled();
});
