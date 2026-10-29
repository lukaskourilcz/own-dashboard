// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import { DevFinancePanel } from "@/components/panels/dev-finance-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { portfolio } from "@/lib/i18n/sections/portfolio";
import type { Project, Subscription } from "@/lib/types";
const clock = vi.hoisted(() => ({ now: null as Date | null }));
vi.mock("@/lib/use-now", () => ({ useNow: () => clock.now }));
vi.mock("next/dynamic", () => ({ default: () => () => <div/> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const subscriptions = [
  { id: "running", name: "Synthetic running", started_on: "2026-01-01", ended_on: null },
  { id: "future", name: "Synthetic future", started_on: "2026-10-25", ended_on: null },
  { id: "ended", name: "Synthetic ended", started_on: "2026-01-01", ended_on: "2026-10-23" },
].map(row => ({ ...row, amount: 10, currency: "USD", category_group: "development", billing_cycle: "monthly", is_active: true, created_at: "2026-01-01T00:00:00Z", project_id: "p" })) as Subscription[];
const project = { id: "p", name: "Synthetic project", engagement: "own" } as Project;
const zeroProject = { id: "zero", name: "Synthetic client without spend", engagement: "client" } as Project;
function render() { act(() => root.render(<TooltipProvider><DevFinancePanel subscriptions={subscriptions} allocations={[]} transactions={[]} projects={[project, zeroProject]} projectCosts={[]} crons={[]} displayCurrency="USD" onOpenSubscriptions={() => {}} onOpenProject={() => {}}/></TooltipProvider>)); }
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.unstubAllGlobals(); clock.now = null; document.documentElement.lang = "cs"; });
it.each(["en", "cs"] as const)("%s shows loading before the local day is known and updates at a day change", lang => {
  vi.stubGlobal("localStorage", new Storage()); document.documentElement.lang = lang; host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  render(); expect(host.querySelector('[aria-busy="true"]')).not.toBeNull(); expect(host.textContent).not.toContain("$10.00");
  clock.now = new Date("2026-10-24T12:00:00"); render();
  expect(host.textContent).toContain(zeroProject.name);
  const rows = [...host.querySelectorAll("tr")]; const future = rows.find(row => row.textContent?.includes("Synthetic future"))!;
  expect(future.textContent).toContain(portfolio[lang].finance.notStarted); expect(rows.find(row => row.textContent?.includes("Synthetic ended"))!.textContent).toContain(portfolio[lang].finance.ended);
  clock.now = new Date("2026-10-25T12:00:00"); render(); expect([...host.querySelectorAll("tr")].find(row => row.textContent?.includes("Synthetic future"))!.textContent).toContain(portfolio[lang].finance.running);
});
