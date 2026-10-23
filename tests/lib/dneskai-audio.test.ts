import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), limited: vi.fn(async () => ({ ok: true, retryAfter: 0 })), admin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.limited }));
import { DneskaiAudioCreateSchema, dneskaiAudioClock, nextDneskaiAudioTrack } from "@/lib/marketing/dneskai-audio-contracts";
import { createDneskaiAudioTrack, loadDneskaiAudioTrack, parseFfmpegAudioProbe, probeDneskaiAudioDuration } from "@/lib/marketing/dneskai-audio";
import { GET, POST } from "@/app/api/marketing/dneskai/audio/route";

const owner = "11111111-1111-4111-8111-111111111111";
const uploadId = "33333333-3333-4333-8333-333333333333";
const create = { action: "create" as const, uploadId, contentType: "audio/mpeg" as const, title: "Calm Circuit", artist: "Test Artist", source: "pixabay" as const,
  licenceNote: "Pixabay Content License", sourceUrl: "https://pixabay.com/music/test-only", mood: ["Calm", "calm", "tech"] };

describe("rotation", () => {
  const tracks = [{ id: "a", enabled: true }, { id: "b", enabled: false }, { id: "c", enabled: true }, { id: "d", enabled: true }];
  it("takes the next enabled track after the previous one and wraps", () => {
    expect(nextDneskaiAudioTrack(tracks, null)?.id).toBe("a");
    expect(nextDneskaiAudioTrack(tracks, "a")?.id).toBe("c");
    expect(nextDneskaiAudioTrack(tracks, "d")?.id).toBe("a");
    expect(nextDneskaiAudioTrack(tracks, "b")?.id).toBe("a");
    expect(nextDneskaiAudioTrack([{ id: "x", enabled: false }], null)).toBeNull();
  });
  it("never repeats a track twice in a row while two are enabled", () => {
    let previous: string | null = null;
    for (let step = 0; step < 6; step++) { const next: string = nextDneskaiAudioTrack(tracks, previous)!.id; expect(next).not.toBe(previous); previous = next; }
  });
  it("formats a clock", () => { expect(dneskaiAudioClock(61_400)).toBe("1:01"); expect(dneskaiAudioClock(9_000)).toBe("0:09"); });
});

describe("upload checks", () => {
  it("normalises mood tags and refuses a plain-http source page", () => {
    expect(DneskaiAudioCreateSchema.parse(create).mood).toEqual(["calm", "calm", "tech"]);
    expect(DneskaiAudioCreateSchema.safeParse({ ...create, sourceUrl: "http://pixabay.com/x" }).success).toBe(false);
    expect(DneskaiAudioCreateSchema.safeParse({ ...create, source: "instagram-library" }).success).toBe(false);
  });
  it("reads the duration of an audio stream only", () => {
    expect(parseFfmpegAudioProbe("Duration: 00:01:02.50, start: 0\n  Stream #0:0: Audio: mp3, 44100 Hz")).toBe(62_500);
    expect(parseFfmpegAudioProbe("Duration: 00:00:05.00\n  Stream #0:0: Video: h264")).toBeNull();
    expect(parseFfmpegAudioProbe("Invalid data found")).toBeNull();
  });
  it("measures a real file with ffmpeg-static", async () => {
    const bytes = execFileSync(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-f", "mp3", "pipe:1"]);
    const duration = await probeDneskaiAudioDuration(bytes);
    expect(duration).toBeGreaterThan(1900);
    expect(duration).toBeLessThan(2200);
    expect(await probeDneskaiAudioDuration(Buffer.from("not audio"))).toBeNull();
  }, 30_000);
});

function storage(bytes: Buffer | null) {
  const files = {
    download: vi.fn(async () => bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: "missing" } }),
    remove: vi.fn(async () => ({ data: [], error: null })),
    createSignedUrls: vi.fn(async (names: string[]) => ({ data: names.map((path) => ({ path, signedUrl: `https://test-only.supabase.co/${path}?token=t`, error: null })), error: null })),
    createSignedUploadUrl: vi.fn(async (path: string) => ({ data: { path, token: "upload-token", signedUrl: "https://test-only.supabase.co/upload" }, error: null })),
  };
  const inserted: unknown[] = [];
  const rows: Record<string, unknown>[] = [];
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), range: vi.fn(async () => ({ data: rows, error: null })), limit: vi.fn(async () => ({ data: rows, error: null })),
    maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
    insert: vi.fn(async (row: Record<string, unknown>) => { inserted.push(row); rows.push({ ...row, created_at: "2026-10-23T08:00:00Z" }); return { error: null }; }),
  };
  return { db: { from: vi.fn(() => query), storage: { from: vi.fn(() => files) } }, files, inserted, rows };
}

