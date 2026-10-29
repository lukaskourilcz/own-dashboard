'use client';

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient, type QueryClient, type InfiniteData } from '@tanstack/react-query';
import { qk } from '@/lib/queries/keys';
import { z } from 'zod';
import { createSignedStorageClient } from '@/lib/supabase/client';
import { awaitWithSignal } from '@/lib/abortable';
import { readTextPrefix } from '@/lib/bounded-text';
import { databaseVersion } from '@/lib/database-version';
import {
  DNESKAI_AUDIO_MAX_BYTES, DNESKAI_AUDIO_TYPES, DneskaiAudioCreateSchema, DneskaiAudioLibrarySchema, DneskaiAudioPreparedSchema, DneskaiAudioTrackSchema, DneskaiAudioCursorSchema, DneskaiAudioToggleSchema, DneskaiAudioToggleReceiptSchema,
  type DneskaiAudioCreate, type DneskaiAudioTrack, type DneskaiAudioTrend, type DneskaiAudioTrendsStatus, type DneskaiAudioCursor, type DneskaiAudioToggle, type DneskaiAudioToggleReceipt,
} from './dneskai-audio-contracts';

/** Only known codes leave the request boundary; upstream text never enters a dictionary. */
const refusalCode = z.enum(['decision-failed', 'audio-library-unavailable', 'audio-upload-missing', 'audio-upload-invalid', 'audio-track-unavailable', 'audio-track-write-failed', 'audio-track-changed', 'rate-limited', 'invalid-request', 'unauthorized', 'not-found']);
export class DneskaiAudioRequestError extends Error {
  constructor(readonly code: z.infer<typeof refusalCode> | 'audio-page-unavailable', readonly status: number) { super(code); this.name = 'DneskaiAudioRequestError'; }
}
const URL_PATH = '/api/marketing/dneskai/audio';
const MAX_POST_BYTES = 8192;
const budget = (milliseconds: number, parent?: AbortSignal) => AbortSignal.any([AbortSignal.timeout(milliseconds), ...(parent ? [parent] : [])]);
async function json(response: Response, maximum: number, signal: AbortSignal): Promise<unknown> {
  const result = await awaitWithSignal(readTextPrefix(response, maximum, signal), signal);
  if (result.truncated) throw new DneskaiAudioRequestError('decision-failed', response.status);
  return JSON.parse(result.text);
}
async function failure(response: Response, signal: AbortSignal) {
  if (response.status === 429) { void response.body?.cancel().catch(() => undefined); return new DneskaiAudioRequestError('rate-limited', 429); }
  const result = z.strictObject({ error: refusalCode }).safeParse(await json(response, 4096, signal));
  return new DneskaiAudioRequestError(result.success ? result.data.error : 'decision-failed', response.status);
}
function failed(error: unknown, parent?: AbortSignal): never {
  if (parent?.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof DneskaiAudioRequestError ? error : new DneskaiAudioRequestError('decision-failed', 0);
}
async function audioResponse(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    signal.throwIfAborted();
    let discarded = false;
    const discard = (response: Response) => {
        if (discarded)
            return;
        discarded = true;
        void response.body?.cancel().catch(() => undefined);
    };
    const pending = fetch(url, { ...init, signal });
    void pending.then(response => {
        if (signal.aborted)
            discard(response);
    }, () => undefined);
    const response = await awaitWithSignal(pending, signal);
    if (signal.aborted) {
        discard(response);
        signal.throwIfAborted();
    }
    return response;
}
async function post(body: unknown, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const encoded = JSON.stringify(body);
  if (new TextEncoder().encode(encoded).byteLength > MAX_POST_BYTES) throw new DneskaiAudioRequestError('invalid-request', 0);
  const response = await audioResponse(URL_PATH, {method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:encoded},signal);
  if (!response.ok) throw await failure(response, signal);
  return json(response, 16_384, signal);
}

/** Two sample tracks for `/dev-preview`; no file behind them, so nothing plays. */
export const DEMO_DNESKAI_AUDIO_TRACKS: DneskaiAudioTrack[] = [
  { id: '0f6b5c1e-3d2a-4c8b-9e7f-1a2b3c4d5e01', title: 'Quiet Circuit', artist: 'Sample artist', source: 'pixabay', licenceNote: 'Pixabay Content License (sample)', sourceUrl: 'https://pixabay.com/music/', durationMs: 72_000, mood: ['calm', 'tech'], enabled: true, createdAt: '2026-10-23T08:00:00.000Z', updatedAt:'2026-10-23T08:00:00.000Z', previewUrl: null },
  { id: '0f6b5c1e-3d2a-4c8b-9e7f-1a2b3c4d5e02', title: 'Morning Signal', artist: 'Sample artist', source: 'meta-sound-collection', licenceNote: 'Meta Sound Collection, cleared for Instagram (sample)', sourceUrl: 'https://www.facebook.com/sound/collection/', durationMs: 45_000, mood: ['upbeat'], enabled: false, createdAt: '2026-10-23T08:05:00.000Z', updatedAt:'2026-10-23T08:05:00.000Z', previewUrl: null },
];

/**
 * The owner's library, or null while Reels are switched off (the route answers 404), so the screens stay hidden.
 * In the preview, the sample tracks.
 */
export async function loadDneskaiAudioLibrary(preview: boolean, signal?: AbortSignal): Promise<DneskaiAudioTrack[] | null> {
  return (await loadDneskaiAudioOptions(preview, signal))?.tracks ?? null;
}

/** The library and, while their switch is on, today's trending sounds (#167). Null while Reels are off. */
export async function loadDneskaiAudioOptions(preview: boolean, parent?: AbortSignal, offset = 0, trackId?: string, after?: DneskaiAudioCursor): Promise<{ tracks: DneskaiAudioTrack[]; trends: DneskaiAudioTrend[]; trendsStatus?: DneskaiAudioTrendsStatus; nextOffset?: number | null; nextCursor?: DneskaiAudioCursor } | null> {
  if (preview) return { tracks: DEMO_DNESKAI_AUDIO_TRACKS, trends: [], trendsStatus: 'disabled' };
  const signal = budget(20_000, parent);
  let pageAdmitted = false;
  try {
    z.number().int().min(0).max(1_000_000).parse(offset);
    if (trackId !== undefined) { z.uuid().parse(trackId); if (offset !== 0 || after !== undefined) throw new Error('invalid-selector'); }
    const cursor = after === undefined ? undefined : DneskaiAudioCursorSchema.parse(after);
    if ((offset > 0) !== !!cursor) throw new Error('invalid-selector');
    signal.throwIfAborted();
    const params = new URLSearchParams();
    if (offset) params.set('offset', String(offset));
    if (trackId) params.set('trackId', trackId);
    if (cursor) {params.set('afterCreatedAt', cursor.createdAt); params.set('afterId', cursor.id);}
    pageAdmitted = offset > 0;
    const response = await audioResponse(`${URL_PATH}${params.size ? `?${params}` : ''}`, {cache:'no-store'},signal);
    if (!response.ok) { const refused = await failure(response, signal); if (response.status === 404 && refused.code === 'not-found' && offset === 0) return null; throw refused; }
    const parsed = DneskaiAudioLibrarySchema.parse(await json(response, 2_097_152, signal));
    if (new Set(parsed.tracks.map(track => track.id)).size !== parsed.tracks.length || new Set(parsed.trends?.map(trend => trend.audioId) ?? []).size !== (parsed.trends?.length ?? 0)
      || (trackId && (parsed.tracks.length > 1 || parsed.tracks.some(track => track.id !== trackId) || parsed.nextOffset != null))
      || (parsed.nextOffset != null && (!parsed.tracks.length || parsed.nextOffset !== offset + parsed.tracks.length))) throw new Error('invalid-page');
    const last = parsed.tracks.at(-1);
    if (parsed.nextOffset != null ? !parsed.nextCursor || !last || parsed.nextCursor.id !== last.id || databaseVersion(parsed.nextCursor.createdAt) !== databaseVersion(last.createdAt) : parsed.nextCursor !== undefined) throw new Error('invalid-cursor');
    if (cursor && parsed.tracks.some(track => {
      const version = databaseVersion(track.createdAt), boundary = databaseVersion(cursor.createdAt)!;
      return version === null || version < boundary || (version === boundary && track.id <= cursor.id);
    })) throw new Error('invalid-cursor');
    return { ...(parsed.nextCursor ? {nextCursor: parsed.nextCursor} : {}), tracks: parsed.tracks, trends: parsed.trends ?? [], ...(parsed.trendsStatus ? {trendsStatus: parsed.trendsStatus} : {}), nextOffset: parsed.nextOffset ?? null };
  } catch (error) {
    if (pageAdmitted && !parent?.aborted) throw new DneskaiAudioRequestError('audio-page-unavailable', error instanceof DneskaiAudioRequestError ? error.status : 0);
    failed(error, parent);
  }
}

function confirmedAudioToggleReceipt(intent: DneskaiAudioToggle, value: unknown): Extract<DneskaiAudioToggleReceipt, {
    kind: 'saved';
}> {
    const receipt = DneskaiAudioToggleReceiptSchema.parse(value);
    if (receipt.kind !== 'saved' || receipt.ownerId !== intent.ownerId || receipt.id !== intent.id || receipt.requestedEnabled !== intent.enabled || databaseVersion(receipt.expectedVersion) !== databaseVersion(intent.expectedVersion) || databaseVersion(receipt.updatedAt)! <= databaseVersion(intent.expectedVersion)!)
        throw new DneskaiAudioRequestError('decision-failed', 0);
    return receipt;
}

/** The original owner and exact row version are captured before transport. */
export async function setDneskaiAudioTrackEnabled(input: DneskaiAudioToggle, parent?: AbortSignal): Promise<Extract<DneskaiAudioToggleReceipt, {
    kind: 'saved';
}>> {
    const signal = budget(20000, parent);
    try {
        const intent = DneskaiAudioToggleSchema.parse(input);
        const reply = z.strictObject({ receipt: z.unknown() }).parse(await post(intent, signal));
        const receipt = confirmedAudioToggleReceipt(intent, reply.receipt);
        return receipt;
    }
    catch (error) {
        failed(error, parent);
    }
}

/** Patch only the captured source version; never roll back a newer cached row. */
export function applyDneskaiAudioToggleReceipt(client: QueryClient, input: DneskaiAudioToggle, value: Extract<DneskaiAudioToggleReceipt, {
    kind: 'saved';
}>) {
    const intent = DneskaiAudioToggleSchema.parse(input), receipt = confirmedAudioToggleReceipt(intent, value);
    let seen = false, reconcile = false;
    type Page = Awaited<ReturnType<typeof loadDneskaiAudioOptions>>;
    const patch = (page: Page): Page => {
        if (!page)
            return page;
        let changed = false;
        const tracks = page.tracks.map(track => {
            if (track.id !== intent.id)
                return track;
            seen = true;
            if (databaseVersion(track.updatedAt) !== databaseVersion(intent.expectedVersion)) {
                reconcile = true;
                return track;
            }
            changed = true;
            return { ...track, enabled: receipt.requestedEnabled, updatedAt: receipt.updatedAt };
        });
        return changed ? { ...page, tracks } : page;
    };
    client.setQueryData<InfiniteData<Page>>([...qk.dneskaiAudio, false, 'pages'], before => before ? { ...before, pages: before.pages.map(patch) } : before);
    client.setQueryData<Page>([...qk.dneskaiAudio, false, 'selected', intent.id], before => before ? patch(before) : before);
    return { reconcile: reconcile || !seen };
}

export type DneskaiAudioUpload = Omit<DneskaiAudioCreate, 'action' | 'uploadId' | 'contentType'>;

/** The checks the server repeats, so a wrong file is refused before anything is sent. */
export function dneskaiAudioFileProblem(file: { type: string; size: number } | null): 'fileMissing' | 'fileType' | 'fileSize' | null {
  if (!file) return 'fileMissing';
  if (!Object.hasOwn(DNESKAI_AUDIO_TYPES, file.type)) return 'fileType';
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > DNESKAI_AUDIO_MAX_BYTES) return 'fileSize';
  return null;
}

