import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
import { DNESKAI_RESEARCH_ACTORS, DNESKAI_RESEARCH_PLAN, dneskaiResearchPlanId, type DneskaiResearchPlan } from "@/lib/marketing/dneskai-apify-research-plan";
import {
  DneskaiResearchError, researchInstagramMetric, settleDneskaiResearchRun, startDneskaiResearchRun,
  type DneskaiResearchLedger, type ResearchReservation, type ResearchTraceEvent,
} from "@/lib/marketing/dneskai-apify-research";

const owner = "11111111-1111-4111-8111-111111111111";
// Tests use synthetic builds, giving their plan its own id independent of the public production pins.
const pinned: DneskaiResearchPlan = { ...DNESKAI_RESEARCH_PLAN, actors: Object.fromEntries(Object.entries(DNESKAI_RESEARCH_ACTORS).map(([key, actor]) => [key, { ...actor, build: "9.9.9" }])) as DneskaiResearchPlan["actors"] };
const planId = dneskaiResearchPlanId(pinned);
const on = { MARKETING_DNESKAI_APIFY_RESEARCH_ENABLED: "true", MARKETING_DNESKAI_APIFY_RESEARCH_APPROVED_PLAN: planId, APIFY_TOKEN: "test-only-token" };
const inWindow = () => new Date("2026-10-23T09:00:00Z");

/** The same rules as the SQL ledger: unknown costs count at the cap; one reservation per (plan, item, run). */
function memoryLedger(prior: number[] = []) {
  const rows: ResearchReservation[] = prior.map((cost, index) => ({ id: randomUUID(), planId: "prior", itemKey: "prior", runIndex: index, capUsd: cost, status: "settled", apifyRunId: null, costUsd: cost }));
  const spentNow = () => Math.round(rows.reduce((sum, row) => sum + (row.status === "settled" ? row.costUsd! : row.capUsd), 0) * 10000) / 10000;
  const ledger: DneskaiResearchLedger & { rows: ResearchReservation[] } = {
    rows,
    reserve: vi.fn(async (input) => {
      const spentUsd = spentNow();
      if (rows.some((row) => row.planId === input.planId && row.itemKey === input.itemKey && row.runIndex === input.runIndex)) return { admitted: false as const, reason: "duplicate" as const, spentUsd };
      if (spentUsd + input.capUsd > input.ceilingUsd + 1e-9) return { admitted: false as const, reason: "ceiling" as const, spentUsd };
      const reservation: ResearchReservation = { id: randomUUID(), planId: input.planId, itemKey: input.itemKey, runIndex: input.runIndex, capUsd: input.capUsd, status: "reserved", apifyRunId: null, costUsd: null };
      rows.push(reservation);
      return { admitted: true as const, reservation, spentUsd };
    }),
    mark: vi.fn(async (_owner, id, update) => { const row = rows.find((entry) => entry.id === id)!; row.status = update.status; if (update.apifyRunId) row.apifyRunId = update.apifyRunId; if (update.costUsd !== undefined) row.costUsd = update.costUsd; }),
    spent: vi.fn(async () => spentNow()),
  };
  return ledger;
}
const apifyRun = (status = "READY", usageTotalUsd: number | null = null, actId = DNESKAI_RESEARCH_ACTORS["instagram-post"].id) =>
  Response.json({ data: { id: "testRun1", actId, buildNumber: "9.9.9", defaultDatasetId: "testDataset1", status, usageTotalUsd } });
const refused = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toEqual(new DneskaiResearchError(code));

describe("DNESKAi Apify research runner: off by default", () => {
  it.each([{}, { MARKETING_DNESKAI_APIFY_RESEARCH_ENABLED: "TRUE" }, { MARKETING_DNESKAI_APIFY_RESEARCH_ENABLED: "1" }, { MARKETING_DNESKAI_APIFY_ENABLED: "true" }])(
    "refuses without the research switch set to exactly true (%o) and calls nothing", async (switches) => {
      const fetcher = vi.fn(), ledger = memoryLedger();
      await refused(startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, { plan: pinned, env: { ...on, MARKETING_DNESKAI_APIFY_RESEARCH_ENABLED: undefined, ...switches }, ledger, fetcher, now: inWindow }), "research-disabled");
      expect(fetcher).not.toHaveBeenCalled();
      expect(ledger.reserve).not.toHaveBeenCalled();
    });

  it("does not read the pipeline's Apify switch, actor binding or guards", async () => {
    const fetcher = vi.fn(async () => apifyRun()), ledger = memoryLedger();
    const env = { ...on, MARKETING_DNESKAI_APIFY_ENABLED: "false", MARKETING_DNESKAI_APIFY_ACTOR_ID: "pipeline-actor", MARKETING_DNESKAI_APIFY_BUILD: "1.0.0" };
    await startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, { plan: pinned, env, ledger, fetcher, now: inWindow });
    const url = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("maxTotalChargeUsd")).toBe("3.60");
    expect(url.searchParams.get("maxTotalChargeUsd")).not.toBe("0.04");
    expect(url.pathname).toBe("/v2/actors/apify~instagram-post-scraper/runs");
  });
});

