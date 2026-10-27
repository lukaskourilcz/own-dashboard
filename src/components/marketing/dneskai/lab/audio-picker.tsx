'use client';

import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queries/keys';
import { Button } from '@/components/ui/button';
import { useId } from 'react';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { dneskaiAudioClock, type DneskaiAudioTrack } from '@/lib/marketing/dneskai-audio-contracts';
import { useDneskaiAudioLibrary, loadDneskaiAudioOptions, DneskaiAudioRequestError } from '@/lib/marketing/dneskai-audio-client';
import { DneskaiAudioPlayButton, useDneskaiAudioPreview } from '../audio-preview';
import { DneskaiAudioTrendsNotice, DneskaiAudioReadNotice } from '../audio-trends-notice';

type Props = { value: string | null; onChange: (trackId: string | null) => void; preview: boolean; disabled?: boolean; lang: 'en' | 'cs' };

/**
 * The post card's Reel music (#164): a track from the library or the rotation. The choice is part of the revision and
 * its hash, so approval binds it. Hidden while Reels are switched off. A track switched off after it was chosen stays
 * listed for this post, so the saved choice is never silently replaced.
 */
export function DneskaiAudioPicker({ value, onChange, preview, disabled = false, lang }: Props) {
  const t = dneskaiAudio[lang];
  const id = useId();
  const query = useDneskaiAudioLibrary(preview);
  const missing = !!value && !value.startsWith('ig:') && !!query.data && !query.data.tracks.some(track => track.id === value);
  const selected = useQuery({ queryKey: [...qk.dneskaiAudio, preview, 'selected', value], enabled: missing && !preview, retry: false, staleTime: 30000,
    queryFn: ({ signal }) => loadDneskaiAudioOptions(preview, signal, 0, value!) });
  const player = useDneskaiAudioPreview();
  if (!query.data) return null;
  // Only sounds with current Meta trend/search proof can be attached; niche-only sounds show in Zdroje → Hudba as hints (#167).
  const trends = query.data.trendsStatus === 'ready' ? query.data.trends.filter((trend) => trend.attachable) : [];
  const tracks = [...query.data.tracks, ...(missing ? selected.data?.tracks ?? [] : [])].filter((track) => track.source !== 'instagram-library' && (track.enabled || track.id === value));
  const chosen: DneskaiAudioTrack | null = tracks.find((track) => track.id === value) ?? null;
  const describe = (track: DneskaiAudioTrack) => `${track.title} · ${track.artist} · ${dneskaiAudioClock(track.durationMs)}`;
  return <div className="min-w-0 space-y-1" data-testid="dneskai-audio-picker">
    <label htmlFor={`${id}-audio`} className="text-xs font-medium">{t.picker.label}</label>
    <div className="flex min-w-0 items-center gap-2">
      <select id={`${id}-audio`} value={value ?? ''} disabled={disabled || !(tracks.length || trends.length || value)} aria-describedby={`${id}-audio-help`}
        onChange={(event) => onChange(event.target.value || null)} className="min-h-11 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-sm focus-ring">
        <option value="">{t.picker.rotation(null)}</option>
        {value && !tracks.some(track => track.id === value) && !trends.some(trend => `ig:${trend.audioId}` === value) && <option value={value}>{t.selectedMissing}</option>}
        {trends.length > 0 && <optgroup label={t.trends.title}>{trends.map((trend) => <option key={trend.audioId} value={`ig:${trend.audioId}`}>{[trend.title, trend.artist, trend.durationMs ? dneskaiAudioClock(trend.durationMs) : null].filter(Boolean).join(' · ')}</option>)}</optgroup>}
        {trends.length > 0 ? <optgroup label={t.title}>{tracks.map((track) => <option key={track.id} value={track.id}>{describe(track)}</option>)}</optgroup>
          : tracks.map((track) => <option key={track.id} value={track.id}>{describe(track)}</option>)}
      </select>
      {chosen && <DneskaiAudioPlayButton track={chosen} playing={player.playing === chosen.id} pending={player.starting === chosen.id} failed={player.error === chosen.id} disabled={query.isRefetching || selected.isFetching} onToggle={player.toggle} lang={lang} />}
    </div>
    {query.pageProblem && <DneskaiAudioReadNotice message={t.pagesUnavailable} retryLabel={t.retry} pending={query.isFetching} onRetry={() => void query.reloadLibrary()} />}
    {query.isRefetchError && !query.pageProblem && <DneskaiAudioReadNotice message={query.error instanceof DneskaiAudioRequestError && query.error.code === 'unauthorized' ? t.errors.unauthorized : t.refreshUnavailable} retryLabel={t.retry} pending={query.isFetching} onRetry={() => void query.refetch()} />}
    {missing && selected.isFetching && !selected.data && !selected.isError && <p role="status" className="text-xs text-foreground-muted">{t.selectedLoading}</p>}
    {missing && (selected.isError || selected.data === null) && <DneskaiAudioReadNotice message={selected.error instanceof DneskaiAudioRequestError && selected.error.code === 'unauthorized' ? t.errors.unauthorized : t.selectedUnavailable} retryLabel={t.selectedRetry} pending={selected.isFetching} onRetry={() => void selected.refetch()} testId="dneskai-audio-selected-notice" />}
    {!query.isRefetchError && !query.pageProblem && <DneskaiAudioTrendsNotice status={query.data.trendsStatus} lang={lang} pending={disabled || query.isFetching} onRetry={() => void query.refetch()} />}
    {query.isRefetching && <p role="status" className="text-xs text-foreground-muted">{t.loading}</p>}
    {player.error && <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-xs text-risk">{t.previewFailed}</p><Button variant="outline" size="sm" disabled={query.isFetching || selected.isFetching} onClick={() => { player.stop(); void query.refetch(); if (missing) void selected.refetch(); }}>{t.refreshPreview}</Button></div>}
    {query.hasNextPage && <Button variant="outline" size="sm" disabled={disabled || query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? t.loading : t.loadMore}</Button>}
    <p id={`${id}-audio-help`} className="text-xs text-foreground-muted">{tracks.length || trends.length || query.pageProblem ? t.picker.help : t.picker.none}{value?.startsWith('ig:') ? ` ${t.trends.attached}` : ''}</p>
  </div>;
}
