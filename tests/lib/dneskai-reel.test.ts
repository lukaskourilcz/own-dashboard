import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), limited: vi.fn(async () => ({ ok: true, retryAfter: 0 })), reel: vi.fn(), record: vi.fn(async () => undefined), audio:vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.limited }));
import { DNESKAI_RENDER_REPORT_VERSION } from "@/lib/marketing/contracts";
import { revisionContentHash } from "@/lib/marketing/hashes";
import { dneskaiReelKey } from "@/lib/marketing/dneskai-reel-render";
import { createDneskaiReelStorage, findDneskaiReelForRevision, dneskaiReelForRevision, dneskaiReelObjectKey, dneskaiReelsEnabled, type DneskaiReelDependencies } from "@/lib/marketing/dneskai-reel";
import { signAutomationBody } from "@/lib/marketing/automation-auth";
import { deckRevision } from "./marketing-dneskai-revision-fixture";

const owner = "11111111-1111-4111-8111-111111111111";
const revisionId = "33333333-3333-4333-8333-333333333333";
const contentHash = revisionContentHash(renderedRevision());
const renderKeys = ["1", "2", "3"].map((n) => n.repeat(64));
const report = (overrides: Record<string, unknown> = {}) => ({ schemaVersion: DNESKAI_RENDER_REPORT_VERSION, status: "rendered", problems: [], renderKeys, renderedAt: "2026-10-22T10:00:00Z", ...overrides });

function renderedRevision() {
  const revision = deckRevision();
  return { ...revision, assets: revision.assets.map((asset, index) => ({ ...asset, sha256: createHash('sha256').update(Buffer.from(`slide-${index + 1}`)).digest('hex') })) };
}

