'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { qk } from '@/lib/queries/keys';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { DNESKAI_AUDIO_TYPES, DNESKAI_AUDIO_UPLOAD_SOURCES, dneskaiAudioClock, type DneskaiAudioTrack } from '@/lib/marketing/dneskai-audio-contracts';
import { DneskaiAudioRequestError, dneskaiAudioFileProblem, loadDneskaiAudioLibrary, setDneskaiAudioTrackEnabled, uploadDneskaiAudioTrack } from '@/lib/marketing/dneskai-audio-client';
import { DneskaiAudioPlayButton, useDneskaiAudioPreview } from './dneskai/audio-preview';

type Lang = 'en' | 'cs';
type Props = { lang: Lang; preview?: boolean };

/**
 * Zdroje → Hudba (#164): the tracks a Reel may play, each with its source, licence note and source page, a switch
 * for the rotation and a 10-second preview, plus the upload form. Renders nothing while Reels are switched off.
 */
export function DneskaiAudioLibrary({ lang, preview = false }: Props) {
  const t = dneskaiAudio[lang];
  const query = useQuery({ queryKey: [...qk.dneskaiAudio, preview], retry: false, staleTime: 30000, queryFn: ({ signal }) => loadDneskaiAudioLibrary(preview, signal) });
  const player = useDneskaiAudioPreview();
  if (query.data === null) return null;
  return <section aria-labelledby="dneskai-audio-title" className="min-w-0 space-y-4" data-testid="dneskai-audio-library">
    <div className="min-w-0"><h2 id="dneskai-audio-title" className="text-sm font-semibold">{t.title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{t.intro}</p></div>
    {preview && <p role="status" className="text-sm text-foreground-muted">{t.preview}</p>}
    {query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : query.isError ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p>
        : <TrackList tracks={query.data} lang={lang} preview={preview} player={player} />}
    {!preview && query.isSuccess && <UploadForm lang={lang} />}
  </section>;
}

function TrackList({ tracks, lang, preview, player }: { tracks: DneskaiAudioTrack[]; lang: Lang; preview: boolean; player: ReturnType<typeof useDneskaiAudioPreview> }) {
  const t = dneskaiAudio[lang];
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setDneskaiAudioTrackEnabled(id, enabled),
    onMutate: () => setError(null),
    onError: (failure) => setError(failure instanceof DneskaiAudioRequestError ? t.errors[failure.code] ?? t.failed : t.failed),
    onSettled: () => client.invalidateQueries({ queryKey: qk.dneskaiAudio }),
  });
  if (!tracks.length) return <p className="border-t border-border pt-3 text-sm text-foreground-muted">{t.empty}</p>;
  return <>
    {error && <p role="alert" className="text-sm text-risk">{error}</p>}
    <ul aria-label={t.listLabel} className="divide-y divide-border border-y border-border">
      {tracks.map((track) => <li key={track.id} className="flex min-w-0 flex-wrap items-start gap-3 py-3" data-testid="dneskai-audio-track">
        <DneskaiAudioPlayButton track={track} playing={player.playing === track.id} onToggle={player.toggle} lang={lang} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="break-words text-sm font-medium">{track.title} <span className="font-normal text-foreground-muted">· {track.artist}</span></p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
            <span className="font-medium text-foreground">{track.enabled ? t.enabled : t.disabled}</span>
            <span>{t.sources[track.source]}</span>
            <span className="tabular" aria-label={`${t.duration} ${dneskaiAudioClock(track.durationMs)}`}>{dneskaiAudioClock(track.durationMs)}</span>
            {track.mood.length > 0 && <span>{t.mood}: {track.mood.join(', ')}</span>}
          </div>
          <p className="break-words text-xs text-foreground-muted">{t.licence}: {track.licenceNote}{track.sourceUrl && <> · <a href={track.sourceUrl} target="_blank" rel="noopener noreferrer" className="focus-ring rounded underline">{t.sourcePage}</a></>}</p>
        </div>
        <Switch checked={track.enabled} disabled={preview || toggle.isPending} aria-label={t.enable(track.title)} className="mt-3"
          onCheckedChange={(enabled) => toggle.mutate({ id: track.id, enabled })} />
      </li>)}
    </ul>
  </>;
}

