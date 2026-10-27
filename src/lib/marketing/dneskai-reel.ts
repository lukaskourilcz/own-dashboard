import "server-only";
import {boundedStreamBytes,boundedResponseText} from "@/lib/bounded-response";
import {awaitWithSignal} from "@/lib/abortable";
import {databaseTimestamp} from "@/lib/database-version";
import { marketingStorageObjectMissing } from "./storage-errors";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { DneskaiRenderReportSchema, parseContentRevision } from "./contracts";
import { DNESKAI_REEL, DNESKAI_REEL_POLICY, dneskaiReelDuration, dneskaiReelKey, renderDneskaiReel, DneskaiReelRenderError,type DneskaiReelAudio } from "./dneskai-reel-render";
import { dneskaiDeckContentBlocked } from "./dneskai-slide-layout";
import { revisionContentHash } from "./hashes";
import { signAutomationBody } from "./automation-auth";
import {DNESKAI_AUDIO_MAX_BYTES} from "./dneskai-audio-contracts";
import { MARKETING_ASSET_MAX_BYTES,MARKETING_ASSET_BUCKET, MARKETING_ASSET_URL_SECONDS, dneskaiSlideObjectKey } from "./worker-runtime";

/**
 * Stored DNESKAi Reels (#163): renders an approved deck's slides into an MP4 once per reel key and keeps it in the
 * private `marketing-reels` bucket (migration 20261023130000). Instagram receives a signed URL, valid seven days
 * like the slide URLs, which its cURL fetch can read without a session.
 */
type Database = ReturnType<typeof createAdminClient>;

export const DNESKAI_REEL_BUCKET = "marketing-reels";
/** The bucket's own limit (migration). A 10-slide reel at 8 Mbps is about 31 MB. */
export const DNESKAI_REEL_MAX_BYTES = 64 * 1024 * 1024;

/** Server-only switch for everything Reel: the render route and, with #165, publishing a revision as a Reel. */
export function dneskaiReelsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MARKETING_DNESKAI_REELS_ENABLED === "true";
}

export const DNESKAI_REEL_ERROR_CODES = ["reel-revision-unavailable", "reel-revision-not-deck", "reel-render-required", "reel-slides-unavailable", "reel-audio-unavailable", "reel-storage-failed", "reel-bucket-required"] as const;
export type DneskaiReelErrorCode = typeof DNESKAI_REEL_ERROR_CODES[number];
export class DneskaiReelError extends Error {
  constructor(readonly code: DneskaiReelErrorCode) { super(code); this.name = "DneskaiReelError"; }
}

export function dneskaiReelObjectKey(ownerId: string, reelKey: string): string {
  z.uuid().parse(ownerId);
  if (!/^[a-f0-9]{64}$/.test(reelKey)) throw new DneskaiReelError("reel-storage-failed");
  return `${ownerId}/marketing/dneskai/reels/${reelKey}.mp4`;
}