function database(row: unknown) {
  let requestedId=revisionId;
  const query = { select: vi.fn(() => query), eq: vi.fn((key:string,value:string) => {if(key==='id')requestedId=value;return query;}),retry:vi.fn(()=>query),abortSignal:vi.fn(()=>query), maybeSingle: vi.fn(async () => ({ data: row&&typeof row==='object'?{id:requestedId,user_id:owner,...row}:row, error: null })) };
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
  it("renders the rendered slides in order once and reuses the stored reel for the same JPEG/audio bytes", async () => {
    const { from } = database({ revision: renderedRevision(), content_hash: contentHash, render_report: report() });
    const storage = memoryStorage();
    const deps = dependencies(storage);
    const first = await dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps);
    expect(first).toMatchObject({ cached: false, silent: true, durationSeconds: 9.5, revisionHash: contentHash, reelKey: dneskaiReelKey({ slideSha256s: renderedRevision().assets.map(asset => asset.sha256), audio: null }) });
    expect(deps.loadSlide.mock.calls.map(([key]) => key)).toEqual(renderKeys);
    expect(deps.render).toHaveBeenCalledWith(expect.objectContaining({ slides: [Buffer.from("slide-1"), Buffer.from("slide-2"), Buffer.from("slide-3")], audio: null }));
    expect(storage.put.mock.calls[0]![0].metadata).toMatchObject({ audioId: "silent", audioSha256: "silent" });
    const again = await dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps);
    expect(again).toMatchObject({ cached: true, url: first.url, durationSeconds: 9.5 });
    expect(deps.render).toHaveBeenCalledTimes(1);
  });

  it("keys a reel with a track by its id and exact bytes", async () => {
    const { from } = database({ revision: renderedRevision(), content_hash: contentHash, render_report: report() });
    const deps = dependencies();
    deps.loadAudio.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444", bytes: Buffer.from("audio") } as never);
    const reel = await dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps);
    expect(reel.reelKey).toBe(dneskaiReelKey({ slideSha256s: renderedRevision().assets.map(asset => asset.sha256), audio: { id: "44444444-4444-4444-8444-444444444444", sha256: createHash("sha256").update("audio").digest("hex") } }));
  });

  it('reuses the physical MP4 after caption/schedule/alt edits while returning the exact new revision hash', async () => {
    const storage = memoryStorage(), deps = dependencies(storage);
    const original = renderedRevision();
    const revised = { ...original, caption: 'A new approved caption.', scheduledAt: '2099-10-22T06:00:00Z', assets: original.assets.map(asset => ({ ...asset, alt: 'New accessible description' })) };
    const firstDb = database({ revision: original, content_hash: revisionContentHash(original), render_report: report() });
    const secondDb = database({ revision: revised, content_hash: revisionContentHash(revised), render_report: report() });
    const first = await dneskaiReelForRevision(firstDb as unknown as Db, owner, revisionId, deps);
    const second = await dneskaiReelForRevision(secondDb as unknown as Db, owner, '55555555-5555-4555-8555-555555555555', deps);
    expect(second).toMatchObject({ cached: true, reelKey: first.reelKey, revisionHash: revisionContentHash(revised) });
    expect(second.revisionHash).not.toBe(first.revisionHash);
    expect(deps.render).toHaveBeenCalledOnce();
    expect(deps.loadSlide).toHaveBeenCalledTimes(3);
    expect(storage.put.mock.calls[0]![0].metadata).not.toHaveProperty('revisionId');
    expect(storage.put.mock.calls[0]![0].metadata).not.toHaveProperty('revisionHash');
  });
  it('does not reuse an MP4 when bytes of the same named track change', async () => {
    const { from } = database({ revision: renderedRevision(), content_hash: contentHash, render_report: report() });
    const deps = dependencies();
    const audioId = '44444444-4444-4444-8444-444444444444';
    deps.loadAudio.mockResolvedValueOnce({ id: audioId, bytes: Buffer.from('first-track-bytes') } as never);
    const first = await dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps);
    deps.loadAudio.mockResolvedValueOnce({ id: audioId, bytes: Buffer.from('different-track-bytes') } as never);
    const second = await dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps);
    expect(second.reelKey).not.toBe(first.reelKey);
    expect(deps.render).toHaveBeenCalledTimes(2);
  });
  it('refuses JPEG bytes that differ from the revision before encoding or storing', async () => {
    const { from } = database({ revision: renderedRevision(), content_hash: contentHash, render_report: report() });
    const deps = dependencies();
    deps.loadSlide.mockResolvedValueOnce(Buffer.from('different-pixels'));
    await expect(dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps)).rejects.toMatchObject({ code: 'reel-slides-unavailable' });
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.storage.put).not.toHaveBeenCalled();
    expect(deps.loadSlide).toHaveBeenCalledOnce();
  });
  it('refuses an inconsistent revision hash before cache lookup', async () => {
    const { from } = database({ revision: renderedRevision(), content_hash: 'f'.repeat(64), render_report: report() });
    const deps = dependencies();
    await expect(dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps)).rejects.toMatchObject({ code: 'reel-revision-unavailable' });
    expect(deps.storage.find).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
  });

  it.each(['missing', 'not-jpeg', 'invalid-render-key'])('refuses incomplete approved media before reading the cache (%s)', async (reason) => {
    const revision = renderedRevision();
    if (reason === 'missing') revision.assets.pop();
    if (reason === 'not-jpeg') revision.assets[0]!.mimeType = 'video/mp4';
    const { from } = database({ revision, content_hash: revisionContentHash(revision), render_report: report(reason === 'invalid-render-key' ? { renderKeys: ['bad-key', ...renderKeys.slice(1)] } : {}) });
    const deps = dependencies();
    await expect(dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps)).rejects.toMatchObject({ code: 'reel-render-required' });
    expect(deps.storage.find).not.toHaveBeenCalled();
    expect(deps.loadAudio).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing revision", null, "reel-revision-unavailable"],
    ["a revision without a deck render", { revision: renderedRevision(), content_hash: contentHash, render_report: null }, "reel-render-required"],
    ["a refused render", { revision: renderedRevision(), content_hash: contentHash, render_report: report({ status: "refused" }) }, "reel-render-required"],
    ["render keys that do not cover every slide", { revision: renderedRevision(), content_hash: contentHash, render_report: report({ renderKeys: renderKeys.slice(0, 2) }) }, "reel-render-required"],
  ])("refuses %s", async (_name, row, code) => {
    const { from } = database(row);
    const deps = dependencies();
    await expect(dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps)).rejects.toMatchObject({ code });
    expect(deps.render).not.toHaveBeenCalled();
  });

  it("reports an unloadable slide without rendering", async () => {
    const { from } = database({ revision: renderedRevision(), content_hash: contentHash, render_report: report() });
    const deps = dependencies();
    deps.loadSlide.mockRejectedValueOnce(new Error("gone"));
    await expect(dneskaiReelForRevision({ from } as unknown as Db, owner, revisionId, deps)).rejects.toMatchObject({ code: "reel-slides-unavailable" });
    expect(deps.render).not.toHaveBeenCalled();
  });
});