describe("refusal without an approved plan", () => {
  it.each([undefined, "", "0".repeat(64), dneskaiResearchPlanId(DNESKAI_RESEARCH_PLAN)])("refuses approval %s", async (approval) => {
    const fetcher = vi.fn(), ledger = memoryLedger();
    await refused(startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, { plan: pinned, env: { ...on, MARKETING_DNESKAI_APIFY_RESEARCH_APPROVED_PLAN: approval }, ledger, fetcher, now: inWindow }), "research-plan-not-approved");
    expect(fetcher).not.toHaveBeenCalled();
    expect(ledger.reserve).not.toHaveBeenCalled();
  });

  it("refuses any unpinned actor even when the plan is approved", async () => {
    const unpinned = { ...DNESKAI_RESEARCH_PLAN, actors: { ...DNESKAI_RESEARCH_ACTORS, "instagram-post": { ...DNESKAI_RESEARCH_ACTORS["instagram-post"], build: null } } };
    const env = { ...on, MARKETING_DNESKAI_APIFY_RESEARCH_APPROVED_PLAN: dneskaiResearchPlanId(unpinned) };
    await refused(startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, { plan: unpinned, env, ledger: memoryLedger(), fetcher: vi.fn(), now: inWindow }), "research-build-unpinned");
  });

  it("refuses outside the item's window, a second daily run on one day, and derived targets that do not match", async () => {
    const deps = { plan: pinned, env: on, ledger: memoryLedger(), fetcher: vi.fn(async () => apifyRun()) };
    await refused(startDneskaiResearchRun({ owner, itemKey: "month-end-niche-posts", runIndex: 0 }, { ...deps, now: inWindow }), "research-outside-window");
    await refused(startDneskaiResearchRun({ owner, itemKey: "dneskai-daily-posts", runIndex: 1 }, { ...deps, now: inWindow }), "research-daily-run-not-today");
    await refused(startDneskaiResearchRun({ owner, itemKey: "posts-resnapshot", runIndex: 0, targets: ["https://example.test/p/abcdef/"] }, { ...deps, now: () => new Date("2026-11-01T09:00:00Z") }), "research-targets-invalid");
    expect(deps.fetcher).not.toHaveBeenCalled();
  });
});

