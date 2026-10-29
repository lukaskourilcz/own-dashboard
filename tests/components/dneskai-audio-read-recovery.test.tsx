// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DneskaiAudioPicker } from '@/components/marketing/dneskai/lab/audio-picker';
import { DneskaiAudioLibrary } from '@/components/marketing/dneskai-audio-library';
import { DEMO_DNESKAI_AUDIO_TRACKS } from '@/lib/marketing/dneskai-audio-client';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { TooltipProvider } from '@/components/ui/tooltip';
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
(globalThis as {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
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
});
const render = (node: React.ReactNode) => act(() => root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>));
const settle = () => act(async () => {
    for (let i = 0; i < 10; i++)
        await new Promise(done => setTimeout(done, 20));
});
const payload = () => ({ tracks: [DEMO_DNESKAI_AUDIO_TRACKS[0]], trends: [], trendsStatus: 'unavailable', nextOffset: null });
const copy = {
    en: { refresh: 'The library could not be refreshed. Your loaded tracks are kept.', selected: 'The saved track could not be checked.', retrySelected: 'Retry saved track' }, cs: { refresh: 'Knihovnu se nepodařilo obnovit. Načtené skladby zůstávají.', selected: 'Uloženou skladbu se nepodařilo ověřit.', retrySelected: 'Zkusit uloženou skladbu znovu' }
};
for (const lang of ['en', 'cs'] as const) {
    it(`${lang}: retains cached library data and offers explicit refresh recovery`, async () => {
        let failed = false;
        const fetcher = vi.fn(async () => failed ? Response.json({ error: 'audio-library-unavailable' }, { status: 503 }) : Response.json(payload()));
        vi.stubGlobal('fetch', fetcher);
        render(<DneskaiAudioLibrary lang={lang}/>);
        await settle();
        failed = true;
        await act(async () => client.refetchQueries());
        await settle();
        expect(host.textContent).toContain('Quiet Circuit');
        expect(host.textContent).toContain(copy[lang].refresh);
        expect(host.textContent).not.toContain(dneskaiAudio[lang].empty);
        expect(host.querySelectorAll('[data-testid="dneskai-audio-trends-notice"]')).toHaveLength(0);
        expect([...host.querySelectorAll('button')].some(button => button.textContent === dneskaiAudio[lang].upload.title)).toBe(true);
        failed = false;
        const retry = [...host.querySelectorAll('button')].find(button => button.textContent === dneskaiAudio[lang].retry)!;
        expect(retry).toBeDefined();
        await act(async () => retry.click());
        await settle();
        expect(host.textContent).not.toContain(copy[lang].refresh);
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
    it(`${lang}: the picker exposes a cached library refresh failure without replacing the choice`, async () => {
        let failed = false;
        vi.stubGlobal('fetch', vi.fn(async () => failed ? Response.json({ error: 'audio-library-unavailable' }, { status: 503 }) : Response.json(payload())));
        const change = vi.fn();
        render(<DneskaiAudioPicker value={DEMO_DNESKAI_AUDIO_TRACKS[0].id} onChange={change} preview={false} lang={lang}/>);
        await settle();
        failed = true;
        await act(async () => client.refetchQueries());
        await settle();
        expect(host.textContent).toContain(copy[lang].refresh);
        expect(host.querySelectorAll('[data-testid="dneskai-audio-trends-notice"]')).toHaveLength(0);
        expect(host.querySelector('select')?.value).toBe(DEMO_DNESKAI_AUDIO_TRACKS[0].id);
        expect(change).not.toHaveBeenCalled();
    });
    it(`${lang}: retries only unavailable saved-track details and keeps its exact value`, async () => {
        const saved = '99999999-9999-4999-8999-999999999999';
        let failed = true;
        const calls: string[] = [], fetcher = vi.fn(async (url: RequestInfo | URL) => {
            calls.push(String(url));
            if (String(url).includes('trackId='))
                return failed ? Response.json({ error: 'audio-library-unavailable' }, { status: 503 }) : Response.json({ tracks: [{ ...DEMO_DNESKAI_AUDIO_TRACKS[0], id: saved, title: 'Retained saved track', enabled: false }], nextOffset: null });
            return Response.json(payload());
        });
        vi.stubGlobal('fetch', fetcher);
        const change = vi.fn();
        render(<DneskaiAudioPicker value={saved} onChange={change} preview={false} lang={lang}/>);
        await settle();
        expect(host.textContent).toContain(copy[lang].selected);
        expect(host.textContent).toContain('Quiet Circuit');
        expect(host.querySelector('select')?.value).toBe(saved);
        failed = false;
        const retry = [...host.querySelectorAll('button')].find(button => button.textContent === copy[lang].retrySelected)!;
        expect(retry).toBeDefined();
        await act(async () => retry.click());
        await settle();
        expect(host.textContent).toContain('Retained saved track');
        expect(host.textContent).not.toContain(copy[lang].selected);
        expect(host.querySelector('select')?.value).toBe(saved);
        expect(change).not.toHaveBeenCalled();
        expect(calls.filter(url => url.includes('trackId='))).toHaveLength(2);
        expect(calls.filter(url => !url.includes('trackId='))).toHaveLength(1);
    });
}