const ACCEPT = Object.keys(DNESKAI_AUDIO_TYPES).join(',');

function UploadForm({ lang }: { lang: Lang }) {
  const t = dneskaiAudio[lang];
  const id = useId();
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState({ title: '', artist: '', source: 'pixabay' as (typeof DNESKAI_AUDIO_UPLOAD_SOURCES)[number], sourceUrl: '', licenceNote: '', mood: '' });
  const [message, setMessage] = useState<{ tone: 'success' | 'risk'; text: string } | null>(null);
  const upload = useMutation({
    mutationFn: (selected: File) => uploadDneskaiAudioTrack(selected, {
      title: fields.title.trim(), artist: fields.artist.trim(), source: fields.source, sourceUrl: fields.sourceUrl.trim(), licenceNote: fields.licenceNote.trim(),
      mood: fields.mood.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 5),
    }),
    onSuccess: (track) => {
      setMessage({ tone: 'success', text: t.upload.done(track.title) });
      setFile(null); setFields({ ...fields, title: '', artist: '', sourceUrl: '', mood: '' });
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (failure) => setMessage({ tone: 'risk', text: failure instanceof DneskaiAudioRequestError ? t.errors[failure.code] ?? t.failed : t.errors['invalid-request']! }),
    onSettled: () => client.invalidateQueries({ queryKey: qk.dneskaiAudio }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = dneskaiAudioFileProblem(file);
    if (problem) { setMessage({ tone: 'risk', text: t.upload[problem] }); return; }
    setMessage(null);
    upload.mutate(file!);
  };
  const field = (key: 'title' | 'artist' | 'sourceUrl' | 'licenceNote', label: string, options: { type?: string; max: number; placeholder?: string }) =>
    <div className="min-w-0"><label htmlFor={`${id}-${key}`} className="text-xs font-medium">{label}</label>
      <Input id={`${id}-${key}`} type={options.type ?? 'text'} required maxLength={options.max} placeholder={options.placeholder} value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} /></div>;
  return <form onSubmit={submit} className="min-w-0 space-y-3" aria-labelledby={`${id}-title`} data-testid="dneskai-audio-upload">
    <h3 id={`${id}-title`} className="text-sm font-medium">{t.upload.title}</h3>
    <div><label htmlFor={`${id}-file`} className="text-xs font-medium">{t.upload.file}</label>
      <input ref={fileRef} id={`${id}-file`} type="file" accept={ACCEPT} required className="focus-ring block min-h-11 w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:text-sm"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></div>
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      {field('title', t.upload.trackTitle, { max: 120 })}
      {field('artist', t.upload.artist, { max: 120 })}
      <div className="min-w-0"><label htmlFor={`${id}-source`} className="text-xs font-medium">{t.upload.source}</label>
        <select id={`${id}-source`} value={fields.source} onChange={(event) => setFields({ ...fields, source: event.target.value as typeof fields.source })} className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm focus-ring">
          {DNESKAI_AUDIO_UPLOAD_SOURCES.map((source) => <option key={source} value={source}>{t.sources[source]}</option>)}
        </select></div>
      {field('sourceUrl', t.upload.sourceUrl, { type: 'url', max: 2048, placeholder: 'https://' })}
      {field('licenceNote', t.upload.licenceNote, { max: 500, placeholder: t.upload.licencePlaceholder })}
      <div className="min-w-0"><label htmlFor={`${id}-mood`} className="text-xs font-medium">{t.upload.mood}</label>
        <Input id={`${id}-mood`} value={fields.mood} maxLength={160} onChange={(event) => setFields({ ...fields, mood: event.target.value })} /></div>
    </div>
    <div aria-live="polite">{message && <p role={message.tone === 'risk' ? 'alert' : 'status'} className={message.tone === 'risk' ? 'text-sm text-risk' : 'text-sm text-success'}>{message.text}</p>}</div>
    <Button type="submit" className="min-h-11" disabled={upload.isPending} aria-busy={upload.isPending}>{upload.isPending ? t.upload.uploading : t.upload.submit}</Button>
  </form>;
}
