import { describe, expect, it } from "vitest";
import {
  DNESKAI_RESEARCH_ACTORS, DNESKAI_RESEARCH_CEILING_USD, DNESKAI_RESEARCH_PLAN, dneskaiResearchPlanId, formatDneskaiResearchPlan,
  researchPlanCapTotalUsd, researchRunInput, researchRunTargets, researchRunWorstUsd, researchWaveCapUsd, validateDneskaiResearchPlan,
  type DneskaiResearchPlan,
} from "@/lib/marketing/dneskai-apify-research-plan";

const withItem = (key: string, change: Record<string, unknown>): DneskaiResearchPlan =>
  ({ ...DNESKAI_RESEARCH_PLAN, items: DNESKAI_RESEARCH_PLAN.items.map((item) => item.key === key ? { ...item, ...change } : item) });

describe("DNESKAi Apify research plan (brief §4.I)", () => {
  it("is valid, stays within $150 and front-loads the spend with a month-end reserve", () => {
    expect(validateDneskaiResearchPlan()).toEqual([]);
    expect(researchPlanCapTotalUsd()).toBe(126);
    expect(researchPlanCapTotalUsd()).toBeLessThanOrEqual(DNESKAI_RESEARCH_CEILING_USD);
    const firstTwoWeeks = researchWaveCapUsd("front") + researchWaveCapUsd("second");
    expect(firstTwoWeeks / researchPlanCapTotalUsd()).toBeGreaterThan(0.8);
    expect(researchWaveCapUsd("month-end")).toBeGreaterThan(10);
  });

  it("caps every run at or above its worst case and never above $5", () => {
    for (const item of DNESKAI_RESEARCH_PLAN.items) {
      expect(item.capUsd, item.key).toBeGreaterThanOrEqual(Math.round(researchRunWorstUsd(item) * 100) / 100);
      expect(item.capUsd, item.key).toBeLessThanOrEqual(5);
    }
    expect(validateDneskaiResearchPlan(withItem("niche-reels", { capUsd: 1 }))).toContain("niche-reels:cap-below-worst-case");
    expect(validateDneskaiResearchPlan(withItem("niche-reels", { capUsd: 4.9 }))).toContain("niche-reels:cap-padded");
    expect(validateDneskaiResearchPlan(withItem("niche-reels", { runs: 60 }))).toContain("plan-over-ceiling");
  });

  it("refuses inputs that log in, copy media, collect comments or enrich people", () => {
    expect(validateDneskaiResearchPlan(withItem("reddit-ai", { input: { crawlCommentsPerPost: true } }))).toContain("reddit-ai:input-comments");
    expect(validateDneskaiResearchPlan(withItem("niche-reels", { input: { includeDownloadedVideo: true } }))).toContain("niche-reels:input-media-copy");
    expect(validateDneskaiResearchPlan(withItem("popular-reels", { input: { enhanceUserSearchWithFacebookPage: true } }))).toContain("popular-reels:input-personal-data");
    expect(validateDneskaiResearchPlan(withItem("threads-posts", { input: { sessionCookie: "x" } }))).toContain("threads-posts:input-forbidden");
    expect(validateDneskaiResearchPlan(withItem("youtube-ai", { window: { from: "2026-11-20", to: "2026-11-25" } }))).toContain("youtube-ai:window-invalid");
  });

  it("records the fetched actor ids and pricing, with every build unpinned until the owner pins it", () => {
    expect(DNESKAI_RESEARCH_ACTORS["instagram-post"]).toMatchObject({ id: "nH2AHrwxeTRJoN5hX", prices: { post: 0.0015, postDetails: 0.0008, musicData: 0.006 } });
    expect(DNESKAI_RESEARCH_ACTORS["instagram-reel"]).toMatchObject({ id: "xMc5Ga1oCONPmWJIa", prices: { reel: 0.0023, sharesCount: 0.006 } });
    expect(Object.values(DNESKAI_RESEARCH_ACTORS).every((actor) => actor.build === null)).toBe(true);
  });

  it("binds the approval to exact bytes: any change gives another plan id", () => {
    const id = dneskaiResearchPlanId();
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(dneskaiResearchPlanId(withItem("hashtag-posts", { capUsd: 1.9 }))).not.toBe(id);
    const pinned = { ...DNESKAI_RESEARCH_PLAN, actors: { ...DNESKAI_RESEARCH_ACTORS, youtube: { ...DNESKAI_RESEARCH_ACTORS.youtube, build: "1.0.0" } } };
    expect(dneskaiResearchPlanId(pinned)).not.toBe(id);
  });

  it("slices fixed targets per run and puts them in the field the actor expects", () => {
    const global = DNESKAI_RESEARCH_PLAN.items.find((item) => item.key === "niche-posts-global")!;
    expect(researchRunTargets(global, 1)).toEqual(["tiffintech", "mosseri", "meta.ai", "therundownai", "heyzainkahn"]);
    expect(researchRunInput(global, ["a", "b"])).toMatchObject({ username: ["a", "b"], resultsLimit: 300 });
    const popular = DNESKAI_RESEARCH_PLAN.items.find((item) => item.key === "popular-reels")!;
    expect(researchRunInput(popular, ["ai news", "chatgpt"])).toMatchObject({ search: "ai news, chatgpt", searchType: "popular" });
    const news = DNESKAI_RESEARCH_PLAN.items.find((item) => item.key === "google-news-cs")!;
    expect(researchRunInput(news, researchRunTargets(news, 0))).toMatchObject({ query: "umělá inteligence", language: "CZ:cs" });
  });

  it("prints the plan for the owner with the total and the id", () => {
    const text = formatDneskaiResearchPlan();
    expect(text).toContain(dneskaiResearchPlanId());
    expect(text).toContain("total of caps $126.00 of $150.00");
    expect(text).toContain("plan valid");
  });
});
