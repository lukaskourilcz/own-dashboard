// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
import { DneskaiMusicHint, dneskaiMusicHintDue, dneskaiMusicHintTrack } from '@/components/marketing/dneskai/music-hint';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { DEMO_DNESKAI_AUDIO_TRACKS } from '@/lib/marketing/dneskai-audio-client';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = new Date('2026-10-24T09:00:00Z');
let container: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); });
const render = (node: React.ReactNode) => act(() => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
const settle = () => act(async () => { for (let turn = 0; turn < 10; turn++) await new Promise(done => setTimeout(done, 20)); });
const published = (patch: Partial<DneskaiWorkspacePost> = {}, publishedAt = '2026-10-22T08:00:00Z'): DneskaiWorkspacePost => {
  const post = createDneskaiWorkspaceFixture(now).posts[0]!;
  return { ...post, format: 'carousel', status: 'published', publication: { id: '33333333-3333-4333-8333-333333333333', status: 'published', scheduledAt: publishedAt, remoteUrl: 'https://www.instagram.com/p/x/', errorCode: null, lastCheckedAt: null, publishedAt }, ...patch };
};

describe('manual music fallback (#168)', () => {
  it('is due for a carousel published in the last seven days only', () => {
    expect(dneskaiMusicHintDue(published(), now)).toBe(true);
    expect(dneskaiMusicHintDue(published({}, '2026-10-16T08:00:00Z'), now)).toBe(false);
    expect(dneskaiMusicHintDue(published({ format: 'reel' }), now)).toBe(false);
    expect(dneskaiMusicHintDue(published({ publication: null }), now)).toBe(false);
  });

  it('suggests a different enabled track per post and none from an empty library', () => {
    const tracks = [{ ...DEMO_DNESKAI_AUDIO_TRACKS[0]!, id: 'a', enabled: true }, { ...DEMO_DNESKAI_AUDIO_TRACKS[0]!, id: 'b', enabled: false }, { ...DEMO_DNESKAI_AUDIO_TRACKS[0]!, id: 'c', enabled: true }];
    expect([0, 1, 2].map((position) => dneskaiMusicHintTrack(tracks, position)?.id)).toEqual(['a', 'c', 'a']);
    expect(dneskaiMusicHintTrack([], 0)).toBeNull();
  });

  it.each(['en', 'cs'] as const)('shows the badge, the in-app steps and a copyable track name (%s)', async (lang) => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<DneskaiMusicHint post={published()} position={0} preview lang={lang} now={now} />); await settle();
    const t = dneskaiAudio[lang].hint;
    expect(container.textContent).toContain(t.badge);
    expect(container.textContent).toContain(t.help);
    const name = 'Quiet Circuit – Sample artist';
    const button = container.querySelector(`button[aria-label="${t.copy(name)}"]`) as HTMLButtonElement;
    await act(async () => { button.click(); });
    expect(writeText).toHaveBeenCalledWith(name);
    expect(container.textContent).toContain(t.copied);
  });

  it('stays hidden while Reels are off and for an older post', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not-found"}', { status: 404 })));
    render(<DneskaiMusicHint post={published()} position={0} preview={false} lang="en" now={now} />); await settle();
    expect(container.innerHTML).toBe('');
    render(<DneskaiMusicHint post={published({}, '2026-10-10T08:00:00Z')} position={0} preview lang="en" now={now} />); await settle();
    expect(container.innerHTML).toBe('');
  });
});