export type StoredDneskaiReel = { reelKey: string; url: string; sha256: string; bytes: number };

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** One immutable MP4 per owner and reel key, verified (size, type, owner, key, sha256) before it is signed. */
export function createDneskaiReelStorage(db: Database, ownerId: string, signal?: AbortSignal) {
    z.uuid().parse(ownerId);
    let checked: Promise<void> | null = null;
    const files = async () => {
        signal?.throwIfAborted();
        checked ??= db.storage.getBucket(DNESKAI_REEL_BUCKET).then(({ data, error }) => {
            if (error || !data || data.public)
                throw new DneskaiReelError("reel-bucket-required");
        });
        try {
            await awaitWithSignal(checked, signal);
            signal?.throwIfAborted();
        }
        catch (failure) {
            checked = null;
            throw failure;
        }
        return db.storage.from(DNESKAI_REEL_BUCKET);
    };
    const sign = async (key: string) => {
        const signed = await awaitWithSignal((await files()).createSignedUrl(key, MARKETING_ASSET_URL_SECONDS), signal);
        signal?.throwIfAborted();
        if (signed.error || !signed.data?.signedUrl?.startsWith("https://"))
            throw new DneskaiReelError("reel-storage-failed");
        return signed.data.signedUrl;
    };
    return {
        async find(reelKey: string): Promise<StoredDneskaiReel | null> {
            const key = dneskaiReelObjectKey(ownerId, reelKey);
            const info = await awaitWithSignal((await files()).info(key), signal);
            signal?.throwIfAborted();
            if (info.error) {
                if (marketingStorageObjectMissing(info.error))
                    return null;
                throw new DneskaiReelError("reel-storage-failed");
            }
            if (!info.data)
                throw new DneskaiReelError("reel-storage-failed");
            const metadata: Record<string, unknown> = info.data.metadata ?? {};
            const recorded = typeof metadata.sha256 === "string" ? metadata.sha256 : "";
            if (!/^[a-f0-9]{64}$/.test(recorded) || metadata.ownerId !== ownerId || metadata.reelKey !== reelKey || info.data.contentType !== "video/mp4"
                || !Number.isInteger(info.data.size) || !info.data.size || info.data.size > DNESKAI_REEL_MAX_BYTES)
                throw new DneskaiReelError("reel-storage-failed");
            return { reelKey, url: await sign(key), sha256: recorded, bytes: info.data.size };
        },
        async put(input: {
            reelKey: string;
            bytes: Buffer;
            metadata: Record<string, string>;
        }): Promise<StoredDneskaiReel> {
            const key = dneskaiReelObjectKey(ownerId, input.reelKey);
            if (!input.bytes.length || input.bytes.length > DNESKAI_REEL_MAX_BYTES)
                throw new DneskaiReelError("reel-storage-failed");
            const digest = sha256(input.bytes);
            const metadata = { ...input.metadata, reelKey: input.reelKey, sha256: digest, ownerId };
            const store = await files();
            await awaitWithSignal(store.upload(key, input.bytes, { upsert: false, contentType: "video/mp4", cacheControl: "3600", metadata }), signal);
            signal?.throwIfAborted();
            const info = await awaitWithSignal(store.info(key), signal);
            signal?.throwIfAborted();
            if (info.error || !info.data || info.data.size !== input.bytes.length || info.data.contentType !== "video/mp4"
                || !Object.entries(metadata).every(([field, value]) => info.data.metadata?.[field] === value))
                throw new DneskaiReelError("reel-storage-failed");
            return { reelKey: input.reelKey, url: await sign(key), sha256: digest, bytes: input.bytes.length };
        },
    };
}

/** A rendered slide JPEG from the render-key cache in `marketing-assets`, checked against its recorded sha256. */
export async function loadDneskaiSlideBytes(db: Database, ownerId: string, renderKey: string, parent?: AbortSignal): Promise<Buffer> {
    const signal = AbortSignal.any([AbortSignal.timeout(15000), ...(parent ? [parent] : [])]), discard = (stream: ReadableStream | null) => {
        if (stream && !stream.locked)
            void stream.cancel().catch(() => undefined);
    };
    try {
        signal.throwIfAborted();
        const key = dneskaiSlideObjectKey(ownerId, renderKey), store = db.storage.from(MARKETING_ASSET_BUCKET);
        const info = await awaitWithSignal(store.info(key), signal);
        signal.throwIfAborted();
        const metadata = info.data?.metadata, recorded = metadata?.sha256, size = info.data?.size;
        if (info.error || !info.data || metadata?.ownerId !== ownerId || metadata?.renderKey !== renderKey || typeof recorded !== 'string' || !/^[a-f0-9]{64}$/.test(recorded) || info.data.contentType !== 'image/jpeg' || !Number.isSafeInteger(size) || !size || size < 1 || size > MARKETING_ASSET_MAX_BYTES)
            throw new Error();
        const pending = Promise.resolve(store.download(key, {}, { signal }).asStream());
        void pending.then(result => {
            if (signal.aborted)
                discard(result.data);
        }, () => undefined);
        const result = await awaitWithSignal(pending, signal);
        if (signal.aborted) {
            discard(result.data);
            signal.throwIfAborted();
        }
        if (result.error || !result.data) {
            discard(result.data);
            throw new Error();
        }
        const collected = await boundedStreamBytes(result.data, size, signal, size);
        signal.throwIfAborted();
        const bytes = Buffer.from(collected.buffer, collected.byteOffset, collected.byteLength);
        if (sha256(bytes) !== recorded)
            throw new Error();
        return bytes;
    }
    catch {
        if (parent?.aborted)
            throw new DOMException('Request aborted', 'AbortError');
        throw new DneskaiReelError('reel-slides-unavailable');
    }
}

export type DneskaiReelDependencies = {
  loadSlide(renderKey: string,signal?:AbortSignal): Promise<Buffer>;
  /** The revision's audio, or null for the silent variant. */
  loadAudio(revision: ReturnType<typeof parseContentRevision>,signal?:AbortSignal): Promise<DneskaiReelAudio | null>;
  storage: ReturnType<typeof createDneskaiReelStorage>;
  render?: typeof renderDneskaiReel;
  signal?: AbortSignal;
};

