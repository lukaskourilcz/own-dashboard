'use client';

import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queries/keys';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { dneskaiAudioClock, type DneskaiAudioTrack } from '@/lib/marketing/dneskai-audio-contracts';
import { loadDneskaiAudioLibrary } from '@/lib/marketing/dneskai-audio-client';
import { DneskaiAudioPlayButton, useDneskaiAudioPreview } from '../audio-preview';

type Props = { value: string | null; onChange: (trackId: string | null) => void; preview: boolean; disabled?: boolean; lang: 'en' | 'cs' };

/**
 * The post card's Reel music (#164): a track from the library or the rotation. The choice is part of the revision and
 * its hash, so approval binds it. Hidden while Reels are switched off. A track switched off after it was chosen stays
 * listed for this post, so the saved choice is never silently replaced.
 */
export function DneskaiAudioPicker({ value, onChange, preview, disabled = false, lang }: Props) {
  const t = dneskaiAudio[lang];
  const id = useId();
  const query = useQuery({ queryKey: [...qk.dneskaiAudio, preview], retry: false, staleTime: 30000, queryFn: ({ signal }) => loadDneskaiAudioLibrary(preview, signal) });
  const player = useDneskaiAudioPreview();
  if (!query.data) return null;
  const tracks = query.data.filter((track) => track.source !== 'instagram-library' && (track.enabled || track.id === value));
  const chosen: DneskaiAudioTrack | null = tracks.find((track) => track.id === value) ?? null;
  const describe = (track: DneskaiAudioTrack) => `${track.title} · ${track.artist} · ${dneskaiAudioClock(track.durationMs)}`;
  return <div className="min-w-0 space-y-1" data-testid="dneskai-audio-picker">
    <label htmlFor={`${id}-audio`} className="text-xs font-medium">{t.picker.label}</label>
    <div className="flex min-w-0 items-center gap-2">
      <select id={`${id}-audio`} value={value ?? ''} disabled={disabled || !tracks.length} aria-describedby={`${id}-audio-help`}
        onChange={(event) => onChange(event.target.value || null)} className="min-h-11 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-sm focus-ring">
        <option value="">{t.picker.rotation(null)}</option>
        {tracks.map((track) => <option key={track.id} value={track.id}>{describe(track)}</option>)}
      </select>
      {chosen && <DneskaiAudioPlayButton track={chosen} playing={player.playing === chosen.id} onToggle={player.toggle} lang={lang} />}
    </div>
    <p id={`${id}-audio-help`} className="text-xs text-foreground-muted">{tracks.length ? t.picker.help : t.picker.none}</p>
  </div>;
}
