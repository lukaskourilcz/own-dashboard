// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlansPanel } from "@/components/panels/plans-panel";
import { ConfirmationProvider } from "@/components/ui/confirmation-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { plans as copy } from "@/lib/i18n/sections/plans";
import type { Plan } from "@/lib/types";

const state = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/supabase/user", () => ({ currentUserId: async () => "owner" }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({
  insert: (payload: unknown) => { state.insert(payload); return { select: () => ({ single: async () => ({ data: saved, error: null }) }) }; },
  update: (payload: unknown) => { state.update(payload); return { eq: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "offline" } }) }) }) }; },
}) }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const saved: Plan = { id: "plan-owner", user_id: "owner", title: "Calendar failure", target_date: "2026-10-24", status: "idea", recurrence: "none", notes: null, linked_calendar_event_id: null, last_completed_at: null, created_at: "2026-10-23T12:00:00Z", updated_at: "2026-10-23T12:00:00Z" };
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.stubGlobal("localStorage", new Storage()); document.documentElement.lang = "en";
  state.insert.mockReset(); state.update.mockReset();
  host=document.createElement("div"); document.body.append(host); root=createRoot(host);
  client=new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); document.documentElement.lang=""; vi.unstubAllGlobals(); });
const wait = () => act(async () => { await new Promise(done => setTimeout(done, 30)); });
function Harness() { const [plans, setPlans]=useState<Plan[]>([]); return <PlansPanel plans={plans} setPlans={setPlans} />; }
function fill(id: string, value: string) {
  const field=document.getElementById(id)!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(field,value); field.dispatchEvent(new Event("input",{bubbles:true})); field.dispatchEvent(new Event("change",{bubbles:true})); });
}
for (const failure of ["network", "http", "link"] as const) it(`keeps the saved plan when the optional calendar stage fails (${failure})`, async () => {
  vi.stubGlobal("fetch", failure === "network" ? vi.fn().mockRejectedValue(new Error("offline")) : vi.fn().mockResolvedValue(Response.json(failure === "link" ? { id: "created-event" } : {}, { status: failure === "link" ? 200 : 503 })));
  act(() => root.render(<QueryClientProvider client={client}><TooltipProvider><ConfirmationProvider><Harness /></ConfirmationProvider></TooltipProvider></QueryClientProvider>));
  await wait();
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === copy.en.newPlan)!.click());
  fill("plan-title",saved.title); fill("plan-date",saved.target_date!);
  act(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.click());
  act(() => document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  await wait(); await wait();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain(saved.title);
  expect(host.querySelector('[role="status"]')?.textContent).toBe(failure === "link" ? copy.en.calendarLinkFailed : copy.en.calendarEventFailed);
  expect(state.insert).toHaveBeenCalledTimes(1);
  expect(state.update).toHaveBeenCalledTimes(failure === "link" ? 1 : 0);
});
