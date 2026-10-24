'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Pause, Play } from 'lucide-react';
import { DNESKAI_AUDIO_PREVIEW_SECONDS, type DneskaiAudioTrack } from '@/lib/marketing/dneskai-audio-contracts';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';

type PreviewSession = { id: string; audio: HTMLAudioElement; startup: number | null; end: number | null; stop: () => void };
// Browser interaction only: separately mounted Lab pickers share one active
// preview. No media or mutable request state is created during server rendering.
let activePreview: PreviewSession | null = null;
const STARTUP_LIMIT_MS = 10_000;

/** A stopped/obsolete play promise cannot affect the current selection. */
export function useDneskaiAudioPreview() {
  const session = useRef<PreviewSession | null>(null);
  const mounted = useRef(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dispose = useCallback(() => {
    const previous = session.current;
    session.current = null;
    if (previous) {
      if (activePreview === previous) activePreview = null;
      if (previous.startup !== null) window.clearTimeout(previous.startup);
      if (previous.end !== null) window.clearTimeout(previous.end);
      const audio = previous.audio;
      audio.onended = audio.onerror = audio.onpause = audio.ontimeupdate = null;
      audio.pause();
      // pause() alone keeps the source available for buffering. Removing it
      // and resetting the element aborts the browser's ongoing media load.
      audio.removeAttribute('src');
      audio.load();
    }
    if (mounted.current) { setPlaying(null); setStarting(null); }
  }, []);
  const stop = useCallback(() => { dispose(); if (mounted.current) setError(null); }, [dispose]);
  const toggle = useCallback((track: DneskaiAudioTrack) => {
    if (!mounted.current) return;
    if (session.current?.id === track.id) { stop(); return; }
    activePreview?.stop();
    stop();
    if (!track.previewUrl) return;
    const id = track.id;
    let current: PreviewSession | null = null;
    const isCurrent = () => mounted.current && current !== null && session.current === current;
    const fail = () => { if (isCurrent()) { dispose(); setError(id); } };
    try {
      const audio = new Audio();
      audio.preload = 'none';
      current = { id, audio, startup: null, end: null, stop };
      session.current = current; activePreview = current;
      setStarting(id);
      audio.onended = audio.onpause = () => { if (isCurrent()) stop(); };
      audio.onerror = fail;
      audio.ontimeupdate = () => { if (isCurrent() && audio.currentTime >= DNESKAI_AUDIO_PREVIEW_SECONDS) stop(); };
      audio.src = track.previewUrl;
      const requested = current;
      requested.startup = window.setTimeout(fail, STARTUP_LIMIT_MS);
      void audio.play().then(() => {
        if (!isCurrent()) return;
        if (requested.startup !== null) window.clearTimeout(requested.startup);
        requested.startup = null;
        setStarting(null); setPlaying(id);
        requested.end = window.setTimeout(() => { if (isCurrent()) stop(); }, DNESKAI_AUDIO_PREVIEW_SECONDS * 1000);
      }, fail);
    } catch { if (current) fail(); else setError(id); }
  }, [dispose, stop]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; dispose(); };
  }, [dispose]);
  return { playing, starting, error, toggle, stop };
}

export function DneskaiAudioPlayButton({ track, playing, onToggle, lang, pending = false, failed = false, disabled = false }: { track: DneskaiAudioTrack; playing: boolean; onToggle: (track: DneskaiAudioTrack) => void; lang: 'en' | 'cs'; pending?: boolean; failed?: boolean; disabled?: boolean }) {
  const t = dneskaiAudio[lang];
  const label = !track.previewUrl ? t.noPreview : pending ? t.cancelPreview(track.title) : playing ? t.stop(track.title) : failed ? t.retryPreview(track.title) : t.play(track.title);
  return <button type="button" className="focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-border text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    aria-label={label} title={label} aria-pressed={playing} aria-busy={pending} disabled={!track.previewUrl || (disabled && !playing && !pending)} onClick={() => onToggle(track)}>
    {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
  </button>;
}
