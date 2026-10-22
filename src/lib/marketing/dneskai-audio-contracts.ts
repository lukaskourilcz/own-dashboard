import { z } from 'zod';

/**
 * The DNESKAi audio library (#164) as the browser sees it: Zdroje → Hudba and the Lab's audio picker. Browser-safe.
 * Server code is in `dneskai-audio.ts`, the table in migration 20261023130100.
 */
export const DNESKAI_AUDIO_SOURCES = ['meta-sound-collection', 'pixabay', 'original', 'instagram-library'] as const;
export const DneskaiAudioSourceSchema = z.enum(DNESKAI_AUDIO_SOURCES);
export type DneskaiAudioSource = z.infer<typeof DneskaiAudioSourceSchema>;
/** The sources the owner uploads a file for. Instagram library tracks arrive with the trending-audio work (C5). */
export const DNESKAI_AUDIO_UPLOAD_SOURCES = ['meta-sound-collection', 'pixabay', 'original'] as const satisfies readonly DneskaiAudioSource[];

/** File types the bucket takes, with the extension the stored object gets. */
export const DNESKAI_AUDIO_TYPES = {
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg',
} as const;
export type DneskaiAudioType = keyof typeof DNESKAI_AUDIO_TYPES;
export const DNESKAI_AUDIO_MAX_BYTES = 20 * 1024 * 1024;
/** The Lab and Zdroje play this much of a track as a preview. */
export const DNESKAI_AUDIO_PREVIEW_SECONDS = 10;

const text = (max: number) => z.string().trim().min(1).max(max);
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
const mood = z.array(z.string().trim().toLowerCase().min(1).max(30).regex(/^[\p{L}\p{N} -]+$/u)).max(5);

export const DneskaiAudioTrackSchema = z.strictObject({
  id: z.uuid(),
  title: text(120),
  artist: text(120),
  source: DneskaiAudioSourceSchema,
  licenceNote: text(500),
  sourceUrl: httpsUrl.nullable(),
  durationMs: z.number().int().min(1000).max(900000),
  mood,
  enabled: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  /** A signed URL valid for an hour, for the preview player; null for an Instagram library track. */
  previewUrl: httpsUrl.nullable(),
});
export type DneskaiAudioTrack = z.infer<typeof DneskaiAudioTrackSchema>;
export const DneskaiAudioLibrarySchema = z.strictObject({ tracks: z.array(DneskaiAudioTrackSchema).max(200) });
export type DneskaiAudioLibrary = z.infer<typeof DneskaiAudioLibrarySchema>;

export const DneskaiAudioPrepareSchema = z.strictObject({
  action: z.literal('prepare'),
  contentType: z.enum(Object.keys(DNESKAI_AUDIO_TYPES) as [DneskaiAudioType, ...DneskaiAudioType[]]),
  bytes: z.number().int().min(1).max(DNESKAI_AUDIO_MAX_BYTES),
});
export const DneskaiAudioPreparedSchema = z.strictObject({ uploadId: z.uuid(), path: z.string().min(1).max(300), token: z.string().min(1).max(4000) });
export type DneskaiAudioPrepared = z.infer<typeof DneskaiAudioPreparedSchema>;

export const DneskaiAudioCreateSchema = z.strictObject({
  action: z.literal('create'),
  uploadId: z.uuid(),
  contentType: DneskaiAudioPrepareSchema.shape.contentType,
  title: text(120),
  artist: text(120),
  source: z.enum(DNESKAI_AUDIO_UPLOAD_SOURCES),
  licenceNote: text(500),
  sourceUrl: httpsUrl,
  mood,
});
export type DneskaiAudioCreate = z.infer<typeof DneskaiAudioCreateSchema>;
export const DneskaiAudioToggleSchema = z.strictObject({ action: z.literal('toggle'), id: z.uuid(), enabled: z.boolean() });
export const DneskaiAudioRequestSchema = z.discriminatedUnion('action', [DneskaiAudioPrepareSchema, DneskaiAudioCreateSchema, DneskaiAudioToggleSchema]);
export type DneskaiAudioRequest = z.infer<typeof DneskaiAudioRequestSchema>;

/**
 * The track that follows `previous` among the enabled tracks in library order (oldest first), so two consecutive
 * posts never share a track while there are two or more. No previous track, or one no longer enabled: the first.
 */
export function nextDneskaiAudioTrack<T extends { id: string; enabled: boolean }>(tracks: readonly T[], previousId: string | null): T | null {
  const enabled = tracks.filter((track) => track.enabled);
  if (!enabled.length) return null;
  const at = previousId ? enabled.findIndex((track) => track.id === previousId) : -1;
  return enabled[(at + 1) % enabled.length]!;
}

/** `m:ss` for a duration in milliseconds. */
export function dneskaiAudioClock(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