describe("per-run cap", () => {
  it("reserves the item's whole cap and starts the pinned build with maxTotalChargeUsd and maxItems", async () => {
    const fetcher = vi.fn(async () => apifyRun(undefined, undefined, DNESKAI_RESEARCH_ACTORS["instagram-reel"].id)), ledger = memoryLedger();
    const started = await startDneskaiResearchRun({ owner, itemKey: "niche-reels", runIndex: 2 }, { plan: pinned, env: on, ledger, fetcher, now: inWindow });
    expect(started).toMatchObject({ mode: "started", capUsd: 3.15, apifyRunId: "testRun1", spentUsd: 0 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const params = new URL(url).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ build: "9.9.9", maxTotalChargeUsd: "3.15", maxItems: "360", waitForFinish: "0", restartOnError: "false" });
    expect(JSON.parse(String(init.body))).toMatchObject({ username: ["businessinsider", "reuters", "axios", "theeconomist", "nytimes", "guardian"], includeSharesCount: true, includeDownloadedVideo: false });
    expect(ledger.reserve).toHaveBeenCalledWith(expect.objectContaining({ capUsd: 3.15, ceilingUsd: 150, planId, itemKey: "niche-reels", runIndex: 2 }));
    expect(ledger.rows.at(-1)).toMatchObject({ status: "started", apifyRunId: "testRun1" });
  });

  it("records a reported cost above the cap as charged and flags it", async () => {
    const ledger = memoryLedger(), deps = { plan: pinned, env: on, ledger, now: inWindow };
    await startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, { ...deps, fetcher: vi.fn(async () => apifyRun()) });
    const result = await settleDneskaiResearchRun(owner, ledger.rows[0]!, { ...deps, fetcher: vi.fn(async () => apifyRun("SUCCEEDED", 3.7)) });
    expect(result).toMatchObject({ running: false, costUsd: 3.7, code: "research-cost-over-cap" });
    expect(await ledger.spent(owner)).toBe(3.7);
  });

  it("settles a finished run at its reported cost and keeps a running run at its cap", async () => {
    const ledger = memoryLedger(), deps = { plan: pinned, env: on, ledger, now: inWindow };
    await startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, { ...deps, fetcher: vi.fn(async () => apifyRun()) });
    expect(await settleDneskaiResearchRun(owner, ledger.rows[0]!, { ...deps, fetcher: vi.fn(async () => apifyRun("RUNNING")) })).toEqual({ running: true });
    expect(await ledger.spent(owner)).toBe(3.6);
    expect(await settleDneskaiResearchRun(owner, ledger.rows[0]!, { ...deps, fetcher: vi.fn(async () => apifyRun("SUCCEEDED", 2.91)) })).toMatchObject({ costUsd: 2.91, code: null, datasetId: "testDataset1" });
    expect(await ledger.spent(owner)).toBe(2.91);
  });

  it("settles a refusal before start at zero and keeps an ambiguous start at its whole cap", async () => {
    const ledger = memoryLedger(), deps = { plan: pinned, env: on, ledger, now: inWindow };
    await refused(startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, { ...deps, fetcher: vi.fn(async () => Response.json({error:{type:"insufficient-funds"}}, { status: 402 })) }), "research-apify-refused-402");
    await refused(startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 1 }, { ...deps, fetcher: vi.fn(async () => { throw new Error("socket"); }) }), "research-start-ambiguous");
    await refused(startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 2 }, { ...deps, fetcher: vi.fn(async () => apifyRun(undefined, undefined, "another-actor")) }), "research-apify-binding-invalid");
    expect(ledger.rows.map((row) => row.status)).toEqual(["settled", "ambiguous", "ambiguous"]);
    expect(await ledger.spent(owner)).toBe(7.2);
  });

  it("never starts the same run twice", async () => {
    const ledger = memoryLedger(), fetcher = vi.fn(async () => apifyRun()), deps = { plan: pinned, env: on, ledger, fetcher, now: inWindow };
    await startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, deps);
    await refused(startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, deps), "research-run-already-reserved");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("research ledger stops at $150", () => {
  it("admits a run that reaches exactly $150 and refuses the next one without calling Apify", async () => {
    const ledger = memoryLedger([100, 46.4]), fetcher = vi.fn(async () => apifyRun()), deps = { plan: pinned, env: on, ledger, fetcher, now: inWindow };
    await startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, deps);
    expect(await ledger.spent(owner)).toBe(150);
    const events: ResearchTraceEvent[] = [];
    await refused(startDneskaiResearchRun({ owner, itemKey: "dneskai-daily-profile", runIndex: 0 }, { ...deps, trace: (event) => events.push(event) }), "research-ceiling-reached");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(events).toEqual([expect.objectContaining({ code: "research-ceiling-reached", spentUsd: 150, capUsd: 0.01 })]);
  });

  it("counts unknown costs at their cap, so open runs cannot overspend the ceiling", async () => {
    const ledger = memoryLedger([145]), fetcher = vi.fn(async () => apifyRun()), deps = { plan: pinned, env: on, ledger, fetcher, now: inWindow };
    await startDneskaiResearchRun({ owner, itemKey: "niche-posts-czech", runIndex: 0 }, deps); // 145 + 2.90 reserved
    await refused(startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, deps), "research-ceiling-reached");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses when the ledger is missing or fails, before any request", async () => {
    const fetcher = vi.fn();
    await refused(startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, { plan: pinned, env: on, fetcher, now: inWindow }), "research-ledger-unavailable");
    const broken = { ...memoryLedger(), reserve: vi.fn(async () => { throw new Error("db down"); }) };
    await refused(startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, { plan: pinned, env: on, ledger: broken, fetcher, now: inWindow }), "research-ledger-unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("dry run", () => {
  it("prints what would run and the cap while the switch is off, without the ledger or the network", async () => {
    const fetcher = vi.fn(), ledger = memoryLedger();
    const dry = await startDneskaiResearchRun({ owner, itemKey: "niche-posts-czech", runIndex: 1, dryRun: true }, { env: {}, ledger, fetcher, now: inWindow });
    expect(dry).toMatchObject({ mode: "dry-run", capUsd: 2.9, maxItems: 1200, build: DNESKAI_RESEARCH_ACTORS["instagram-post"].build, blockedBy: ["research-disabled", "research-plan-not-approved", "research-apify-unconfigured"] });
    expect(dry.mode === "dry-run" && dry.text).toContain("maxTotalChargeUsd 2.90 (worst case 2.76), maxItems 1200, window 2026-10-23..2026-10-29");
    expect(dry.mode === "dry-run" && dry.text).toContain("targets 4: seznamzpravy, denikn, petrmara, czechcrunch");
    expect(dry.mode === "dry-run" && dry.input).toMatchObject({ username: ["seznamzpravy", "denikn", "petrmara", "czechcrunch"], resultsLimit: 300 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(ledger.reserve).not.toHaveBeenCalled();
  });

  it("says a fully configured run would reserve against the research ledger, and still sends nothing", async () => {
    const fetcher = vi.fn();
    const dry = await startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0, dryRun: true }, { plan: pinned, env: on, fetcher, now: inWindow });
    expect(dry).toMatchObject({ mode: "dry-run", blockedBy: [], build: "9.9.9" });
    expect(dry.mode === "dry-run" && dry.text).toContain("would reserve against the research ledger");
    expect(dry.mode === "dry-run" && dry.text).not.toContain("test-only-token");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("what leaves the runner", () => {
  it("traces codes, counts, costs and hashes only", async () => {
    const events: ResearchTraceEvent[] = [];
    await startDneskaiResearchRun({ owner, itemKey: "niche-posts-global", runIndex: 0 }, { plan: pinned, env: on, ledger: memoryLedger(), fetcher: vi.fn(async () => apifyRun()), now: inWindow, trace: (event) => events.push(event) });
    const serialized = JSON.stringify(events);
    expect(events).toEqual([expect.objectContaining({ code: "research-started", targetCount: 5, targetHash: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    for (const secret of ["test-only-token", "evolving.ai", "techcrunch", owner]) expect(serialized).not.toContain(secret);
  });

  it("reduces a post to public counts and caption features, dropping the caption, pictures and unknown usernames", () => {
    const item = { shortCode: "Abc123xyz", ownerUsername: "private.person", caption: "Co je nového v AI?\nDruhý řádek 🤖\nKomentuj a sleduj #ai #tech",
      timestamp: "2026-10-20T08:00:00.000Z", type: "Sidecar", childPosts: [{ type: "Image", displayUrl: "https://cdn.example.test/1.jpg" }, { type: "Video" }],
      likesCount: -1, commentsCount: 12, hashtags: ["ai", "tech"], mentions: [], latestComments: [{ ownerUsername: "someone", text: "hi" }],
      displayUrl: "https://cdn.example.test/cover.jpg", musicInfo: { song_name: "Song", audio_id: "123456", uses_original_audio: false } };
    const metric = researchInstagramMetric(item, new Set(["techcrunch"]));
    expect(metric).toMatchObject({ shortCode: "Abc123xyz", accountHandle: null, slideCount: 2, videoSlideCount: 1, captionLineCount: 3, firstLineQuestion: true,
      hashtagCount: 2, emojiCount: 1, cta: "comment", likes: null, likesHidden: true, comments: 12, musicPresent: true, musicAudioId: "123456" });
    const serialized = JSON.stringify(metric);
    for (const dropped of ["Co je nového", "cdn.example.test", "private.person", "someone"]) expect(serialized).not.toContain(dropped);
    expect(researchInstagramMetric({ ...item, ownerUsername: "techcrunch" }, new Set(["techcrunch"])).accountHandle).toBe("techcrunch");
  });
});


describe("uncertain provider responses retain their reservation", () => {
  it.each([new Response("{}",{status:403}),new Response("upstream error",{status:502}),new Response("x".repeat(1_000_001),{status:400})])("does not release for an unverified refusal",async(response)=>{
    const ledger=memoryLedger();
    await refused(startDneskaiResearchRun({owner,itemKey:"niche-posts-global",runIndex:0},{plan:pinned,env:on,ledger,now:inWindow,fetcher:vi.fn(async()=>response)}),"research-start-ambiguous");
    expect(await ledger.spent(owner)).toBe(3.6);
  });
  it("refuses a changed build or plan during settlement",async()=>{
    const ledger=memoryLedger(),deps={plan:pinned,env:on,ledger,now:inWindow};
    await startDneskaiResearchRun({owner,itemKey:"niche-posts-global",runIndex:0},{...deps,fetcher:vi.fn(async()=>apifyRun())});
    const row=ledger.rows[0]!;
    const wrongBuild=await apifyRun("SUCCEEDED",0).json();wrongBuild.data.buildNumber="9.9.8";
    await refused(settleDneskaiResearchRun(owner,row,{...deps,fetcher:vi.fn(async()=>Response.json(wrongBuild))}),"research-apify-binding-invalid");
    const fetcher=vi.fn();
    await refused(settleDneskaiResearchRun(owner,{...row,planId:"a".repeat(64)},{...deps,fetcher}),"research-settle-unavailable");
    expect(fetcher).not.toHaveBeenCalled();expect(await ledger.spent(owner)).toBe(3.6);
  });
});