/** Retains one original owner/file/metadata identity in memory, never a signed token. */
export function createDneskaiAudioUploadSession(scope: {
    ownerId: string;
    signal: AbortSignal;
}, file: File, fields: DneskaiAudioUpload) {
    let ownerId: string, uploadId: string, captured: DneskaiAudioCreate;
    try {
        ownerId = z.uuid().parse(scope.ownerId);
        if (dneskaiAudioFileProblem(file))
            throw new Error();
        uploadId = crypto.randomUUID();
        captured = DneskaiAudioCreateSchema.parse({ ...fields, action: 'create', uploadId, contentType: file.type });
        if (new TextEncoder().encode(JSON.stringify({ ...captured, ownerId })).byteLength > MAX_POST_BYTES)
            throw new Error();
    }
    catch {
        throw new DneskaiAudioRequestError('invalid-request', 0);
    }
    const originalSignal = scope.signal;
    const contentType = captured.contentType;
    let fileMayExist = false, running = false;
    const confirm = async (signal: AbortSignal) => {
        const reply = z.strictObject({ ownerId: z.uuid(), track: DneskaiAudioTrackSchema }).parse(await post({ ...captured, ownerId }, signal));
        signal.throwIfAborted();
        const track = reply.track, moods = [...new Set(captured.mood)];
        if (reply.ownerId !== ownerId || track.id !== uploadId || track.title !== captured.title || track.artist !== captured.artist || track.source !== captured.source
            || track.sourceUrl !== captured.sourceUrl || track.licenceNote !== captured.licenceNote || track.mood.length !== moods.length || track.mood.some((tag, index) => tag !== moods[index]))
            throw new DneskaiAudioRequestError('decision-failed', 0);
        return track;
    };
    return Object.freeze({ ownerId, uploadId, async run(parent?: AbortSignal): Promise<DneskaiAudioTrack> {
            if (running)
                throw new DneskaiAudioRequestError('decision-failed', 0);
            running = true;
            const caller = AbortSignal.any([originalSignal, ...(parent ? [parent] : [])]);
            const signal = budget(55000, caller);
            try {
                signal.throwIfAborted();
                if (fileMayExist) {
                    try {
                        return await confirm(signal);
                    }
                    catch (error) {
                        signal.throwIfAborted();
                        if (!(error instanceof DneskaiAudioRequestError) || error.code !== 'audio-upload-missing')
                            throw error;
                    }
                }
                const prepared = DneskaiAudioPreparedSchema.parse(await post({ action: 'prepare', ownerId, uploadId, contentType, bytes: file.size }, signal));
                if (prepared.ownerId !== ownerId || prepared.uploadId !== uploadId || prepared.path !== `${ownerId}/${uploadId}.${DNESKAI_AUDIO_TYPES[contentType]}`)
                    throw new DneskaiAudioRequestError('decision-failed', 0);
                signal.throwIfAborted();
                fileMayExist = true;
                const { error } = await awaitWithSignal(createSignedStorageClient(signal).from('marketing-audio').uploadToSignedUrl(prepared.path, prepared.token, file, { contentType, upsert: false }), signal);
                signal.throwIfAborted();
                if (error)
                    throw new DneskaiAudioRequestError('decision-failed', 0);
                return await confirm(signal);
            }
            catch (error) {
                failed(error, caller);
            }
            finally {
                running = false;
            }
        } });
}

