'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Music } from 'lucide-react';
import { qk } from '@/lib/queries/keys';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { loadDneskaiAudioLibrary } from '@/lib/marketing/dneskai-audio-client';
import type { DneskaiAudioTrack } from '@/lib/marketing/dneskai-audio-contracts';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';

/** How long after publishing Příspěvky suggests adding music in the app (#168). */
export const DNESKAI_MUSIC_HINT_DAYS = 7;

/** A carousel published in the last seven days: Instagram's API cannot add music to it, the app can (plan C6). */
export function dneskaiMusicHintDue(post: Pick<DneskaiWorkspacePost, 'format' | 'publication'>, now: Date): boolean {
  const at = post.publication?.status === 'published' ? Date.parse(post.publication.publishedAt ?? '') : Number.NaN;
  return post.format === 'carousel' && Number.isFinite(at) && at <= now.getTime() && now.getTime() - at <= DNESKAI_MUSIC_HINT_DAYS * 86_400_000;
}

/** A different enabled library track per post, so consecutive posts are not offered the same one. */
export function dneskaiMusicHintTrack(tracks: readonly DneskaiAudioTrack[], position: number): DneskaiAudioTrack | null {
  const usable = tracks.filter((track) => track.enabled && track.source !== 'instagram-library');
  return usable.length ? usable[Math.abs(position) % usable.length]! : null;
}

/**
 * The manual music fallback while @dneskai is on Instagram Login (#168, plan C6): a badge with a copyable track name
 * from the library and how to add it in the app. Shown only while Reels are switched on (the library answers).
 */
export function DneskaiMusicHint({ post, position, preview, lang, now = new Date() }: { post: DneskaiWorkspacePost; position: number; preview: boolean; lang: 'en' | 'cs'; now?: Date }) {
  const t = dneskaiAudio[lang].hint;
  const query = useQuery({ queryKey: [...qk.dneskaiAudio, preview], retry: false, staleTime: 30000, queryFn: ({ signal }) => loadDneskaiAudioLibrary(preview, signal) });
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null);
  if (!query.data || !dneskaiMusicHintDue(post, now)) return null;
  const track = dneskaiMusicHintTrack(query.data, position);
  const name = track ? `${track.title} – ${track.artist}` : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(name!); setCopied('done'); } catch { setCopied('failed'); }
  };
  return <div className="min-w-0 space-y-1 rounded-md border border-border p-2 text-xs" data-testid="dneskai-music-hint">
    <p className="inline-flex items-center gap-1 font-medium text-foreground"><Music aria-hidden className="size-3.5" />{t.badge}</p>
    <p className="text-foreground-muted">{t.help}</p>
    {name && <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-foreground-muted">{t.track}:</span><span className="min-w-0 break-words font-medium text-foreground">{name}</span>
      <button type="button" className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-2 md:min-h-8" aria-label={t.copy(name)} onClick={() => void copy()}>
        <Copy aria-hidden className="size-3.5" />{copied === 'done' ? t.copied : null}
      </button>
      <span role="status" className="sr-only">{copied === 'done' ? t.copied : ''}</span>
      {copied === 'failed' && <span role="alert" className="text-risk">{t.copyFailed}</span>}
    </div>}
  </div>;
}