export type DneskaiReelOutcome = StoredDneskaiReel & { cached: boolean; durationSeconds: number; silent: boolean; revisionHash: string; audioId: string | null };

/**
 * The reel of one revision: read it, take its rendered slides in order, reuse the stored MP4 for the same reel key
 * or render and store one. Refuses a revision without a clean deck render; never touches approval or publication.
 */
export async function dneskaiReelForRevision(db: Database, ownerId: string, revisionId: string, dependencies: DneskaiReelDependencies): Promise<DneskaiReelOutcome> {
    const signal = AbortSignal.any([AbortSignal.timeout(280000), ...(dependencies.signal ? [dependencies.signal] : [])]);
    try {
        signal.throwIfAborted();
        if (!z.uuid().safeParse(ownerId).success)
            throw new DneskaiReelError("reel-revision-unavailable");
        if (!z.uuid().safeParse(revisionId).success)
            throw new DneskaiReelError("reel-revision-unavailable");
        const readSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        const { data, error } = await awaitWithSignal(db.from('marketing_revisions').select('id,user_id,revision,content_hash,render_report').eq('id', revisionId).eq('user_id', ownerId).retry(false).abortSignal(readSignal).maybeSingle(), readSignal).catch(() => {
            throw new DneskaiReelError('reel-revision-unavailable');
        });
        signal.throwIfAborted();
        const checked = z.strictObject({ id: z.uuid(), user_id: z.uuid(), revision: z.unknown(), content_hash: z.string().regex(/^[a-f0-9]{64}$/), render_report: z.unknown() }).safeParse(data);
        if (error || !checked.success || checked.data.id !== revisionId || checked.data.user_id !== ownerId)
            throw new DneskaiReelError('reel-revision-unavailable');
        const row = checked.data;
        let revision;
        try {
            revision = parseContentRevision(row.revision);
        }
        catch {
            throw new DneskaiReelError("reel-revision-unavailable");
        }
        if (revision.brand !== 'dneskai')
            throw new DneskaiReelError('reel-revision-not-deck');
        if (!revision.deck)
            throw new DneskaiReelError("reel-revision-not-deck");
        if (row.content_hash !== revisionContentHash(revision))
            throw new DneskaiReelError("reel-revision-unavailable");
        const report = DneskaiRenderReportSchema.safeParse(row.render_report);
        const slideCount = revision.deck.slides.length;
        if (dneskaiDeckContentBlocked(revision.deck) || !report.success || report.data.status !== "rendered" || report.data.problems.some((problem) => problem.blocking)
            || report.data.renderKeys.length !== slideCount || revision.assets.length !== slideCount || revision.assets.some(asset => asset.mimeType !== "image/jpeg")
            || report.data.renderKeys.some(key => !/^[a-f0-9]{64}$/.test(key)) || slideCount > DNESKAI_REEL.maxSlides)
            throw new DneskaiReelError("reel-render-required");
        const revisionHash = String(row.content_hash);
        const audio = await awaitWithSignal(dependencies.loadAudio(revision, signal), signal);
        signal.throwIfAborted();
        if (revision.audio && 'trackId' in revision.audio && !audio)
            throw new DneskaiReelError('reel-audio-unavailable');
        if (audio && (!z.uuid().safeParse(audio.id).success || !Buffer.isBuffer(audio.bytes) || !audio.bytes.length || audio.bytes.length > DNESKAI_AUDIO_MAX_BYTES || revision.audio && ('instagramAudioId' in revision.audio || revision.audio.trackId !== audio.id)))
            throw new DneskaiReelError("reel-audio-unavailable");
        const audioIdentity = audio ? { id: audio.id, sha256: sha256(audio.bytes) } : null;
        const reelKey = dneskaiReelKey({ slideSha256s: revision.assets.map(asset => asset.sha256), audio: audioIdentity });
        const found = await awaitWithSignal(dependencies.storage.find(reelKey), signal);
        signal.throwIfAborted();
        const durationSeconds = dneskaiReelDuration(slideCount);
        if (found)
            return { ...found, cached: true, durationSeconds, silent: !audio, revisionHash, audioId: audio?.id ?? null };
        const slides: Buffer[] = [];
        try {
            for (const key of report.data.renderKeys) {
                signal.throwIfAborted();
                const bytes = await awaitWithSignal(dependencies.loadSlide(key, signal), signal);
                signal.throwIfAborted();
                if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MARKETING_ASSET_MAX_BYTES || sha256(bytes) !== revision.assets[slides.length]!.sha256)
                    throw new DneskaiReelError('reel-slides-unavailable');
                slides.push(bytes);
            }
        }
        catch {
            signal.throwIfAborted();
            throw new DneskaiReelError('reel-slides-unavailable');
        }
        signal.throwIfAborted();
        const rendered = await awaitWithSignal((dependencies.render ?? renderDneskaiReel)({ slides, audio, signal }), signal);
        signal.throwIfAborted();
        const stored = await awaitWithSignal(dependencies.storage.put({
            reelKey,
            bytes: rendered.bytes,
            metadata: { audioId: audio?.id ?? "silent", audioSha256: audioIdentity?.sha256 ?? "silent", policy: DNESKAI_REEL_POLICY, durationSeconds: String(rendered.durationSeconds) },
        }), signal);
        signal.throwIfAborted();
        return { ...stored, cached: false, durationSeconds: rendered.durationSeconds, silent: rendered.silent, revisionHash, audioId: audio?.id ?? null };
    }
    catch (error) {
        if (dependencies.signal?.aborted)
            throw new DOMException('Request aborted', 'AbortError');
        if (signal.aborted)
            throw new DneskaiReelRenderError('reel-timeout');
        throw error;
    }
}

