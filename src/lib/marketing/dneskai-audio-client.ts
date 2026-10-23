'use client';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import {
  DNESKAI_AUDIO_MAX_BYTES, DNESKAI_AUDIO_TYPES, DneskaiAudioLibrarySchema, DneskaiAudioPreparedSchema, DneskaiAudioTrackSchema,
  type DneskaiAudioCreate, type DneskaiAudioTrack, type DneskaiAudioTrend, type DneskaiAudioType,
} from './dneskai-audio-contracts';

/** The browser side of the audio library (#164): `/api/marketing/dneskai/audio` and the signed upload into `marketing-audio`. */
export class DneskaiAudioRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'DneskaiAudioRequestError'; }
}

const URL_PATH = '/api/marketing/dneskai/audio';
const codeShape = /^[a-z][a-z0-9-]{0,79}$/;
async function failure(response: Response) {
  let code = 'decision-failed';
  try { const body = await response.json() as { error?: unknown }; if (typeof body.error === 'string' && codeShape.test(body.error)) code = body.error; } catch { /* generic */ }
  return new DneskaiAudioRequestError(response.status === 429 ? 'rate-limited' : code, response.status);
}
async function post(body: unknown): Promise<unknown> {
  let response: Response;
  try { response = await fetch(URL_PATH, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new DneskaiAudioRequestError('decision-failed', 0); }
  if (!response.ok) throw await failure(response);
  return response.json();
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
export async function loadDneskaiAudioOptions(preview: boolean, signal?: AbortSignal): Promise<{ tracks: DneskaiAudioTrack[]; trends: DneskaiAudioTrend[] } | null> {
  if (preview) return { tracks: DEMO_DNESKAI_AUDIO_TRACKS, trends: [] };
  const response = await fetch(URL_PATH, { cache: 'no-store', signal });
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(response);
  const parsed = DneskaiAudioLibrarySchema.parse(await response.json());
  return { tracks: parsed.tracks, trends: parsed.trends ?? [] };
}

export async function setDneskaiAudioTrackEnabled(id: string, enabled: boolean): Promise<void> {
  await post({ action: 'toggle', id, enabled });
}

export type DneskaiAudioUpload = Omit<DneskaiAudioCreate, 'action' | 'uploadId' | 'contentType'>;

/** The checks the server repeats, so a wrong file is refused before anything is sent. */
export function dneskaiAudioFileProblem(file: { type: string; size: number } | null): 'fileMissing' | 'fileType' | 'fileSize' | null {
  if (!file) return 'fileMissing';
  if (!(file.type in DNESKAI_AUDIO_TYPES)) return 'fileType';
  if (!file.size || file.size > DNESKAI_AUDIO_MAX_BYTES) return 'fileSize';
  return null;
}

/** Prepare a signed path, upload the file straight to storage, then let the server check it and record the track. */
export async function uploadDneskaiAudioTrack(file: File, fields: DneskaiAudioUpload): Promise<DneskaiAudioTrack> {
  const contentType = file.type as DneskaiAudioType;
  const prepared = DneskaiAudioPreparedSchema.parse(await post({ action: 'prepare', contentType, bytes: file.size }));
  const { error } = await createClient().storage.from('marketing-audio').uploadToSignedUrl(prepared.path, prepared.token, file, { contentType });
  if (error) throw new DneskaiAudioRequestError('audio-upload-missing', 0);
  const created = z.strictObject({ track: DneskaiAudioTrackSchema }).parse(await post({ action: 'create', uploadId: prepared.uploadId, contentType, ...fields }));
  return created.track;
}
