// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeeklyReview } from "@/lib/types";

// The flow's two network edges: the daily-focus read and the review upsert.
// Everything else is the real component.
const upserts: Record<string, unknown>[] = [];

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "gte", "lt", "order", "eq"]) {
    builder[method] = () => builder;
  }
  builder.single = () => Promise.resolve(result);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "weekly_reviews") {
        return {
          upsert: (payload: Record<string, unknown>) => {
            upserts.push(payload);
            return chain({ data: { id: "review-1", ...payload }, error: null });
          },
        };
      }
      return chain({ data: [], error: null });
    },
  }),
}));
vi.mock("@/lib/supabase/user", () => ({ currentUserId: async () => "owner-1" }));

import { WeeklyPlanningFlow } from "@/components/work/weekly-planning";
import { mondayKey } from "@/lib/date-keys";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOADING = { ready: false, failed: false };
const READY = { ready: true, failed: false };

// Monday's plan, as the database holds it.
const stored: WeeklyReview = {
  id: "review-1",
  user_id: "owner-1",
  week_start: mondayKey(),
  summary: "Ship the invoice fixes, then the release notes.",
  items: {
    step: "time",
    objectives: [{ id: "o1", text: "Ship the invoice fixes", done: false }],
    facts: ["Two invoices were paid late"],
    risks: ["Bank consent lapses in October"],
    decisions: [],
    priorities: ["Invoices first"],
    followUps: [],
    sources: [],
  },
  status: "draft",
  completed_at: null,
  created_at: "2026-09-21T08:00:00Z",
  updated_at: "2026-09-21T08:00:00Z",
} as WeeklyReview;

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(reviews: WeeklyReview[], reviewsStatus = READY) {
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <WeeklyPlanningFlow
          reviews={reviews}
          setReviews={() => undefined}
          reviewsStatus={reviewsStatus}
          projects={[]}
          organizations={[]}
          todos={[]}
          lastWeekCalendar={{ ok: true, events: [] }}
          lastWeekCalendarStatus={READY}
        />
      </QueryClientProvider>,
    );
  });
}

function button(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name,
  );
}

async function clickNextAndSettle() {
  const next = button("Next");
  expect(next).toBeDefined();
  await act(async () => {
    next!.click();
  });
  for (let i = 0; i < 20 && upserts.length === 0; i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

beforeEach(() => {
  upserts.length = 0;
  document.documentElement.lang = "en";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
});

describe("WeeklyPlanningFlow on a Work tab reached client-side", () => {
  it("waits for the stored reviews, then saves the week it loaded", async () => {
    // The tab opens before its reviews arrive: nothing can be stepped or saved.
    render([], LOADING);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Loading…");
    expect(button("Next")).toBeUndefined();
    expect(button("Save draft")).toBeUndefined();

    // The fetch lands; the flow starts from Monday's plan.
    render([stored], READY);
    await clickNextAndSettle();

    expect(upserts).toHaveLength(1);
    const saved = upserts[0] as { summary: string; items: Record<string, unknown>; week_start: string };
    expect(saved.week_start).toBe(stored.week_start);
    expect(saved.summary).toBe(stored.summary);
    expect(saved.items.objectives).toEqual(stored.items.objectives);
    expect(saved.items.facts).toEqual(["Two invoices were paid late"]);
    expect(saved.items.risks).toEqual(["Bank consent lapses in October"]);
    expect(saved.items.priorities).toEqual(["Invoices first"]);
    expect(saved.items.step).toBe("done");
  });

  it("keeps what the owner did not touch when the review arrives after the steps mounted", async () => {
    // Mounted over an empty list, then the stored review shows up (a refetch
    // after another device saved it). The steps still hold their empty seed.
    render([], READY);
    render([stored], READY);
    await clickNextAndSettle();

    expect(upserts).toHaveLength(1);
    const saved = upserts[0] as { summary: string; items: Record<string, unknown> };
    expect(saved.summary).toBe(stored.summary);
    expect(saved.items.objectives).toEqual(stored.items.objectives);
    expect(saved.items.facts).toEqual(["Two invoices were paid late"]);
    expect(saved.items.risks).toEqual(["Bank consent lapses in October"]);
  });

  it("says so, and offers a retry, when the reviews could not be loaded", () => {
    render([], { ready: false, failed: true });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This week's plan could not be loaded",
    );
    expect(button("Try again")).toBeDefined();
    expect(button("Next")).toBeUndefined();
  });
});