/** Shared first-page read for the format switch, picker and library; later pages are explicit owner actions. */
const AudioContinuationSchema = z.strictObject({offset:z.number().int().min(1).max(1_000_000),after:DneskaiAudioCursorSchema});
type AudioPageParam = number | z.infer<typeof AudioContinuationSchema>;
const audioLibraryQuery = (preview: boolean) => ({queryKey: [...qk.dneskaiAudio, preview, 'pages'], initialPageParam: 0 as AudioPageParam, retry: false as const, staleTime: 30000,
  queryFn: ({signal, pageParam}: {signal: AbortSignal; pageParam: AudioPageParam}) => typeof pageParam === 'number' ? loadDneskaiAudioOptions(preview, signal, pageParam) : loadDneskaiAudioOptions(preview, signal, pageParam.offset, undefined, pageParam.after),
  getNextPageParam: (last: Awaited<ReturnType<typeof loadDneskaiAudioOptions>>): AudioPageParam | undefined => last?.nextOffset != null && last.nextCursor ? {offset: last.nextOffset, after: last.nextCursor} : undefined});
export function useDneskaiAudioLibrary(preview: boolean, enabled = true) {
  const query = useInfiniteQuery({...audioLibraryQuery(preview), enabled});
  const client = useQueryClient();
  const pages = query.data?.pages;
  const params = query.data?.pageParams;
  const normalized = useMemo(() => {
    if (!pages) return {data: undefined, pageProblem: false};
    if (pages[0] === null && pages.length === 1) return {data: null, pageProblem: false};
    const tracks: DneskaiAudioTrack[] = [], ids = new Set<string>();
    let previous: {id: string; version: bigint} | undefined, pageProblem = false;
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      const param = params?.[index], before = pages[index - 1];
      if (!page || (index === 0 && param !== 0)) {pageProblem = true; break;}
      if (index > 0) {
        const continuation = AudioContinuationSchema.safeParse(param);
        if (!continuation.success || !before?.nextCursor || before.nextOffset !== continuation.data.offset || before.nextCursor.id !== continuation.data.after.id || databaseVersion(before.nextCursor.createdAt) !== databaseVersion(continuation.data.after.createdAt)) {pageProblem = true; break;}
      }
      // Admit an entire page before adding any row. Repeated ids or a shifted
      // order must not replace an already loaded track or duplicate a choice.
      const pageIds = new Set<string>();
      let end = previous;
      for (const track of page.tracks) {
        const version = databaseVersion(track.createdAt);
        if (version === null || ids.has(track.id) || pageIds.has(track.id) || (end && (version < end.version || (version === end.version && track.id <= end.id)))) {pageProblem = true; break;}
        pageIds.add(track.id); end = {id: track.id, version};
      }
      if (pageProblem) break;
      tracks.push(...page.tracks); for (const id of pageIds) ids.add(id); previous = end;
    }
    return {data: {tracks, trends: pages[0]?.trends ?? [], trendsStatus: pages[0]?.trendsStatus}, pageProblem};
  }, [pages, params]);
  const reloadLibrary = useCallback(async () => {
    const queryKey = [...qk.dneskaiAudio, preview, 'pages'];
    await client.cancelQueries({queryKey, exact: true});
    // Keep confirmed rows, the warning and the mounted upload draft while
    // replacing the invalid continuation with one explicit first-page read.
    try {await client.fetchInfiniteQuery({...audioLibraryQuery(preview), pages: 1, staleTime: 0});return true;}
    catch { return false; }
  }, [client, preview]);
  const pageProblem = normalized.pageProblem || (query.error instanceof DneskaiAudioRequestError && query.error.code === 'audio-page-unavailable');
  return {...query, ...normalized, pageProblem, hasNextPage: !pageProblem && query.hasNextPage, reloadLibrary};
}