/* ---- the render record (#165) --------------------------------------------------------------------------------- */

/**
 * Every stored Reel is recorded as a `marketing_events` row (`dneskai-reel-rendered`, delivered at once, so nothing
 * treats it as a pending notice) on its revision. The publisher finds a revision's Reel through it, whatever track the
 * rotation picked, and the rotation reads the track of the last Reel from it. No schema change.
 */
export const DNESKAI_REEL_EVENT = "dneskai-reel-rendered";
const ReelRecordSchema = z.object({
  reelKey: z.string().regex(/^[a-f0-9]{64}$/), revisionHash: z.string().regex(/^[a-f0-9]{64}$/),
  audioId: z.uuid().nullable(), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive(),
});
export type DneskaiReelRecord = z.infer<typeof ReelRecordSchema>;

export async function recordDneskaiReel(db: Database, ownerId: string, revisionId: string, reel: DneskaiReelRecord): Promise<void> {
  z.uuid().parse(ownerId);
  const existing = await db.from("marketing_events").select("id").eq("user_id", ownerId).eq("revision_id", revisionId).eq("kind", DNESKAI_REEL_EVENT)
    .eq("payload->>reelKey", reel.reelKey).limit(1);
  if (existing.error) throw new DneskaiReelError("reel-storage-failed");
  if (existing.data?.length) return;
  const { error } = await db.from("marketing_events").insert({ user_id: ownerId, revision_id: revisionId, kind: DNESKAI_REEL_EVENT, payload: ReelRecordSchema.parse(reel), delivered_at: new Date().toISOString() });
  if (error) throw new DneskaiReelError("reel-storage-failed");
}

/** Exact approved-hash history, then a positively matching immutable object. Only confirmed empty history is absent. */
export async function findDneskaiReelForRevision(db: Database, ownerId: string, revisionId: string, revisionHash: string, storage?: ReturnType<typeof createDneskaiReelStorage>, parent?: AbortSignal): Promise<(StoredDneskaiReel & {
    audioId: string | null;
}) | null> {
    const signal = AbortSignal.any([AbortSignal.timeout(15000), ...(parent ? [parent] : [])]);
    try {
        z.uuid().parse(ownerId);
        z.uuid().parse(revisionId);
        z.string().regex(/^[a-f0-9]{64}$/).parse(revisionHash);
        signal.throwIfAborted();
        const { data, error } = await awaitWithSignal(db.from('marketing_events').select('id,user_id,revision_id,kind,created_at,reelKey:payload->reelKey,revisionHash:payload->revisionHash,audioId:payload->audioId,sha256:payload->sha256,bytes:payload->bytes').eq('user_id', ownerId).eq('revision_id', revisionId).eq('kind', DNESKAI_REEL_EVENT).eq('payload->>revisionHash', revisionHash).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).retry(false).abortSignal(signal), signal);
        signal.throwIfAborted();
        if (error)
            throw new Error();
        const rows = z.array(ReelRecordSchema.strict().extend({ id: z.uuid(), user_id: z.uuid(), revision_id: z.uuid(), kind: z.literal(DNESKAI_REEL_EVENT), created_at: databaseTimestamp, bytes: z.number().int().min(1).max(DNESKAI_REEL_MAX_BYTES) })).max(1).parse(data);
        if (!rows.length)
            return null;
        const record = rows[0]!;
        if (record.user_id !== ownerId || record.revision_id !== revisionId || record.revisionHash !== revisionHash)
            throw new Error();
        const stored = z.object({ reelKey: z.literal(record.reelKey), sha256: z.literal(record.sha256), bytes: z.literal(record.bytes), url: z.url().refine(value => {
                const url = new URL(value);
                return url.protocol === 'https:' && !url.username && !url.password;
            }) }).strict().parse(await awaitWithSignal((storage ?? createDneskaiReelStorage(db, ownerId, signal)).find(record.reelKey), signal));
        signal.throwIfAborted();
        return { ...stored, audioId: record.audioId };
    }
    catch {
        if (parent?.aborted)
            throw new DOMException('Request aborted', 'AbortError');
        throw new DneskaiReelError('reel-storage-failed');
    }
}

