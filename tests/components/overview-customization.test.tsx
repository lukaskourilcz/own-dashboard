// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CustomizableOverview } from "@/components/overview/customizable-overview";
import { DEFAULT_LAYOUT } from "@/lib/dashboard-layout";
const state = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/lib/preference-client", () => ({ useSaveUserPreferences: () => state.save }));
vi.mock("@/lib/use-dashboard-layout", () => ({ useDashboardLayout: () => ({ layout: DEFAULT_LAYOUT, setLayout: vi.fn() }) }));
vi.mock("@/lib/use-prefs", () => ({ useNavVisibility: () => ({ isHidden: () => false }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); document.documentElement.lang=""; vi.clearAllMocks(); });
it("makes widget controls inert during customization and reports a failed cross-device save", async () => {
  state.save.mockRejectedValue(new Error("offline"));document.documentElement.lang="en";
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  const nodes=Object.fromEntries(DEFAULT_LAYOUT.map(id => [id,<button key={id}>Inner control</button>])) as Parameters<typeof CustomizableOverview>[0]["nodes"];
  act(() => root!.render(<CustomizableOverview nodes={nodes} />));
  const customize=[...host.querySelectorAll("button")].find(b => b.textContent==="Customize")!;
  act(() => customize.click());
  expect(host.querySelectorAll('[inert]')).toHaveLength(DEFAULT_LAYOUT.length);
  act(() => (host.querySelector('button[aria-label="Remove widget"]') as HTMLButtonElement).click());
  await act(async () => { await new Promise(done => setTimeout(done,10)); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not sync");
  expect(state.save).toHaveBeenCalledTimes(1);
});