describe("createDneskaiAudioTrack", () => {
  it("records a decodable upload under the owner's path with deduplicated mood tags", async () => {
    const { db, inserted } = storage(Buffer.from("mp3-bytes"));
    const track = await createDneskaiAudioTrack(db as never, owner, DneskaiAudioCreateSchema.parse(create), { probe: async () => 61_000 });
    expect(inserted[0]).toMatchObject({ id: uploadId, user_id: owner, storage_path: `marketing-audio/${owner}/${uploadId}.mp3`, duration_ms: 61_000, mood: ["calm", "tech"], enabled: true });
    expect(track).toMatchObject({ id: uploadId, durationMs: 61_000, previewUrl: `https://test-only.supabase.co/${owner}/${uploadId}.mp3?token=t` });
  });
  it("removes a file that is not audio and records nothing", async () => {
    const { db, files, inserted } = storage(Buffer.from("text"));
    await expect(createDneskaiAudioTrack(db as never, owner, DneskaiAudioCreateSchema.parse(create), { probe: async () => null })).rejects.toMatchObject({ code: "audio-upload-invalid" });
    expect(files.remove).toHaveBeenCalledWith([`${owner}/${uploadId}.mp3`]);
    expect(inserted).toEqual([]);
  });
  it("reports a missing upload", async () => {
    const { db } = storage(null);
    await expect(createDneskaiAudioTrack(db as never, owner, DneskaiAudioCreateSchema.parse(create), { probe: async () => 5000 })).rejects.toMatchObject({ code: "audio-upload-missing" });
  });
  it("loads a track's bytes only from the owner's folder", async () => {
    const { db, rows } = storage(Buffer.from("mp3"));
    rows.push({ id: uploadId, storage_path: `marketing-audio/${owner}/${uploadId}.mp3` });
    expect((await loadDneskaiAudioTrack(db as never, owner, uploadId)).bytes).toEqual(Buffer.from("mp3"));
    rows[0] = { id: uploadId, storage_path: `marketing-audio/22222222-2222-4222-8222-222222222222/${uploadId}.mp3` };
    await expect(loadDneskaiAudioTrack(db as never, owner, uploadId)).rejects.toMatchObject({ code: "audio-track-unavailable" });
  });
});

describe("audio route", () => {
  const url = "https://own.example/api/marketing/dneskai/audio";
  const post = (body: unknown, origin = "https://own.example") => new Request(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  beforeEach(() => { vi.clearAllMocks(); mocks.client.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: owner } } }) } }); });
  afterEach(() => vi.unstubAllEnvs());

  it("is hidden while the Reels switch is off", async () => {
    expect((await GET()).status).toBe(404);
    expect((await POST(post({ action: "prepare", contentType: "audio/mpeg", bytes: 10 }))).status).toBe(404);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("rejects malformed page and track selectors", async () => {
    vi.stubEnv("MARKETING_DNESKAI_REELS_ENABLED", "true");
    for (const query of ["offset=-1", "offset=1000001", "offset=1.5", "trackId=not-a-uuid"]) {
      expect((await GET(new Request(`${url}?${query}`))).status).toBe(400);
    }
  });
  it("lists the library and hands out one signed upload path", async () => {
    vi.stubEnv("MARKETING_DNESKAI_REELS_ENABLED", "true");
    const { db, files } = storage(null);
    mocks.admin.mockReturnValue(db);
    expect(await (await GET()).json()).toEqual({ tracks: [], nextOffset: null });
    const prepared = await (await POST(post({ action: "prepare", contentType: "audio/mpeg", bytes: 1024 }))).json();
    expect(prepared).toMatchObject({ token: "upload-token" });
    expect(prepared.path).toMatch(new RegExp(`^${owner}/[0-9a-f-]{36}\\.mp3$`));
    expect(files.createSignedUploadUrl).toHaveBeenCalledWith(prepared.path);
  });
  it("refuses a stranger, a cross-origin post, a file over 20 MB and an unknown action", async () => {
    vi.stubEnv("MARKETING_DNESKAI_REELS_ENABLED", "true");
    expect((await POST(post({ action: "prepare", contentType: "audio/mpeg", bytes: 10 }, "https://evil.example"))).status).toBe(403);
    expect((await POST(post({ action: "prepare", contentType: "audio/mpeg", bytes: 21 * 1024 * 1024 }))).status).toBe(400);
    expect((await POST(post({ action: "delete", id: uploadId }))).status).toBe(400);
    mocks.client.mockReturnValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    expect((await GET()).status).toBe(401);
  });
});
