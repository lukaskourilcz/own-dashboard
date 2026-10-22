import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), limited: vi.fn(async () => ({ ok: true, retryAfter: 0 })), reel: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.limited }));
import { DNESKAI_RENDER_REPORT_VERSION } from "@/lib/marketing/contracts";
import { dneskaiReelKey } from "@/lib/marketing/dneskai-reel-render";
import { createDneskaiReelStorage, dneskaiReelForRevision, dneskaiReelObjectKey, dneskaiReelsEnabled, type DneskaiReelDependencies } from "@/lib/marketing/dneskai-reel";
import { signAutomationBody } from "@/lib/marketing/automation-auth";
import { deckRevision } from "./marketing-dneskai-revision-fixture";

const owner = "11111111-1111-4111-8111-111111111111";
const revisionId = "33333333-3333-4333-8333-333333333333";
const contentHash = "9".repeat(64);
const renderKeys = ["1", "2", "3"].map((n) => n.repeat(64));
const report = (overrides: Record<string, unknown> = {}) => ({ schemaVersion: DNESKAI_RENDER_REPORT_VERSION, status: "rendered", problems: [], renderKeys, renderedAt: "2026-10-22T10:00:00Z", ...overrides });

function database(row: unknown) {
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data: row, error: null })) };
  return { from: vi.fn(() => query), query };
}
type Db = Parameters<typeof dneskaiReelForRevision>[0];

function memoryStorage() {
  const stored = new Map<string, { url: string; sha256: string; bytes: number }>();
  return {
    stored,
    find: vi.fn(async (reelKey: string) => { const hit = stored.get(reelKey); return hit ? { reelKey, ...hit } : null; }),
    put: vi.fn(async (input: { reelKey: string; bytes: Buffer; metadata: Record<string, string> }) => {
      const value = { url: `https://test-only.supabase.co/reels/${input.reelKey}.mp4?token=t`, sha256: createHash("sha256").update(input.bytes).digest("hex"), bytes: input.bytes.length };
      stored.set(input.reelKey, value);
      return { reelKey: input.reelKey, ...value };
    }),
  };
}
function dependencies(storage = memoryStorage()) {
  return {
    storage: storage as unknown as DneskaiReelDependencies["storage"],
    loadSlide: vi.fn(async (key: string) => Buffer.from(`slide-${key.slice(0, 1)}`)),
    loadAudio: vi.fn(async () => null),
    render: vi.fn(async ({ slides }: { slides: Buffer[] }) => ({ bytes: Buffer.from(`mp4:${slides.length}`), sha256: "x", durationSeconds: 9.5, slideCount: slides.length, silent: true })),
  };
}

describe("dneskaiReelForRevision", () => {
  it("renders the rendered slides in order once and reuses the stored reel for the same hash", async () => {
    const { from } = database({ revision: deckRevision(), content_hash: contentHash, render_report: report() });
    const storage = memoryStorage();
    const deps = dependencies(storage);
    const first = await dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps);
    expect(first).toMatchObject({ cached: false, silent: true, durationSeconds: 9.5, revisionHash: contentHash, reelKey: dneskaiReelKey({ revisionHash: contentHash, audioId: null }) });
    expect(deps.loadSlide.mock.calls.map(([key]) => key)).toEqual(renderKeys);
    expect(deps.render).toHaveBeenCalledWith(expect.objectContaining({ slides: [Buffer.from("slide-1"), Buffer.from("slide-2"), Buffer.from("slide-3")], audio: null }));
    expect(storage.put.mock.calls[0]![0].metadata).toMatchObject({ revisionId, revisionHash: contentHash, audioId: "silent" });
    const again = await dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps);
    expect(again).toMatchObject({ cached: true, url: first.url, durationSeconds: 9.5 });
    expect(deps.render).toHaveBeenCalledTimes(1);
  });

  it("keys a reel with a track by the track id", async () => {
    const { from } = database({ revision: deckRevision(), content_hash: contentHash, render_report: report() });
    const deps = dependencies();
    deps.loadAudio.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444", bytes: Buffer.from("audio") } as never);
    const reel = await dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps);
    expect(reel.reelKey).toBe(dneskaiReelKey({ revisionHash: contentHash, audioId: "44444444-4444-4444-8444-444444444444" }));
  });

  it.each([
    ["a missing revision", null, "reel-revision-unavailable"],
    ["a revision without a deck render", { revision: deckRevision(), content_hash: contentHash, render_report: null }, "reel-render-required"],
    ["a refused render", { revision: deckRevision(), content_hash: contentHash, render_report: report({ status: "refused" }) }, "reel-render-required"],
    ["render keys that do not cover every slide", { revision: deckRevision(), content_hash: contentHash, render_report: report({ renderKeys: renderKeys.slice(0, 2) }) }, "reel-render-required"],
  ])("refuses %s", async (_name, row, code) => {
    const { from } = database(row);
    const deps = dependencies();
    await expect(dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps)).rejects.toMatchObject({ code });
    expect(deps.render).not.toHaveBeenCalled();
  });

  it("reports an unloadable slide without rendering", async () => {
    const { from } = database({ revision: deckRevision(), content_hash: contentHash, render_report: report() });
    const deps = dependencies();
    deps.loadSlide.mockRejectedValueOnce(new Error("gone"));
    await expect(dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps)).rejects.toMatchObject({ code: "reel-slides-unavailable" });
    expect(deps.render).not.toHaveBeenCalled();
  });
});

