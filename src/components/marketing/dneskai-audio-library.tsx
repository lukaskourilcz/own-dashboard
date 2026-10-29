'use client';

import { useId, useRef, useState, useLayoutEffect, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {useOwnerPreferences} from '@/lib/owner-preferences';
import {useUnsavedDraft, useGuardedNavigation} from '@/components/navigation-guard';
import {DneskaiAudioToggleSchema,type DneskaiAudioToggle} from '@/lib/marketing/dneskai-audio-contracts';
import { qk } from '@/lib/queries/keys';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { DNESKAI_AUDIO_TYPES, DNESKAI_AUDIO_UPLOAD_SOURCES, dneskaiAudioClock, type DneskaiAudioTrack, type DneskaiAudioTrend, type DneskaiAudioTrendsStatus } from '@/lib/marketing/dneskai-audio-contracts';
import Image from 'next/image';
import { DneskaiAudioRequestError, dneskaiAudioFileProblem, useDneskaiAudioLibrary, setDneskaiAudioTrackEnabled, applyDneskaiAudioToggleReceipt, createDneskaiAudioUploadSession } from '@/lib/marketing/dneskai-audio-client';
import { DneskaiAudioPlayButton, useDneskaiAudioPreview } from './dneskai/audio-preview';
import { DneskaiAudioTrendsNotice, DneskaiAudioReadNotice } from './dneskai/audio-trends-notice';

type Lang = 'en' | 'cs';
type Props = { lang: Lang; preview?: boolean; showDisabled?: boolean };

/**
 * Zdroje → Hudba (#164): the tracks a Reel may play, each with its source, licence note and source page, a switch
 * for the rotation and a 10-second preview, plus the upload form. Renders nothing while Reels are switched off.
 */
export function DneskaiAudioLibrary({ lang, preview = false, showDisabled = false }: Props) {
  const t = dneskaiAudio[lang];
  const query = useDneskaiAudioLibrary(preview);
  const player = useDneskaiAudioPreview();
  if (query.data === null) return showDisabled ? <p role="status" className="text-sm text-foreground-muted">{t.reelsOff}</p> : null;
  return <section aria-labelledby="dneskai-audio-title" className="min-w-0 space-y-4" data-testid="dneskai-audio-library">
    <div className="min-w-0"><h2 tabIndex={-1} id="dneskai-audio-title" className="text-sm font-semibold">{t.title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{t.intro}</p></div>
    {preview && <p role="status" className="text-sm text-foreground-muted">{t.preview}</p>}
    {query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : query.isError && !query.data ? <DneskaiAudioReadNotice message={t.unavailable} retryLabel={t.retry} pending={query.isFetching} onRetry={() => void query.refetch()} />
        : <>
          {query.pageProblem && <DneskaiAudioReadNotice message={t.pagesUnavailable} retryLabel={t.retry} pending={query.isFetching} onRetry={() => void query.reloadLibrary()} />}
          {query.isRefetchError && !query.pageProblem && <DneskaiAudioReadNotice message={query.error instanceof DneskaiAudioRequestError && query.error.code === 'unauthorized' ? t.errors.unauthorized : t.refreshUnavailable} retryLabel={t.retry} pending={query.isFetching} onRetry={() => void query.refetch()} />}
          {(!query.pageProblem || !!query.data?.tracks.length) && <TrackList tracks={query.data?.tracks ?? []} lang={lang} preview={preview} player={player} previewRefreshing={query.isFetching} readFailed={query.pageProblem || query.isError} onReload={query.reloadLibrary} />}
          {((!query.isRefetchError && !query.pageProblem) || query.data?.trendsStatus === 'ready') && <TrendList trends={query.data?.trends ?? []} status={query.data?.trendsStatus} lang={lang} pending={query.isFetching} onRetry={() => void query.refetch()} />}
        </>}
    {query.isRefetching && <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>}
    {player.error && <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-risk">{t.previewFailed}</p><Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => { player.stop(); void query.refetch(); }}>{t.refreshPreview}</Button></div>}
    {query.hasNextPage && <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? t.loading : t.loadMore}</Button>}
    {!preview && query.data && <AudioUploadDialog lang={lang} />}
  </section>;
}

function TrackList({ tracks, lang, preview, player, previewRefreshing, readFailed, onReload }: {
    tracks: DneskaiAudioTrack[];
    lang: Lang;
    preview: boolean;
    player: ReturnType<typeof useDneskaiAudioPreview>;
    previewRefreshing: boolean;
    readFailed: boolean;
    onReload: () => Promise<boolean>;
}) {
    const t = dneskaiAudio[lang], client = useQueryClient(), owner = useOwnerPreferences();
    const lifetime = useRef(new AbortController()), reservations = useRef(new Map<string, AbortSignal>()), switches = useRef(new Map<string, HTMLButtonElement>()), blocked = useRef(new Set<string>()), recoveryFocus = useRef<{
        id: string;
        signal: AbortSignal;
    } | null>(null);
    const [pending, setPending] = useState<ReadonlySet<string>>(new Set()), [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
    useLayoutEffect(() => {
        if (lifetime.current.signal.aborted)
            lifetime.current = new AbortController();
        return () => lifetime.current.abort();
    }, []);
    useLayoutEffect(() => {
        const target = recoveryFocus.current;
        if (!target || pending.has(target.id) || previewRefreshing || readFailed)
            return;
        recoveryFocus.current = null;
        if (target.signal.aborted)
            return;
        const element = switches.current.get(target.id);
        if (element?.isConnected)
            element.focus();
        else
            document.getElementById('dneskai-audio-title')?.focus();
    }, [pending, previewRefreshing, readFailed, tracks]);
    useUnsavedDraft({ get dirty() {
            return false;
        }, get pending() {
            return reservations.current.size > 0;
        }, canSave: false, save: async () => false, discard: () => {
        } });
    function reserve(id: string) {
        if (preview || reservations.current.has(id) || !owner)
            return null;
        const captured = owner.capture(), signal = AbortSignal.any([captured.signal, lifetime.current.signal]);
        if (signal.aborted)
            return null;
        reservations.current.set(id, signal);
        setPending(new Set(reservations.current.keys()));
        return { ownerId: captured.ownerId, signal };
    }
    function release(id: string, signal: AbortSignal) {
        if (reservations.current.get(id) !== signal)
            return;
        reservations.current.delete(id);
        if (!signal.aborted)
            setPending(new Set(reservations.current.keys()));
    }
    async function toggle(track: DneskaiAudioTrack, enabled: boolean) {
        if (readFailed || previewRefreshing || blocked.current.has(track.id))
            return;
        const scope = reserve(track.id);
        if (!scope)
            return;
        try {
            const intent: DneskaiAudioToggle = DneskaiAudioToggleSchema.parse({ action: 'toggle', ownerId: scope.ownerId, id: track.id, expectedVersion: track.updatedAt, enabled });
            const receipt = await setDneskaiAudioTrackEnabled(intent, scope.signal);
            if (scope.signal.aborted)
                return;
            await client.cancelQueries({ queryKey: qk.dneskaiAudio });
            if (scope.signal.aborted)
                return;
            const result = applyDneskaiAudioToggleReceipt(client, intent, receipt);
            if (result.reconcile)
                void client.invalidateQueries({ queryKey: qk.dneskaiAudio });
        }
        catch (error) {
            if (!scope.signal.aborted) {
                blocked.current.add(track.id);
                setErrors(before => new Map(before).set(track.id, error instanceof DneskaiAudioRequestError ? error.code : 'decision-failed'));
            }
        }
        finally {
            release(track.id, scope.signal);
        }
    }
    async function reload(id: string) {
        const scope = reserve(id);
        if (!scope)
            return;
        try {
            const success = await onReload();
            if (scope.signal.aborted || !success)
                return;
            blocked.current.delete(id);
            recoveryFocus.current = { id, signal: scope.signal };
            setErrors(before => {
                const next = new Map(before);
                next.delete(id);
                return next;
            });
        }
        catch {
            if (!scope.signal.aborted)
                setErrors(before => new Map(before).set(id, 'decision-failed'));
        }
        finally {
            release(id, scope.signal);
        }
    }
    if (!tracks.length)
        return <p className="border-t border-border pt-3 text-sm text-foreground-muted">{t.empty}</p>;
    return <>
    <ul aria-label={t.listLabel} className="divide-y divide-border border-y border-border">
      {tracks.map((track) => <li key={track.id} className="flex min-w-0 flex-wrap items-start gap-3 py-3" data-testid="dneskai-audio-track">
        <DneskaiAudioPlayButton track={track} playing={player.playing === track.id} pending={player.starting === track.id} failed={player.error === track.id} disabled={previewRefreshing} onToggle={player.toggle} lang={lang}/>
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
        <Switch ref={element => {
            if (element)
                switches.current.set(track.id, element);
            else
                switches.current.delete(track.id);
        }} checked={track.enabled} disabled={preview || !owner || pending.has(track.id) || errors.has(track.id) || previewRefreshing || readFailed} aria-busy={pending.has(track.id)} aria-label={t.enable(track.title)} className="mt-3" onCheckedChange={(enabled) => void toggle(track, enabled)}/>
        {errors.has(track.id) && <div className="w-full"><DneskaiAudioReadNotice message={Object.hasOwn(t.errors, errors.get(track.id)!) ? t.errors[errors.get(track.id)!]! : t.failed} retryLabel={t.reloadLibrary} pending={pending.has(track.id) || previewRefreshing} onRetry={() => void reload(track.id)}/></div>}
      </li>)}
    </ul>
  </>;
}

const ACCEPT = Object.keys(DNESKAI_AUDIO_TYPES).join(',');

function AudioUploadDialog({ lang }: {
    lang: Lang;
}) {
    const [open, setOpen] = useState(false), navigate = useGuardedNavigation();
    return <Dialog open={open} onOpenChange={next => next ? setOpen(true) : navigate(() => setOpen(false))}>
    <DialogTrigger asChild><Button>{dneskaiAudio[lang].upload.title}</Button></DialogTrigger>
    <DialogContent className="max-w-2xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{dneskaiAudio[lang].upload.title}</DialogTitle></DialogHeader><UploadForm lang={lang} embedded/></DialogContent>
  </Dialog>;
}
const emptyUploadFields = () => ({title:'', artist:'', source:'pixabay' as (typeof DNESKAI_AUDIO_UPLOAD_SOURCES)[number], sourceUrl:'', licenceNote:'', mood:''});
function UploadForm({ lang, embedded = false }: {
    lang: Lang;
    embedded?: boolean;
}) {
    const t = dneskaiAudio[lang], id = useId(), client = useQueryClient(), owner = useOwnerPreferences();
    const fileRef = useRef<HTMLInputElement>(null), lifetime = useRef(new AbortController()), pendingRef = useRef(false), dirtyRef = useRef(false);
    const session = useRef<ReturnType<typeof createDneskaiAudioUploadSession> | null>(null), original = useRef<AbortSignal | null>(null);
    const fileValue = useRef<File | null>(null), values = useRef(emptyUploadFields());
    const [file, setFile] = useState<File | null>(null), [fields, setFields] = useState(emptyUploadFields);
    const [pending, setPending] = useState(false), [locked, setLocked] = useState(false);
    const [message, setMessage] = useState<{
        tone: 'success' | 'risk';
        text: string;
    } | null>(null);
    useLayoutEffect(() => {
        if (lifetime.current.signal.aborted)
            lifetime.current = new AbortController();
        return () => lifetime.current.abort();
    }, []);
    function reset() {
        if (pendingRef.current)
            return;
        session.current = null;
        original.current = null;
        dirtyRef.current = false;
        fileValue.current = null;
        values.current = emptyUploadFields();
        setFile(null);
        setFields(values.current);
        setLocked(false);
        setMessage(null);
        if (fileRef.current)
            fileRef.current.value = '';
    }
    function failureMessage(failure: unknown) {
        if (failure instanceof DneskaiAudioRequestError && !['decision-failed','audio-library-unavailable','audio-track-write-failed'].includes(failure.code) && Object.hasOwn(t.errors,failure.code)) return t.errors[failure.code]!;
        return t.upload.unconfirmed;
    }
    async function save(): Promise<boolean> {
        if (pendingRef.current)
            return false;
        const problem = dneskaiAudioFileProblem(fileValue.current);
        if (problem) {
            setMessage({ tone: 'risk', text: t.upload[problem] });
            return false;
        }
        try {
            if (!session.current) {
                if (!owner)
                    throw new DneskaiAudioRequestError('unauthorized', 0);
                const captured = owner.capture(), signal = AbortSignal.any([captured.signal, lifetime.current.signal]);
                signal.throwIfAborted();
                session.current = createDneskaiAudioUploadSession({ ownerId: captured.ownerId, signal }, fileValue.current!, {
                    title: values.current.title, artist: values.current.artist, source: values.current.source, sourceUrl: values.current.sourceUrl.trim(), licenceNote: values.current.licenceNote,
                    mood: values.current.mood.split(',').map(tag => tag.trim()).filter(Boolean),
                });
                original.current = signal;
            }
        }
        catch (failure) {
            setMessage({ tone: 'risk', text: failureMessage(failure) });
            return false;
        }
        const signal = original.current!;
        if (signal.aborted)
            return false;
        pendingRef.current = true;
        dirtyRef.current = true;
        setPending(true);
        setLocked(true);
        setMessage(null);
        try {
            const track = await session.current.run();
            if (signal.aborted)
                return false;
            await client.cancelQueries({ queryKey: qk.dneskaiAudio });
            if (signal.aborted)
                return false;
            pendingRef.current = false;
            reset();
            setMessage({ tone: 'success', text: t.upload.done(track.title) });
            void client.invalidateQueries({ queryKey: qk.dneskaiAudio });
            return true;
        }
        catch (failure) {
            if (!signal.aborted)
                setMessage({ tone: 'risk', text: failureMessage(failure) });
            return false;
        }
        finally {
            pendingRef.current = false;
            if (!signal.aborted)
                setPending(false);
        }
    }
    useUnsavedDraft({ get dirty() {
            return dirtyRef.current;
        }, get pending() {
            return pendingRef.current;
        }, get canSave() {
            return !!fileValue.current;
        }, save, discard: reset });
    function change(key: keyof typeof fields, value: string) {
        if (session.current || pendingRef.current)
            return;
        dirtyRef.current = true;
        values.current = { ...values.current, [key]: value };
        setFields(values.current);
        setMessage(null);
    }
    const submit = (event: FormEvent) => {
        event.preventDefault();
        void save();
    };
    const field = (key: 'title' | 'artist' | 'sourceUrl' | 'licenceNote', label: string, options: {
        type?: string;
        max: number;
        placeholder?: string;
    }) => <div className="min-w-0"><label htmlFor={`${id}-${key}`} className="text-xs font-medium">{label}</label>
      <Input id={`${id}-${key}`} type={options.type ?? 'text'} required maxLength={options.max} placeholder={options.placeholder} className="min-h-11" value={fields[key]} disabled={pending} readOnly={locked} onChange={event => change(key, event.target.value)}/></div>;
    return <form onSubmit={submit} className="min-w-0 space-y-3" aria-labelledby={embedded ? undefined : `${id}-heading`} aria-label={embedded ? t.upload.title : undefined} aria-busy={pending} data-testid="dneskai-audio-upload">
    {!embedded && <h3 id={`${id}-heading`} className="text-sm font-medium">{t.upload.title}</h3>}
    <div><label htmlFor={`${id}-file`} className="text-xs font-medium">{t.upload.file}</label>
      <input ref={fileRef} id={`${id}-file`} type="file" accept={ACCEPT} required disabled={locked || pending} className="focus-ring block min-h-11 w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:text-sm" onChange={event => {
        if (session.current || pendingRef.current)
            return;
        dirtyRef.current = true;
        fileValue.current = event.target.files?.[0] ?? null;
        setFile(fileValue.current);
        setMessage(null);
    }}/></div>
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      {field('title', t.upload.trackTitle, { max: 120 })}
      {field('artist', t.upload.artist, { max: 120 })}
      <div className="min-w-0"><label htmlFor={`${id}-source`} className="text-xs font-medium">{t.upload.source}</label>
        <select id={`${id}-source`} value={fields.source} disabled={locked || pending} onChange={event => change('source', event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm focus-ring">
          {DNESKAI_AUDIO_UPLOAD_SOURCES.map(source => <option key={source} value={source}>{t.sources[source]}</option>)}
        </select></div>
      {field('sourceUrl', t.upload.sourceUrl, { type: 'url', max: 2048, placeholder: 'https://' })}
      {field('licenceNote', t.upload.licenceNote, { max: 500, placeholder: t.upload.licencePlaceholder })}
      <div className="min-w-0"><label htmlFor={`${id}-mood`} className="text-xs font-medium">{t.upload.mood}</label>
        <Input id={`${id}-mood`} className="min-h-11" value={fields.mood} disabled={pending} readOnly={locked} maxLength={160} onChange={event => change('mood', event.target.value)}/></div>
    </div>
    <div aria-live="polite">{message && <p role={message.tone === 'risk' ? 'alert' : 'status'} className={message.tone === 'risk' ? 'text-sm text-risk' : 'text-sm text-success'}>{message.text}</p>}</div>
    {locked && !pending && <p className="text-xs text-foreground-muted">{t.upload.retained}</p>}
    <div className={locked ? "grid grid-cols-1 gap-2 sm:w-fit sm:grid-cols-2" : "flex"}>
      <Button type="submit" className="min-h-11" disabled={pending || !owner || !file} aria-busy={pending}>{pending ? t.upload.uploading : locked ? t.upload.retry : t.upload.submit}</Button>
      {locked && <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => {
        reset();
        fileRef.current?.focus();
    }}>{t.upload.discard}</Button>}
    </div>
  </form>;
}

/** Confirmed Meta recommendations and niche hints; nothing is downloaded. */
function TrendList({ trends, status, lang, pending, onRetry }: { trends: DneskaiAudioTrend[]; status: DneskaiAudioTrendsStatus | undefined; lang: Lang; pending: boolean; onRetry: () => void }) {
  const t = dneskaiAudio[lang].trends;
  if (status === 'disabled') return null;
  return <section aria-labelledby="dneskai-audio-trends-title" className="min-w-0 space-y-2" data-testid="dneskai-audio-trends">
    <h3 id="dneskai-audio-trends-title" className="text-sm font-medium">{t.title}</h3>
    <DneskaiAudioTrendsNotice status={status} empty={!trends.length} lang={lang} pending={pending} onRetry={onRetry} />
    {status === 'ready' && trends.length > 0 && <><p className="text-xs text-foreground-muted">{t.intro}</p>
    <ul className="divide-y divide-border border-y border-border">
      {trends.map((trend) => <li key={trend.audioId} className="flex min-w-0 items-center gap-3 py-2">
        {trend.coverUrl ? <Image unoptimized src={trend.coverUrl} alt="" width={44} height={44} className="size-11 shrink-0 rounded object-cover" /> : <span aria-hidden className="size-11 shrink-0 rounded bg-surface-muted" />}
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{trend.title}{trend.artist && <span className="font-normal text-foreground-muted"> · {trend.artist}</span>}</p>
          <p className="text-xs text-foreground-muted">{[t.type[trend.type], trend.daysSeen ? t.days(trend.daysSeen) : null, trend.nicheCount ? t.niche(trend.nicheCount) : null, trend.tiktok ? t.tiktok : null, trend.attachable ? null : t.hintOnly].filter(Boolean).join(' · ')}</p>
        </div>
      </li>)}
    </ul></>}
  </section>;
}
