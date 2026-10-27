// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DneskaiAudioLibrary } from '@/components/marketing/dneskai-audio-library';
import { DEMO_DNESKAI_AUDIO_TRACKS } from '@/lib/marketing/dneskai-audio-client';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
(globalThis as {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
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
const settle = () => act(async () => {
    for (let i = 0; i < 10; i++)
        await new Promise(done => setTimeout(done, 20));
});
const render = (lang: 'en' | 'cs', ownerId: string | null = owner) => act(() => root.render(<StrictMode><QueryClientProvider client={client}><TooltipProvider>{ownerId ? <OwnerPreferencesProvider ownerId={ownerId}><DneskaiAudioLibrary lang={lang}/></OwnerPreferencesProvider> : <DneskaiAudioLibrary lang={lang}/>}</TooltipProvider></QueryClientProvider></StrictMode>));
const switches = () => [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
const page = (tracks = DEMO_DNESKAI_AUDIO_TRACKS) => Response.json({ tracks, trends: [], trendsStatus: 'disabled', nextOffset: null });
for (const lang of ['en', 'cs'] as const) {
    it(`${lang}: admits one captured action, retains pending state and applies its receipt without another read`, async () => {
        let reads = 0, finish!: (reply: Response) => void;
        const bodies: Array<Record<string, unknown>> = [];
        vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method !== 'POST') {
                reads++;
                return page();
            }
            bodies.push(JSON.parse(String(init.body)));
            return new Promise<Response>(resolve => {
                finish = resolve;
            });
        }));
        render(lang);
        await settle();
        const beforeReads=reads;
        const button = switches()[0];
        await act(async () => {
            button.click();
            button.click();
        });
        await settle();
        expect(bodies).toHaveLength(1);
        expect(bodies[0]).toEqual({ action: 'toggle', ownerId: owner, id: DEMO_DNESKAI_AUDIO_TRACKS[0].id, enabled: false, expectedVersion: DEMO_DNESKAI_AUDIO_TRACKS[0].updatedAt });
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-checked')).toBe('true');
        finish(Response.json({ receipt: { kind: 'saved', ownerId: owner, id: bodies[0].id, requestedEnabled: false, expectedVersion: bodies[0].expectedVersion, updatedAt: '2026-10-23T08:00:00.000001Z' } }));
        await settle();
        expect(switches()[0].getAttribute('aria-checked')).toBe('false');
        expect(switches()[0].disabled).toBe(false);
        expect(reads).toBe(beforeReads);
    });
    it(`${lang}: an uncertain write stays blocked until a read confirms current state, without resending`, async () => {
        let reads = 0, writes = 0;
        vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'POST') {
                writes++;
                return Response.json({ error: 'audio-track-write-failed' }, { status: 503 });
            }
            reads++;
            return page(writes > 0 ? [{ ...DEMO_DNESKAI_AUDIO_TRACKS[0], enabled: false, updatedAt: '2026-10-23T08:00:00.000001Z' }] : [DEMO_DNESKAI_AUDIO_TRACKS[0]]);
        }));
        render(lang);
        await settle();
        const beforeReads=reads;
        await act(async () => switches()[0].click());
        await settle();
        expect(switches()[0].disabled).toBe(true);
        expect(switches()[0].getAttribute('aria-checked')).toBe('true');
        expect(host.textContent).toContain(dneskaiAudio[lang].errors['audio-track-write-failed']);
        const reload = [...host.querySelectorAll('button')].find(button => button.textContent === dneskaiAudio[lang].reloadLibrary)!;
        await act(async () => reload.click());
        await settle();
        expect(writes).toBe(1);
        expect(reads).toBe(beforeReads+1);
        expect(switches()[0].getAttribute('aria-checked')).toBe('false');
        expect(switches()[0].disabled).toBe(false);
        expect(document.activeElement).toBe(switches()[0]);
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });
}
it('does not grant writes without an owner scope', async () => {
    const fetcher = vi.fn(async (_url:RequestInfo|URL,init?:RequestInit) => {expect(init?.method??'GET').toBe('GET');return page();});
    vi.stubGlobal('fetch', fetcher);
    render('en', null);
    await settle();
    expect(switches().every(button => button.disabled)).toBe(true);
    expect(fetcher).toHaveBeenCalled();
});
it('retires an original owner action before a replacement scope can accept its late receipt', async () => {
    let signal: AbortSignal | undefined, finish!: (value: Response) => void, writes = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== 'POST')
            return page();
        writes++;
        signal = init.signal as AbortSignal;
        return new Promise<Response>(resolve => {
            finish = resolve;
        });
    }));
    render('en');
    await settle();
    await act(async () => switches()[0].click());
    await settle();
    render('en', other);
    await settle();
    expect(signal?.aborted).toBe(true);
    finish(Response.json({
        receipt: {
            kind: 'saved', ownerId: owner, id: DEMO_DNESKAI_AUDIO_TRACKS[0].id, requestedEnabled: false, expectedVersion: DEMO_DNESKAI_AUDIO_TRACKS[0].updatedAt, updatedAt: '2026-10-23T08:00:00.000001Z'
        }
    }));
    await settle();
    expect(writes).toBe(1);
    expect(switches()[0].getAttribute('aria-checked')).toBe('true');
});

it('keeps independent row actions and reverse-order receipts separate',async()=>{
 let reads=0;const calls:Array<{body:Record<string,unknown>;finish:(value:Response)=>void}>=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{if(init?.method!=='POST'){reads++;return page();}const body=JSON.parse(String(init.body));return new Promise<Response>(finish=>{calls.push({body,finish});});}));
 render('en');await settle();const baselineReads=reads;await act(async()=>{switches()[0].click();switches()[1].click();});await settle();expect(calls).toHaveLength(2);expect(switches().every(button=>button.disabled)).toBe(true);
 const finish=(index:number,updatedAt:string)=>{const {body,finish}=calls[index];finish(Response.json({receipt:{kind:'saved',ownerId:body.ownerId,id:body.id,expectedVersion:body.expectedVersion,requestedEnabled:body.enabled,updatedAt}}));};
 finish(1,'2026-10-23T08:05:00.000001Z');await settle();expect(switches()[0].disabled).toBe(true);expect(switches()[1].disabled).toBe(false);expect(switches()[1].getAttribute('aria-checked')).toBe('true');
 finish(0,'2026-10-23T08:00:00.000001Z');await settle();expect(switches().map(button=>button.getAttribute('aria-checked'))).toEqual(['false','true']);expect(reads).toBe(baselineReads);
});
