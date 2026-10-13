// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketingDiagnostics } from "@/components/marketing/marketing-diagnostics";
import { EMPTY_MARKETING_STATE, type MarketingState } from "@/lib/marketing/client";
import type { ContentRevision } from "@/lib/marketing/contracts";
import heldQuestion from "../../templates/marketing/benchmarks/devshark-question.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const fetcher = vi.fn();
const revisionId = "33333333-3333-4333-8333-333333333333";
function tracedState(): MarketingState {
  const revision: ContentRevision = { schemaVersion: "marketing-content/1", brand: "devshark", title: heldQuestion.content.title,
    caption: "TEST ONLY: held authored source, no publishing", sources: [{ sourceId: heldQuestion.sourceId, sourceRevision: heldQuestion.sourceRevision, contentHash: heldQuestion.contentHash }],
    account: { id: "test-only", handle: "test-only", platform: "instagram" }, format: "carousel", knowledgeIds: [], assets: [],
    scheduledAt: "2026-10-14T08:00:00Z", timeZone: "Europe/Prague", templateVersion: "devshark-editorial/2", promptVersion: "marketing-copy/2", model: "claude-offline-test", traceId: "44444444-4444-4444-8444-444444444444" };
  return { ...structuredClone(EMPTY_MARKETING_STATE), revisions: [{ id: revisionId, user_id: "11111111-1111-4111-8111-111111111111", project_id: null, campaign_id: null, revision,
    status: "review", ready: false, content_hash: "a".repeat(64), approved_at: null, approved_hash: null, feedback: null, created_at: "2026-10-13T08:00:00Z" }] };
}
function render(state = structuredClone(EMPTY_MARKETING_STATE), lang: "en" | "cs" = "en") {
  act(() => { root.render(<MarketingDiagnostics state={state} lang={lang}/>); });
}
async function clickTrace() {
  const button = container.querySelector("button"); expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
}
beforeEach(() => {
  fetcher.mockReset(); vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("real-sample marketing diagnostics", () => {
  it("keeps an empty sample empty and treats missing cost as unknown, without fetching", () => {
    render();
    expect(container.textContent).toContain("No generation jobs recorded.");
    expect(container.textContent).toContain("Unknown");
    expect(container.textContent).not.toContain("$0");
    expect(container.textContent).not.toContain("Approval share");
    expect(container.querySelectorAll("li, button, a")).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sums only recorded estimates and labels the bounded review sample", () => {
    render({ ...structuredClone(EMPTY_MARKETING_STATE), jobs: [
      { id: "test-only-cost-known", brand: "devshark", status: "review", errorCode: null, createdAt: "2026-10-13T08:00:00Z", costUsd: 0.0021 },
      { id: "test-only-cost-unknown", brand: null, status: "failed", errorCode: "source-unavailable", createdAt: "2026-10-13T09:00:00Z", costUsd: null },
    ], diagnostics: { sampleSize: 2, firstApprovalRate: 0.5 } });
    expect(container.textContent).toContain("$0.0021");
    expect(container.textContent).toContain("Jobs without a recorded cost1");
    expect(container.textContent).toContain("Brand not recorded");
    expect(container.textContent).toContain("The source is unavailable or changed.");
    expect(container.textContent).toContain("50%");
    expect(container.textContent).toContain("Earlier decisions may fall outside this sample.");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("localizes held/error outcomes in Czech and never displays an arbitrary error payload", () => {
    render({ ...structuredClone(EMPTY_MARKETING_STATE), jobs: [
      { id: "test-only-overflow", brand: "devshark", status: "failed", errorCode: "challenge-spec-overflow", createdAt: "2026-10-13T09:00:00Z", costUsd: 0 },
      { id: "test-only-untrusted-error", brand: "dneskai", status: "reconciliation", errorCode: "private provider payload: TEST SECRET", createdAt: "invalid", costUsd: null },
    ] }, "cs");
    expect(container.textContent).toContain("Zdroj se nevejde do schváleného rozvržení.");
    expect(container.textContent).toContain("Nutné ověření výsledku");
    expect(container.textContent).toContain("Čas není zaznamenaný");
    expect(container.textContent).not.toContain("TEST SECRET");
    expect(container.querySelector("code")?.textContent).toBe("challenge-spec-overflow");
  });
  it("retrieves only the clicked revision's owner-authenticated EU trace and exposes auth errors for retry", async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
    render(tracedState());
    expect(fetcher).not.toHaveBeenCalled();
    await clickTrace();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sign in again");
    fetcher.mockResolvedValueOnce(Response.json({ url: "https://eu.smith.langchain.com/o/test-only/projects/p/test-only/r/test-only" }));
    await clickTrace();
    expect(fetcher).toHaveBeenLastCalledWith(`/api/marketing/diagnostics/${revisionId}`, expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal) }));
    const link = container.querySelector("a");
    expect(link?.textContent).toBe("Open trace");
    expect(link?.hostname).toBe("eu.smith.langchain.com");
    expect(link?.rel).toBe("noopener noreferrer");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(heldQuestion.eligible).toBe(false);
  });
  it.each(["https://smith.langchain.com/r/foreign", "javascript:alert(1)", "https://private:secret@eu.smith.langchain.com/r/test-only"])("rejects an unsafe returned trace URL: %s", async (url) => {
    fetcher.mockResolvedValueOnce(Response.json({ url })); render(tracedState()); await clickTrace();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Trace unavailable. Try again later.");
  });
});
