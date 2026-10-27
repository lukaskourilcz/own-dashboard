'use client';

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queries/keys';
import { z } from 'zod';
import { createSignedStorageClient } from '@/lib/supabase/client';
import { awaitWithSignal } from '@/lib/abortable';
import { readTextPrefix } from '@/lib/bounded-text';
import { databaseVersion } from '@/lib/database-version';
import {
  DNESKAI_AUDIO_MAX_BYTES, DNESKAI_AUDIO_TYPES, DneskaiAudioCreateSchema, DneskaiAudioLibrarySchema, DneskaiAudioPreparedSchema, DneskaiAudioTrackSchema,
  type DneskaiAudioCreate, type DneskaiAudioTrack, type DneskaiAudioTrend, type DneskaiAudioType, type DneskaiAudioTrendsStatus,
} from './dneskai-audio-contracts';

/** Only known codes leave the request boundary; upstream text never enters a dictionary. */
const refusalCode = z.enum(['decision-failed', 'audio-library-unavailable', 'audio-upload-missing', 'audio-upload-invalid', 'audio-track-unavailable', 'audio-track-write-failed', 'rate-limited', 'invalid-request', 'unauthorized', 'not-found']);
export class DneskaiAudioRequestError extends Error {
  constructor(readonly code: z.infer<typeof refusalCode>, readonly status: number) { super(code); this.name = 'DneskaiAudioRequestError'; }
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
async function post(body: unknown, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const encoded = JSON.stringify(body);
  if (new TextEncoder().encode(encoded).byteLength > MAX_POST_BYTES) throw new DneskaiAudioRequestError('invalid-request', 0);
  const response = await awaitWithSignal(fetch(URL_PATH, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: encoded, signal }), signal);
  if (!response.ok) throw await failure(response, signal);
  return json(response, 16_384, signal);
}

/** Two sample tracks for `/dev-preview`; no file behind them, so nothing plays. */
export const DEMO_DNESKAI_AUDIO_TRACKS: DneskaiAudioTrack[] = [
  { id: '0f6b5c1e-3d2a-4c8b-9e7f-1a2b3c4d5e01', title: 'Quiet Circuit', artist: 'Sample artist', source: 'pixabay', licenceNote: 'Pixabay Content License (sample)', sourceUrl: 'https://pixabay.com/music/', durationMs: 72_000, mood: ['calm', 'tech'], enabled: true, createdAt: '2026-10-23T08:00:00.000Z', previewUrl: null },
  { id: '0f6b5c1e-3d2a-4c8b-9e7f-1a2b3c4d5e02', title: 'Morning Signal', artist: 'Sample artist', source: 'meta-sound-collection', licenceNote: 'Meta Sound Collection, cleared for Instagram (sample)', sourceUrl: 'https://www.facebook.com/sound/collection/', durationMs: 45_000, mood: ['upbeat'], enabled: false, createdAt: '2026-10-23T08:05:00.000Z', previewUrl: null },
];

/**
 * The owner's library, or null while Reels are switched off (the route answers 404), so the screens stay hidden.
 * In the preview, the sample tracks.
 */
export async function loadDneskaiAudioLibrary(preview: boolean, signal?: AbortSignal): Promise<DneskaiAudioTrack[] | null> {
  return (await loadDneskaiAudioOptions(preview, signal))?.tracks ?? null;
}

/** The library and, while their switch is on, today's trending sounds (#167). Null while Reels are off. */
export async function loadDneskaiAudioOptions(preview: boolean, parent?: AbortSignal, offset = 0, trackId?: string): Promise<{ tracks: DneskaiAudioTrack[]; trends: DneskaiAudioTrend[]; trendsStatus?: DneskaiAudioTrendsStatus; nextOffset?: number | null } | null> {
  if (preview) return { tracks: DEMO_DNESKAI_AUDIO_TRACKS, trends: [], trendsStatus: 'disabled' };
  const signal = budget(20_000, parent);
  try {
    z.number().int().min(0).max(1_000_000).parse(offset);
    if (trackId !== undefined) { z.uuid().parse(trackId); if (offset !== 0) throw new Error('invalid-selector'); }
    signal.throwIfAborted();
    const params = new URLSearchParams();
    if (offset) params.set('offset', String(offset));
    if (trackId) params.set('trackId', trackId);
    const response = await awaitWithSignal(fetch(`${URL_PATH}${params.size ? `?${params}` : ''}`, { cache: 'no-store', signal }), signal);
    if (!response.ok) { const refused = await failure(response, signal); if (response.status === 404 && refused.code === 'not-found' && offset === 0) return null; throw refused; }
    const parsed = DneskaiAudioLibrarySchema.parse(await json(response, 2_097_152, signal));
    if (new Set(parsed.tracks.map(track => track.id)).size !== parsed.tracks.length || new Set(parsed.trends?.map(trend => trend.audioId) ?? []).size !== (parsed.trends?.length ?? 0)
      || (trackId && (parsed.tracks.length > 1 || parsed.tracks.some(track => track.id !== trackId) || parsed.nextOffset != null))
      || (parsed.nextOffset != null && (!parsed.tracks.length || parsed.nextOffset !== offset + parsed.tracks.length))) throw new Error('invalid-page');
    return { tracks: parsed.tracks, trends: parsed.trends ?? [], ...(parsed.trendsStatus ? {trendsStatus: parsed.trendsStatus} : {}), nextOffset: parsed.nextOffset ?? null };
  } catch (error) { failed(error, parent); }
}