it('reads a recorded legacy MP4 key only for its exact approved revision hash', async () => {
  const storage = memoryStorage(), reelKey = '7'.repeat(64), digest = '8'.repeat(64);
  const payload = { reelKey, revisionHash: contentHash, audioId: null, sha256: digest, bytes: 12 };
  storage.stored.set(reelKey, { url: 'https://test-only.supabase.co/legacy.mp4', sha256: digest, bytes: 12 });
  let requestedHash = contentHash;
  const query = { select: vi.fn(() => query), eq: vi.fn((key: string, value: string) => { if(key === 'payload->>revisionHash') requestedHash = value; return query; }), order: vi.fn(() => query), limit: vi.fn(() => query),retry:vi.fn(()=>query),abortSignal:vi.fn(async()=>({data:requestedHash===contentHash?[{...payload,id:'44444444-4444-4444-8444-444444444444',user_id:owner,revision_id:revisionId,kind:'dneskai-reel-rendered',created_at:'2026-10-27T10:00:00Z'}]:[],error:null})) };
  const db = { from: vi.fn(() => query) } as unknown as Db;
  expect(await findDneskaiReelForRevision(db, owner, revisionId, contentHash, storage as never)).toMatchObject({ reelKey, sha256: digest });
  expect(query.eq).toHaveBeenCalledWith('user_id', owner);
  expect(query.eq).toHaveBeenCalledWith('revision_id', revisionId);
  storage.find.mockClear();
  expect(await findDneskaiReelForRevision(db, owner, revisionId, 'f'.repeat(64), storage as never)).toBeNull();
  expect(storage.find).not.toHaveBeenCalled();
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

  it.each([{ status: 503, statusCode: 'SlowDown' }, { status: 403, statusCode: 'AccessDenied' }, { status: 404, statusCode: 'NoSuchBucket' }, { status: 404, statusCode: 'TenantNotFound' }, { status: 404, statusCode: 'Unexpected' }, null])('refuses an unavailable reel cache instead of declaring a miss (%s)', async (error) => {
    const { db, files } = facade();
    const storage = createDneskaiReelStorage(db as never, owner);
    files.info.mockResolvedValueOnce({ data: null, error } as never);
    await expect(storage.find(reelKey)).rejects.toMatchObject({ code: 'reel-storage-failed' });
    expect(files.upload).not.toHaveBeenCalled();
    expect(files.createSignedUrl).not.toHaveBeenCalled();
  });
  it.each([{ status: 404, statusCode: 'NoSuchKey' }, { status: 404, statusCode: 'not_found' }, { status: 404, statusCode: '404' }, { status: 400, statusCode: '404' }])('recognizes a typed object absence in the reel cache (%s)', async (error) => {
    const { db, files } = facade();
    const storage = createDneskaiReelStorage(db as never, owner);
    files.info.mockResolvedValueOnce({ data: null, error } as never);
    expect(await storage.find(reelKey)).toBeNull();
    expect(files.createSignedUrl).not.toHaveBeenCalled();
  });
  it('never encodes or uploads a Reel after a real storage adapter lookup fails', async () => {
    const { db, files } = facade();
    files.info.mockResolvedValueOnce({ data: null, error: { status: 503, statusCode: 'SlowDown' } } as never);
    const store = createDneskaiReelStorage(db as never, owner);
    const deps = { ...dependencies(), storage: store };
    const query = database({ revision: renderedRevision(), content_hash: contentHash, render_report: report() });
    await expect(dneskaiReelForRevision({ ...db, ...query } as unknown as Db, owner, revisionId, deps)).rejects.toMatchObject({ code: 'reel-storage-failed' });
    expect(deps.loadSlide).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
    expect(files.upload).not.toHaveBeenCalled();
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
  afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock("@/lib/marketing/dneskai-reel"); vi.doUnmock("@/lib/marketing/dneskai-audio"); vi.resetModules(); });

  async function route() {
    vi.resetModules();
    vi.doMock("@/lib/marketing/dneskai-reel", async (original) => ({ ...(await original<object>()), dneskaiReelForRevision: mocks.reel, recordDneskaiReel: mocks.record }));
    vi.doMock("@/lib/marketing/dneskai-audio", async original => ({...await original<object>(),loadDneskaiAudioTrack:mocks.audio}));
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
    mocks.reel.mockResolvedValue({ reelKey: "7".repeat(64), url: "https://test-only.supabase.co/signed", sha256: "8".repeat(64), bytes: 10, durationSeconds: 9.5, silent: true, cached: false, revisionHash: contentHash, audioId: null });
    const POST = await route();
    const response = await POST(ownerRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ url: "https://test-only.supabase.co/signed", silent: true, cached: false });
    expect(mocks.reel.mock.calls[0]!.slice(1, 3)).toEqual([owner, revisionId]);
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(), owner, revisionId, { reelKey: "7".repeat(64), revisionHash: contentHash, audioId: null, sha256: "8".repeat(64), bytes: 10 },mocks.reel.mock.calls[0]![3].signal);
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

  it('passes the original render lifetime to the approved-track byte reader',async()=>{
    vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED','true');
    const audioId='44444444-4444-4444-8444-444444444444';mocks.audio.mockResolvedValue({id:audioId,bytes:Buffer.from('fixture')});
    mocks.reel.mockImplementation(async (_db,_owner,_revisionId,deps)=>{
      expect(deps.signal).toBeInstanceOf(AbortSignal);await deps.loadAudio({...renderedRevision(),audio:{trackId:audioId}});expect(mocks.audio).toHaveBeenCalledWith({},owner,audioId,deps.signal);
      return {reelKey:'7'.repeat(64),url:'https://test-only.supabase.co/signed',sha256:'8'.repeat(64),bytes:10,durationSeconds:9.5,silent:false,cached:false,revisionHash:contentHash,audioId};
    });const POST=await route();expect((await POST(ownerRequest())).status).toBe(200);expect(mocks.audio).toHaveBeenCalledOnce();
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

it.each(['audio','cache','slides','encode','put'] as const)('starts no later Reel phase after cancellation during %s',async phase=>{
 const {from}=database({revision:renderedRevision(),content_hash:contentHash,render_report:report()}),deps=dependencies(),controller=new AbortController();let resume!:(value:unknown)=>void;const gate=new Promise(done=>{resume=done;}),paused=vi.fn(()=>gate);
 if(phase==='audio')deps.loadAudio=paused as never;if(phase==='cache')deps.storage.find=paused as never;if(phase==='slides')deps.loadSlide=paused as never;if(phase==='encode')deps.render=paused as never;if(phase==='put')deps.storage.put=paused as never;
 const result=dneskaiReelForRevision({from} as unknown as Db,owner,revisionId,{...deps,signal:controller.signal}).then(()=>({name:'unexpected-success'}),error=>error);
 await vi.waitFor(()=>expect(paused).toHaveBeenCalled());controller.abort('TEST_ONLY_PRIVATE_REASON');resume(phase==='slides'?Buffer.from('slide-1'):phase==='encode'?{bytes:Buffer.from('fixture'),durationSeconds:9.5,silent:true}:phase==='put'?{reelKey:'a'.repeat(64),url:'https://example.test/reel',sha256:'b'.repeat(64),bytes:7}:null);
 expect(await result).toMatchObject({name:'AbortError',message:'Request aborted'});if(phase==='audio')expect(deps.storage.find).not.toHaveBeenCalled();if(['audio','cache'].includes(phase))expect(deps.loadSlide).not.toHaveBeenCalled();if(['audio','cache','slides'].includes(phase))expect(deps.render).not.toHaveBeenCalled();if(phase!=='put')expect(deps.storage.put).not.toHaveBeenCalled();
});

it.each([{id:'55555555-5555-4555-8555-555555555555'},{user_id:'55555555-5555-4555-8555-555555555555'},{extra:true}])('requires exact projected revision identity before any later phase: %#',async fields=>{
 const {from}=database({id:revisionId,user_id:owner,revision:renderedRevision(),content_hash:contentHash,render_report:report(),...fields}),deps=dependencies();await expect(dneskaiReelForRevision({from} as unknown as Db,owner,revisionId,deps)).rejects.toMatchObject({code:'reel-revision-unavailable'});expect(deps.loadAudio).not.toHaveBeenCalled();expect(deps.storage.find).not.toHaveBeenCalled();
});
it('starts no revision read after the original rendering scope retires',async()=>{const controller=new AbortController();controller.abort('TEST_ONLY_PRIVATE_REASON');const {from}=database(null),deps=dependencies();await expect(dneskaiReelForRevision({from} as unknown as Db,owner,revisionId,{...deps,signal:controller.signal})).rejects.toMatchObject({name:'AbortError',message:'Request aborted'});expect(from).not.toHaveBeenCalled();});
it('stops before cache/file work if a selected explicit track differs from the returned track',async()=>{const selected={...renderedRevision(),audio:{trackId:'44444444-4444-4444-8444-444444444444'}},deps=dependencies(),{from}=database({revision:selected,content_hash:revisionContentHash(selected),render_report:report()});deps.loadAudio.mockResolvedValue({id:'55555555-5555-4555-8555-555555555555',bytes:Buffer.from('fixture')} as never);await expect(dneskaiReelForRevision({from} as unknown as Db,owner,revisionId,deps)).rejects.toHaveProperty('code','reel-audio-unavailable');expect(deps.storage.find).not.toHaveBeenCalled();});

it('never changes an explicitly selected library track into silence',async()=>{const selected={...renderedRevision(),audio:{trackId:'44444444-4444-4444-8444-444444444444'}},deps=dependencies(),{from}=database({revision:selected,content_hash:revisionContentHash(selected),render_report:report()});await expect(dneskaiReelForRevision({from} as unknown as Db,owner,revisionId,deps)).rejects.toHaveProperty('code','reel-audio-unavailable');expect(deps.storage.find).not.toHaveBeenCalled();});
it.each([0,8*1024*1024+1])('stops after the first unsupported slide length %s',async size=>{const {from}=database({revision:renderedRevision(),content_hash:contentHash,render_report:report()}),deps=dependencies();deps.loadSlide.mockResolvedValue(Buffer.alloc(size));await expect(dneskaiReelForRevision({from} as unknown as Db,owner,revisionId,deps)).rejects.toHaveProperty('code','reel-slides-unavailable');expect(deps.loadSlide).toHaveBeenCalledOnce();expect(deps.render).not.toHaveBeenCalled();expect(deps.storage.put).not.toHaveBeenCalled();});
it('refuses oversize audio before cache, slide or encoding work',async()=>{const {from}=database({revision:renderedRevision(),content_hash:contentHash,render_report:report()}),deps=dependencies();deps.loadAudio.mockResolvedValue({id:'44444444-4444-4444-8444-444444444444',bytes:Buffer.alloc(20*1024*1024+1)} as never);await expect(dneskaiReelForRevision({from} as unknown as Db,owner,revisionId,deps)).rejects.toHaveProperty('code','reel-audio-unavailable');expect(deps.storage.find).not.toHaveBeenCalled();expect(deps.loadSlide).not.toHaveBeenCalled();});
it('settles cancellation even when an audio dependency never responds',async()=>{const {from}=database({revision:renderedRevision(),content_hash:contentHash,render_report:report()}),deps=dependencies(),controller=new AbortController();deps.loadAudio.mockImplementation(()=>new Promise(()=>{}));const pending=dneskaiReelForRevision({from} as unknown as Db,owner,revisionId,{...deps,signal:controller.signal}).catch(error=>error);await vi.waitFor(()=>expect(deps.loadAudio).toHaveBeenCalledOnce());controller.abort('TEST_ONLY_PRIVATE_REASON');expect(await pending).toMatchObject({name:'AbortError',message:'Request aborted'});expect(deps.storage.find).not.toHaveBeenCalled();});
