// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DneskaiAudioLibrary } from '@/components/marketing/dneskai-audio-library';
import { DneskaiAudioPicker } from '@/components/marketing/dneskai/lab/audio-picker';
import { DEMO_DNESKAI_AUDIO_TRACKS } from '@/lib/marketing/dneskai-audio-client';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { TooltipProvider } from '@/components/ui/tooltip';
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
(globalThis as {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, consoleErrors: unknown[][];
beforeEach(() => {
    consoleErrors = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => {
        consoleErrors.push(args);
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    client.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    expect(consoleErrors).toEqual([]);
});
const settle = () => act(async () => {
    for (let i = 0; i < 10; i++)
        await new Promise(done => setTimeout(done, 20));
});
const render = (node: React.ReactNode) => act(() => root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>));
const first = { ...DEMO_DNESKAI_AUDIO_TRACKS[0], id: '22222222-2222-4222-8222-222222222222', title: 'Retained first track' };
for (const lang of ['en', 'cs'] as const) {
    for (const kind of ['duplicate', 'reversed', 'microsecond', 'partial'] as const)
        it(`${lang}: refuses ${kind} next-page data, retains its prefix and reloads explicitly`, async () => {
            const captured = kind === 'microsecond' ? { ...first, createdAt: '2026-10-23T08:00:00.000002Z' } : first;
            const rejected = kind === 'duplicate' ? [{ ...captured, title: 'Unconfirmed replacement' }] : kind === 'reversed' ? [{ ...captured, id: '11111111-1111-4111-8111-111111111111', title: 'Unconfirmed earlier row' }] : kind === 'microsecond' ? [{ ...captured, id: '33333333-3333-4333-8333-333333333333', title: 'Unconfirmed older microsecond', createdAt: '2026-10-23T08:00:00.000001Z' }] : [{ ...captured, id: '33333333-3333-4333-8333-333333333333', title: 'Unconfirmed partial page' }, captured];
            let fresh = false;
            const fetcher = vi.fn(async (url: RequestInfo | URL) => Response.json({
                tracks: String(url).includes('offset=1') ? rejected : [{ ...captured, title: fresh ? 'Confirmed reloaded track' : first.title }], nextOffset: fresh || String(url).includes('offset=1') ? null : 1, trendsStatus: 'disabled'
            }));
            vi.stubGlobal('fetch', fetcher);
            render(<DneskaiAudioLibrary lang={lang}/>);
            await settle();
            const more = [...host.querySelectorAll('button')].find(button => button.textContent === dneskaiAudio[lang].loadMore)!;
            await act(async () => more.click());
            await settle();
            expect(host.querySelectorAll('[data-testid="dneskai-audio-track"]')).toHaveLength(1);
            expect(host.textContent).toContain(first.title);
            expect(host.textContent).not.toContain('Unconfirmed');
            const retry = [...host.querySelectorAll('button')].find(button => button.textContent === dneskaiAudio[lang].retry)!;
            expect(retry).toBeDefined();
            expect([...host.querySelectorAll('button')].some(button => button.textContent === dneskaiAudio[lang].loadMore)).toBe(false);
            fresh = true;
            await act(async () => retry.click());
            await settle();
            expect(host.textContent).toContain('Confirmed reloaded track');
            expect(fetcher).toHaveBeenCalledTimes(3);
            expect(String(fetcher.mock.calls[2]?.[0])).not.toContain('offset=');
        });
    it(`${lang}: does not silently accept a disabled feature as the end of a loaded library`, async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => String(url).includes('offset=1') ? Response.json({ error: 'not-found' }, { status: 404 }) : Response.json({ tracks: [first], nextOffset: 1, trendsStatus: 'disabled' })));
        render(<DneskaiAudioLibrary lang={lang}/>);
        await settle();
        const more = [...host.querySelectorAll('button')].find(button => button.textContent === dneskaiAudio[lang].loadMore)!;
        await act(async () => more.click());
        await settle();
        expect(host.textContent).toContain(first.title);
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
    });
    it(`${lang}: the picker retains its choice when next-page ids repeat`, async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => Response.json({
            tracks: [{ ...first, title: String(url).includes('offset=1') ? 'Unconfirmed replacement' : first.title }], nextOffset: String(url).includes('offset=1') ? null : 1, trendsStatus: 'disabled'
        })));
        const change = vi.fn();
        render(<DneskaiAudioPicker lang={lang} value={first.id} onChange={change} preview={false}/>);
        await settle();
        const more = [...host.querySelectorAll('button')].find(button => button.textContent === dneskaiAudio[lang].loadMore)!;
        await act(async () => more.click());
        await settle();
        expect(host.querySelectorAll(`option[value="${first.id}"]`)).toHaveLength(1);
        expect(host.querySelector('select')?.value).toBe(first.id);
        expect(host.textContent).not.toContain('Unconfirmed replacement');
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(change).not.toHaveBeenCalled();
    });
}

it('keeps the verified prefix and recovery after a failed full reload', async () => {
    let roots = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('offset=1')) return Response.json({tracks: [first], nextOffset: null, trendsStatus: 'disabled'});
        roots++;
        if (roots === 2) return Response.json({error: 'audio-library-unavailable'}, {status: 503});
        return Response.json({tracks: [first], nextOffset: roots === 1 ? 1 : null, trendsStatus: 'disabled'});
    });
    vi.stubGlobal('fetch', fetcher);
    render(<DneskaiAudioLibrary lang="en"/>); await settle();
    const button = (name: string) => [...host.querySelectorAll('button')].find(element => element.textContent === name)!;
    await act(async () => button(dneskaiAudio.en.loadMore).click()); await settle();
    await act(async () => button(dneskaiAudio.en.retry).click()); await settle();
    expect(host.textContent).toContain(first.title); expect(host.textContent).toContain(dneskaiAudio.en.pagesUnavailable);
    expect(host.querySelectorAll('[data-testid="dneskai-audio-track"]')).toHaveLength(1);
    await act(async () => button(dneskaiAudio.en.retry).click()); await settle();
    expect(host.textContent).not.toContain(dneskaiAudio.en.pagesUnavailable); expect(fetcher).toHaveBeenCalledTimes(4);
});