/** Validate the legacy acknowledgement; captured toggle receipts are the next server phase. */
export async function setDneskaiAudioTrackEnabled(id: string, enabled: boolean, parent?: AbortSignal): Promise<void> {
  const signal = budget(20_000, parent);
  try { z.uuid().parse(id); z.boolean().parse(enabled); z.strictObject({ ok: z.literal(true) }).parse(await post({ action: 'toggle', id, enabled }, signal)); }
  catch (error) { failed(error, parent); }
}

export type DneskaiAudioUpload = Omit<DneskaiAudioCreate, 'action' | 'uploadId' | 'contentType'>;

/** The checks the server repeats, so a wrong file is refused before anything is sent. */
export function dneskaiAudioFileProblem(file: { type: string; size: number } | null): 'fileMissing' | 'fileType' | 'fileSize' | null {
  if (!file) return 'fileMissing';
  if (!Object.hasOwn(DNESKAI_AUDIO_TYPES, file.type)) return 'fileType';
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > DNESKAI_AUDIO_MAX_BYTES) return 'fileSize';
  return null;
}

/** Prepare a signed path, upload the file straight to storage, then let the server check it and record the track. */
export async function uploadDneskaiAudioTrack(file: File, fields: DneskaiAudioUpload, parent?: AbortSignal): Promise<DneskaiAudioTrack> {
  const signal = budget(55_000, parent);
  try {
    if (dneskaiAudioFileProblem(file)) throw new DneskaiAudioRequestError('invalid-request', 0);
    const contentType = file.type as DneskaiAudioType;
    const parsed = DneskaiAudioCreateSchema.omit({ action: true, uploadId: true, contentType: true }).safeParse(fields);
    if (!parsed.success) throw new DneskaiAudioRequestError('invalid-request', 0);
    const captured = parsed.data;
    // The prepared UUID adds exactly 36 ASCII bytes; reject oversized metadata before preparing or uploading a file.
    if (new TextEncoder().encode(JSON.stringify({ action: 'create', uploadId: '', contentType, ...captured })).byteLength + 36 > MAX_POST_BYTES) throw new DneskaiAudioRequestError('invalid-request', 0);
    const prepared = DneskaiAudioPreparedSchema.parse(await post({ action: 'prepare', contentType, bytes: file.size }, signal));
    const parts = prepared.path.split('/');
    if (parts.length !== 2 || !z.uuid().safeParse(parts[0]).success || parts[1] !== `${prepared.uploadId}.${DNESKAI_AUDIO_TYPES[contentType]}`) throw new DneskaiAudioRequestError('decision-failed', 0);
    signal.throwIfAborted();
    const { error } = await awaitWithSignal(createSignedStorageClient(signal).from('marketing-audio').uploadToSignedUrl(prepared.path, prepared.token, file, { contentType, upsert: false }), signal);
    if (error) throw new DneskaiAudioRequestError('decision-failed', 0);
    const track = z.strictObject({ track: DneskaiAudioTrackSchema }).parse(await post({ action: 'create', uploadId: prepared.uploadId, contentType, ...captured }, signal)).track;
    const moods = [...new Set(captured.mood)];
    if (track.id !== prepared.uploadId || track.title !== captured.title || track.artist !== captured.artist || track.source !== captured.source
      || track.sourceUrl !== captured.sourceUrl || track.licenceNote !== captured.licenceNote || track.mood.length !== moods.length || track.mood.some((tag, index) => tag !== moods[index])) throw new DneskaiAudioRequestError('decision-failed', 0);
    return track;
  } catch (error) { failed(error, parent); }
}


/** Shared first-page read for the format switch, picker and library; later pages are explicit owner actions. */
const audioLibraryQuery = (preview: boolean) => ({queryKey: [...qk.dneskaiAudio, preview, 'pages'], initialPageParam: 0, retry: false as const, staleTime: 30000,
  queryFn: ({signal, pageParam}: {signal: AbortSignal; pageParam: number}) => loadDneskaiAudioOptions(preview, signal, pageParam),
  getNextPageParam: (last: Awaited<ReturnType<typeof loadDneskaiAudioOptions>>) => last?.nextOffset ?? undefined});
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
      if (!page || (index === 0 ? params?.[index] !== 0 : pages[index - 1]?.nextOffset !== params?.[index])) {pageProblem = true; break;}
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
    try {await client.fetchInfiniteQuery({...audioLibraryQuery(preview), pages: 1, staleTime: 0});}
    catch { /* The query keeps the failed state and retained rows for recovery. */ }
  }, [client, preview]);
  return {...query, ...normalized, hasNextPage: !normalized.pageProblem && query.hasNextPage, reloadLibrary};
}
