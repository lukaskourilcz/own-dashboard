import { describe, expect, it } from "vitest";
import { createMarketingBenchmarkCases, evaluateOfflineMarketingCases, runOfflineMarketingBenchmark } from "../../scripts/marketing-benchmark";
import article from "../../templates/marketing/benchmarks/dneskai-article.json";
import question from "../../templates/marketing/benchmarks/devshark-question.json";
import task from "../../templates/marketing/benchmarks/devshark-coding-task.json";

describe("offline marketing benchmark acceptance", () => {
  it("covers 45 acceptance cases without changing retained source eligibility", () => {
    const cases = createMarketingBenchmarkCases(); const results = evaluateOfflineMarketingCases(cases);
    expect(cases).toHaveLength(45); expect(new Set(cases.map((entry) => entry.id)).size).toBe(45);
    expect(results.filter((result) => !result.passed)).toEqual([]);
    expect([article.eligible, question.eligible, task.eligible]).toEqual([false, false, false]);
    expect(results.some((entry) => entry.id.includes("wrong-answer") && entry.issueCodes.includes("authored-answer-changed"))).toBe(true);
    expect(results.some((entry) => entry.id.includes("missing-citations") && entry.issueCodes.includes("missing-evidence"))).toBe(true);
    expect(results.filter((entry) => entry.id.includes("expired-eligibility")).every((entry) => entry.offlineSimulation)).toBe(true);
  });
  it("records malformed-source refusals instead of aborting the whole dataset", () => {
    const cases = createMarketingBenchmarkCases().filter((entry) => entry.id.includes("private-source-field") || entry.id.includes("source-version"));
    expect(evaluateOfflineMarketingCases(cases).every((entry) => entry.passed && entry.issueCodes.includes("invalid-source"))).toBe(true);
  });
  it("reports local render latency/hash reproducibility without claiming provider cost or model quality", async () => {
    const report = await runOfflineMarketingBenchmark();
    expect(report.caseCount).toBe(45); expect(report.passed).toBe(45); expect(report.failed).toBe(0);
    expect(report.providerCalls).toBe(0); expect(report.providerCostUsd).toBeNull();
    expect(report.rendering.map((entry) => entry.reproducible)).toEqual([true]);
    expect(report.rendering.map((entry) => entry.slides)).toEqual([4]);
    expect(report.rendering.every((entry) => entry.firstRenderMs > 0 && entry.repeatRenderMs > 0)).toBe(true);
    expect(report.rendering.flatMap((entry) => entry.assets).every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256) && asset.width === 1080 && asset.height === 1350 && asset.bytes > 0)).toBe(true);
  }, 60000);
});
