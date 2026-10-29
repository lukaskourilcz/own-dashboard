// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDneskaiAudioPreview } from '@/components/marketing/dneskai/audio-preview';
import { DEMO_DNESKAI_AUDIO_TRACKS } from '@/lib/marketing/dneskai-audio-client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const first = { ...DEMO_DNESKAI_AUDIO_TRACKS[0]!, id: 'one', previewUrl: 'https://test-only.supabase.co/one.mp3' };
const second = { ...first, id: 'two', previewUrl: 'https://test-only.supabase.co/two.mp3' };
class Media {
  static instances: Media[] = [];
  src = ''; preload = ''; currentTime = 0;
  onended: (() => void) | null = null; onerror: (() => void) | null = null;
  onpause: (() => void) | null = null; ontimeupdate: (() => void) | null = null;
  resolve!: () => void; reject!: (reason: unknown) => void;
  play = vi.fn(() => new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; }));
  pause = vi.fn(); load = vi.fn();
  removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
  constructor() { Media.instances.push(this); }
}
let root: Root, container: HTMLDivElement;
let players: Array<ReturnType<typeof useDneskaiAudioPreview>>;
function Harness({ count = 1 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, index) => <Player key={index} index={index} />)}</>;
}
function Player({ index }: { index: number }) { const player = useDneskaiAudioPreview(); useEffect(() => { players[index] = player; }, [index, player]); return null; }
const run = async (operation: () => void) => { await act(async () => { operation(); await Promise.resolve(); }); };
const clear = (media: Media) => { expect(media.pause).toHaveBeenCalled(); expect(media.src).toBe(''); expect(media.removeAttribute).toHaveBeenCalledWith('src'); expect(media.load).toHaveBeenCalled(); };
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('Audio', Media); Media.instances = []; players = [];
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('audio preview intent and media disposal', () => {
  it('creates no media or preload request before an explicit usable choice', async () => {
    expect(Media.instances).toHaveLength(0);
    await run(() => players[0]!.toggle({ ...first, previewUrl: null }));
    expect(Media.instances).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('distinguishes pending playback from confirmed playback and requests no preload', async () => {
    await run(() => players[0]!.toggle(first));
    const media = Media.instances[0]!;
    expect(media.preload).toBe('none'); expect(players[0]!.playing).toBeNull(); expect(players[0]!.starting).toBe(first.id);
    await run(() => media.resolve());
    expect(players[0]!.starting).toBeNull(); expect(players[0]!.playing).toBe(first.id); expect(vi.getTimerCount()).toBe(1);
  });
  it('a second same-turn click cancels pending playback without starting another transfer', async () => {
    await run(() => { players[0]!.toggle(first); players[0]!.toggle(first); });
    expect(Media.instances).toHaveLength(1); clear(Media.instances[0]!);
    await run(() => Media.instances[0]!.resolve());
    expect(players[0]!.playing).toBeNull(); expect(players[0]!.starting).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['resolve', 'reject'] as const)('an obsolete %s cannot restart or stop the newer track', async result => {
    await run(() => players[0]!.toggle(first)); const old = Media.instances[0]!;
    await run(() => players[0]!.toggle(second)); const current = Media.instances[1]!; clear(old);
    await run(() => current.resolve());
    await run(() => result === 'resolve' ? old.resolve() : old.reject(new Error('Private fixture failure')));
    expect(players[0]!.playing).toBe(second.id); expect(players[0]!.error).toBeNull(); expect(current.pause).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
  });
  it.each(['resolve', 'reject'] as const)('a late %s after unmount leaves no timer or media source', async result => {
    await run(() => players[0]!.toggle(first)); const media = Media.instances[0]!;
    act(() => root.unmount()); root = createRoot(container); clear(media);
    await run(() => result === 'resolve' ? media.resolve() : media.reject(new Error('Private fixture failure')));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops the previous player across separately mounted picker instances', async () => {
    act(() => root.render(<Harness count={2} />));
    await run(() => players[0]!.toggle(first)); const old = Media.instances[0]!;
    await run(() => old.resolve());
    await run(() => players[1]!.toggle(second)); clear(old);
    await run(() => Media.instances[1]!.resolve());
    expect(players[0]!.playing).toBeNull(); expect(players[1]!.playing).toBe(second.id); expect(vi.getTimerCount()).toBe(1);
  });
  it('caps a stalled start, discards its late acknowledgement and permits an explicit retry', async () => {
    await run(() => players[0]!.toggle(first)); const old = Media.instances[0]!;
    await run(() => vi.advanceTimersByTime(10_000)); clear(old);
    expect(players[0]!.starting).toBeNull(); expect(players[0]!.error).toBe(first.id);
    await run(() => old.resolve()); expect(vi.getTimerCount()).toBe(0);
    await run(() => players[0]!.toggle(first)); await run(() => Media.instances[1]!.resolve());
    expect(players[0]!.error).toBeNull(); expect(players[0]!.playing).toBe(first.id);
  });
  it('retains only the affected identity on a rejected play, never the private exception', async () => {
    await run(() => players[0]!.toggle(first)); const media = Media.instances[0]!;
    await run(() => media.reject(new Error('Private fixture URL and provider response'))); clear(media);
    expect(players[0]!.error).toBe(first.id); expect(players[0]!.playing).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['onended', 'onpause', 'onerror'] as const)('disposes on %s without retaining playback or timers', async event => {
    await run(() => players[0]!.toggle(first)); const media = Media.instances[0]!;
    await run(() => media.resolve()); await run(() => media[event]?.()); clear(media);
    expect(players[0]!.playing).toBeNull(); expect(players[0]!.error).toBe(event === 'onerror' ? first.id : null); expect(vi.getTimerCount()).toBe(0);
  });
  it('disposes after ten seconds of playback even without an ended event', async () => {
    await run(() => players[0]!.toggle(first)); const media = Media.instances[0]!;
    await run(() => media.resolve()); await run(() => vi.advanceTimersByTime(10_000)); clear(media);
    expect(players[0]!.playing).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it('also enforces the media-time limit if playback acknowledgement is delayed', async () => {
    await run(() => players[0]!.toggle(first)); const media = Media.instances[0]!;
    media.currentTime = 10; await run(() => media.ontimeupdate?.()); clear(media);
    await run(() => media.resolve()); expect(players[0]!.playing).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
});
