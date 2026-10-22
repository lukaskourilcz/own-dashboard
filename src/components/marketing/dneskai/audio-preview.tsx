'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { DNESKAI_AUDIO_PREVIEW_SECONDS, type DneskaiAudioTrack } from '@/lib/marketing/dneskai-audio-contracts';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';

/** One player for the whole screen: starting a track stops the one before; every preview ends after 10 seconds. */
export function useDneskaiAudioPreview() {
  const player = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<number | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    player.current?.pause();
    setPlaying(null);
  }, []);
  const toggle = useCallback((track: DneskaiAudioTrack) => {
    if (playing === track.id) { stop(); return; }
    stop();
    if (!track.previewUrl) return;
    player.current ??= new Audio();
    player.current.src = track.previewUrl;
    player.current.currentTime = 0;
    player.current.onended = stop;
    void player.current.play().then(() => {
      setPlaying(track.id);
      timer.current = window.setTimeout(stop, DNESKAI_AUDIO_PREVIEW_SECONDS * 1000);
    }, stop);
  }, [playing, stop]);
  useEffect(() => stop, [stop]);
  return { playing, toggle };
}

export function DneskaiAudioPlayButton({ track, playing, onToggle, lang }: { track: DneskaiAudioTrack; playing: boolean; onToggle: (track: DneskaiAudioTrack) => void; lang: 'en' | 'cs' }) {
  const t = dneskaiAudio[lang];
  const label = !track.previewUrl ? t.noPreview : playing ? t.stop(track.title) : t.play(track.title);
  return <button type="button" className="focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-border text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    aria-label={label} title={label} aria-pressed={playing} disabled={!track.previewUrl} onClick={() => onToggle(track)}>
    {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
  </button>;
}
