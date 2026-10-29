// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { qk } from '@/lib/queries/keys';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
import { DneskaiMusicHint, dneskaiMusicHintDue, dneskaiMusicHintTrack } from '@/components/marketing/dneskai/music-hint';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { DEMO_DNESKAI_AUDIO_TRACKS, useDneskaiAudioLibrary } from '@/lib/marketing/dneskai-audio-client';
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

describe('the niche ranking in the badge (#167)', () => {
  it('suggests the sound the tracked profiles use most before a library track', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => undefined) } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ tracks: DEMO_DNESKAI_AUDIO_TRACKS, trendsStatus: 'ready', trends: [
      { audioId: '9', title: 'Niche Song', artist: 'Niche Artist', type: 'music', durationMs: null, coverUrl: null, daysSeen: 0, nicheCount: 3, tiktok: false, attachable: false },
    ] })));
    render(<DneskaiMusicHint post={published()} position={0} preview={false} lang="en" now={now} />); await settle();
    expect(container.textContent).toContain('Niche Song – Niche Artist');
  });
});

describe('shared due-only music reads',()=>{
 it('does not request audio for an old, future or unpublished carousel',async()=>{const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);for(const post of [published({},'2026-10-10T08:00:00Z'),published({},'2026-10-25T08:00:00Z'),published({publication:null})]){render(<DneskaiMusicHint post={post} position={0} preview={false} lang="en" now={now}/>);await settle();expect(container.innerHTML).toBe('');}expect(fetcher).not.toHaveBeenCalled();});
 it('shares the loaded library query with a due post hint',async()=>{const fetcher=vi.fn(async()=>Response.json({tracks:DEMO_DNESKAI_AUDIO_TRACKS,trends:[],trendsStatus:'ready',nextOffset:null}));vi.stubGlobal('fetch',fetcher);function LibraryReader(){useDneskaiAudioLibrary(false);return null;}render(<><LibraryReader/><DneskaiMusicHint post={published()} position={0} preview={false} lang="en" now={now}/></>);await settle();expect(fetcher).toHaveBeenCalledOnce();expect(container.textContent).toContain('Quiet Circuit');});
 it('uses a confirmed uploaded track when optional suggestions are unavailable',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({tracks:DEMO_DNESKAI_AUDIO_TRACKS,trends:[],trendsStatus:'unavailable',nextOffset:null})));render(<DneskaiMusicHint post={published()} position={0} preview={false} lang="en" now={now}/>);await settle();expect(container.textContent).toContain('Quiet Circuit');});
});

it('keeps copy feedback bound to the clicked name and ignores older completions',async()=>{
 const finishes:Array<()=>void>=[];const writeText=vi.fn(()=>new Promise<void>(resolve=>finishes.push(resolve)));vi.stubGlobal('navigator',{clipboard:{writeText}});vi.stubGlobal('fetch',vi.fn(async()=>Response.json({tracks:DEMO_DNESKAI_AUDIO_TRACKS,trends:[],trendsStatus:'ready',nextOffset:null})));render(<DneskaiMusicHint post={published()} position={0} preview={false} lang="en" now={now}/>);await settle();const first=container.querySelector('button')!;act(()=>first.click());const replacement={...DEMO_DNESKAI_AUDIO_TRACKS[0],title:'Synthetic later title'};act(()=>{client.setQueryData([...qk.dneskaiAudio,false,'pages'],{pages:[{tracks:[replacement],trends:[],trendsStatus:'ready',nextOffset:null}],pageParams:[0]});});await settle();expect(container.textContent).toContain('Synthetic later title');expect(container.textContent).not.toContain(dneskaiAudio.en.hint.copied);act(()=>container.querySelector('button')!.click());await act(async()=>finishes[1]());expect(container.textContent).toContain(dneskaiAudio.en.hint.copied);await act(async()=>finishes[0]());expect(container.textContent).toContain(dneskaiAudio.en.hint.copied);expect(writeText.mock.calls).toEqual([['Quiet Circuit – Sample artist'],['Synthetic later title – Sample artist']]);
});