describe("reel storage", () => {
  const reelKey = "7".repeat(64);
  const bytes = Buffer.from("test-only-mp4");
  const digest = createHash("sha256").update(bytes).digest("hex");
  function facade(bucket = { public: false }, metadata: Record<string, string> = { reelKey, sha256: digest, ownerId: owner }) {
    const files = {
      upload: vi.fn(async () => ({ error: null })),
      info: vi.fn(async () => ({ data: { size: bytes.length, contentType: "video/mp4", metadata }, error: null })),
      createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://test-only.supabase.co/signed" }, error: null })),
    };
    return { files, db: { storage: { getBucket: vi.fn(async () => ({ data: bucket, error: null })), from: vi.fn(() => files) } } };
  }

  it("uploads once under the owner prefix without upsert and signs only a verified object", async () => {
    const { db, files } = facade();
    const storage = createDneskaiReelStorage(db as never, owner);
    const stored = await storage.put({ reelKey, bytes, metadata: {} });
    expect(files.upload).toHaveBeenCalledWith(dneskaiReelObjectKey(owner, reelKey), bytes, { upsert: false, contentType: "video/mp4", cacheControl: "3600", metadata: { reelKey, sha256: digest, ownerId: owner } });
    expect(db.storage.from).toHaveBeenCalledWith("marketing-reels");
    expect(stored).toEqual({ reelKey, url: "https://test-only.supabase.co/signed", sha256: digest, bytes: bytes.length });
    expect(dneskaiReelObjectKey(owner, reelKey)).toBe(`${owner}/marketing/dneskai/reels/${reelKey}.mp4`);
  });

  it("refuses a public bucket and an object whose metadata names another owner", async () => {
    await expect(createDneskaiReelStorage(facade({ public: true }).db as never, owner).find(reelKey)).rejects.toMatchObject({ code: "reel-bucket-required" });
    const foreign = facade({ public: false }, { reelKey, sha256: digest, ownerId: "22222222-2222-4222-8222-222222222222" });
    await expect(createDneskaiReelStorage(foreign.db as never, owner).find(reelKey)).rejects.toMatchObject({ code: "reel-storage-failed" });
    expect(foreign.files.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("render-reel route", () => {
  const url = "https://own.example/api/marketing/dneskai/render-reel";
  const body = JSON.stringify({ revisionId });
  const ownerRequest = () => new Request(url, { method: "POST", headers: { Origin: "https://own.example", "Content-Type": "application/json" }, body });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: owner } } }) } });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock("@/lib/marketing/dneskai-reel"); vi.resetModules(); });

  async function route() {
    vi.resetModules();
    vi.doMock("@/lib/marketing/dneskai-reel", async (original) => ({ ...(await original<object>()), dneskaiReelForRevision: mocks.reel }));
    return (await import("@/app/api/marketing/dneskai/render-reel/route")).POST;
  }

  it("answers 404 while the switch is off", async () => {
    expect(dneskaiReelsEnabled({})).toBe(false);
    const POST = await route();
    expect((await POST(ownerRequest())).status).toBe(404);
    expect(mocks.reel).not.toHaveBeenCalled();
  });

  it("renders for the signed-in owner and answers the signed URL", async () => {
    vi.stubEnv("MARKETING_DNESKAI_REELS_ENABLED", "true");
    mocks.reel.mockResolvedValue({ reelKey: "7".repeat(64), url: "https://test-only.supabase.co/signed", sha256: "8".repeat(64), bytes: 10, durationSeconds: 9.5, silent: true, cached: false, revisionHash: contentHash });
    const POST = await route();
    const response = await POST(ownerRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ url: "https://test-only.supabase.co/signed", silent: true, cached: false });
    expect(mocks.reel.mock.calls[0]!.slice(1, 3)).toEqual([owner, revisionId]);
  });

  it("refuses a stranger, a cross-origin post and an automation role other than scheduler or publisher", async () => {
    vi.stubEnv("MARKETING_DNESKAI_REELS_ENABLED", "true");
    const POST = await route();
    mocks.client.mockReturnValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    expect((await POST(ownerRequest())).status).toBe(401);
    expect((await POST(new Request(url, { method: "POST", headers: { Origin: "https://evil.example" }, body }))).status).toBe(403);
    vi.stubEnv("MARKETING_OWNER_ID", owner);
    vi.stubEnv("MARKETING_WORKER_SECRET", "w".repeat(40));
    const signed = new Request(url, { method: "POST", headers: signAutomationBody(body, "w".repeat(40)), body });
    const answer = await POST(signed);
    expect([401, 403]).toContain(answer.status);
    expect(mocks.reel).not.toHaveBeenCalled();
  });

  it("maps a refused revision to 409", async () => {
    vi.stubEnv("MARKETING_DNESKAI_REELS_ENABLED", "true");
    const POST = await route();
    mocks.reel.mockRejectedValue(new (await import("@/lib/marketing/dneskai-reel")).DneskaiReelError("reel-render-required"));
    const response = await POST(ownerRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "reel-render-required" });
  });
});