/** The track of the most recent Reel of another revision, for the rotation; null before the first Reel. */
export async function lastDneskaiReelAudio(db: Database, ownerId: string, exceptRevisionId: string, parent?: AbortSignal): Promise<string | null> {
    const signal = AbortSignal.any([AbortSignal.timeout(15000), ...(parent ? [parent] : [])]);
    try {
        z.uuid().parse(ownerId);
        z.uuid().parse(exceptRevisionId);
        signal.throwIfAborted();
        const { data, error } = await awaitWithSignal(db.from('marketing_events').select('id,user_id,revision_id,kind,created_at,reelKey:payload->reelKey,revisionHash:payload->revisionHash,audioId:payload->audioId,sha256:payload->sha256,bytes:payload->bytes').eq('user_id', ownerId).eq('kind', DNESKAI_REEL_EVENT).neq('revision_id', exceptRevisionId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).retry(false).abortSignal(signal), signal);
        signal.throwIfAborted();
        if (error)
            throw new Error();
        const rows = z.array(ReelRecordSchema.strict().extend({ id: z.uuid(), user_id: z.uuid(), revision_id: z.uuid(), kind: z.literal(DNESKAI_REEL_EVENT), created_at: databaseTimestamp, bytes: z.number().int().min(1).max(DNESKAI_REEL_MAX_BYTES) })).max(1).parse(data);
        if (!rows.length)
            return null;
        const row = rows[0]!;
        if (row.user_id !== ownerId || row.revision_id === exceptRevisionId)
            throw new Error();
        return row.audioId;
    }
    catch {
        if (parent?.aborted)
            throw new DOMException('Request aborted', 'AbortError');
        throw new DneskaiReelError('reel-storage-failed');
    }
}

/** Acknowledges only registered post-response work, not a durable job or a completed/stored Reel. */
export const DneskaiReelAcceptedSchema=z.strictObject({status:z.literal('accepted'),ownerId:z.uuid(),revisionId:z.uuid(),audioTrackId:z.uuid().nullable()});
/** Ask the same deployment once; require its exact scoped 202 acknowledgement within ten seconds. */
export async function requestDneskaiReelRender(input: {
    origin: string;
    revisionId: string;
    audioTrackId: string | null;
    signal?: AbortSignal;
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
}): Promise<boolean> {
    const env = input.env ?? process.env, secret = env.MARKETING_SCHEDULER_SECRET;
    const signal = AbortSignal.any([AbortSignal.timeout(10000), ...(input.signal ? [input.signal] : [])]);
    const discard = (response: Response) => {
        if (response.body && !response.body.locked)
            void response.body.cancel().catch(() => undefined);
    };
    let response: Response | undefined;
    try {
        const ownerId = z.uuid().parse(env.MARKETING_OWNER_ID);
        z.uuid().parse(input.revisionId);
        z.uuid().nullable().parse(input.audioTrackId);
        signal.throwIfAborted();
        const origin = new URL(input.origin);
        if (!secret || secret.length < 32 || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !['https:', 'http:'].includes(origin.protocol) || origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
            return false;
        const body = JSON.stringify({ revisionId: input.revisionId, audioTrackId: input.audioTrackId, async: true });
        const pending = (input.fetcher ?? fetch)(new URL('/api/marketing/dneskai/render-reel', origin).href, { method: 'POST', body, redirect: 'error', cache: 'no-store', signal, headers: signAutomationBody(body, secret) });
        void pending.then(response => {
            if (signal.aborted)
                discard(response);
        }, () => undefined);
        response = await awaitWithSignal(pending, signal);
        signal.throwIfAborted();
        if (response.status !== 202 || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
            discard(response);
            return false;
        }
        const receipt = DneskaiReelAcceptedSchema.parse(JSON.parse(await boundedResponseText(response, 1024, signal)));
        signal.throwIfAborted();
        return receipt.ownerId === ownerId && receipt.revisionId === input.revisionId && receipt.audioTrackId === input.audioTrackId;
    }
    catch {
        if (response)
            discard(response);
        return false;
    }
}
