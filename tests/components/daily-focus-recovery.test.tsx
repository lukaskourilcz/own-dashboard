// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DailyFocusPanel } from "@/components/overview/daily-focus";
import { TooltipProvider } from "@/components/ui/tooltip";
import { qk } from "@/lib/queries/keys";
import { todos as copy } from "@/lib/i18n/sections/todos";
import type { DailyFocus } from "@/lib/types";
const clock = vi.hoisted(() => ({ now: "2026-10-23T12:00:00Z" }));
vi.mock("@/lib/use-now", () => ({ useNow: () => new Date(clock.now) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const saved: DailyFocus = { setId: "saved", date: "2026-10-23", generation: 1, garden: [], items: [{ id: "item", set_id: "saved", todo_id: "task", position: 1, title_snapshot: "Saved focus task", project_name_snapshot: null, importance_snapshot: 4, waiting_since: "2026-10-21T12:00:00Z", completed_at: null }] };
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  clock.now="2026-10-23T12:00:00Z"; vi.stubGlobal("localStorage",new Storage()); document.documentElement.lang="en";
  host=document.createElement("div"); document.body.append(host); root=createRoot(host);
  client=new QueryClient({ defaultOptions: { queries: { retry:false } } });
});
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); document.documentElement.lang=""; vi.unstubAllGlobals(); });
const wait = () => act(async () => { await new Promise(done => setTimeout(done,30)); });
const render = () => act(() => root.render(<QueryClientProvider client={client}><TooltipProvider><DailyFocusPanel todos={[]} /></TooltipProvider></QueryClientProvider>));
const button = (text: string) => [...host.querySelectorAll("button")].find(item => item.textContent === text)!;

it("keeps a verified focus visible after regeneration fails", async () => {
  client.setQueryData([...qk.dailyFocus,saved.date],saved);
  const fetcher=vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch",fetcher);
  render(); act(() => button(copy.en.regenerateDailyFocus).click()); await wait();
  expect(host.textContent).toContain("Saved focus task");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(copy.en.dailyFocusCachedWarning);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1].method).toBe("POST");
});
it("retries a failed initial read without regenerating the owner's selection", async () => {
  const fetcher=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json(saved));vi.stubGlobal("fetch",fetcher);
  render();await wait();act(() => button(copy.en.dailyFocusRetry).click());await wait();
  expect(host.textContent).toContain("Saved focus task");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(call => call[1]?.method !== "POST")).toBe(true);
});
it("does not fabricate an empty completion history when only the garden read failed", () => {
  client.setQueryData([...qk.dailyFocus,saved.date],{...saved,gardenAvailable:false});render();
  expect(host.textContent).toContain("Saved focus task");
  expect(host.textContent).toContain(copy.en.gardenUnavailable);
  expect(host.querySelectorAll('[aria-labelledby="completion-garden-title"] [role="listitem"]')).toHaveLength(0);
});
it("loads the next configured day when a page remains open over midnight", async () => {
  client.setQueryData([...qk.dailyFocus,saved.date],saved);
  const next={...saved,date:"2026-10-24",items:[{...saved.items[0],title_snapshot:"Next day task"}]};
  const fetcher=vi.fn().mockResolvedValue(Response.json(next));vi.stubGlobal("fetch",fetcher);
  render();clock.now="2026-10-23T22:01:00Z";render();await wait();
  expect(host.textContent).toContain("Next day task");expect(host.textContent).not.toContain("Saved focus task");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
