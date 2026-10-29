// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DneskaiAudioLibrary } from '@/components/marketing/dneskai-audio-library';
import { NavigationGuardProvider, useGuardedNavigation } from '@/components/navigation-guard';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { qk } from '@/lib/queries/keys';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { common } from '@/lib/i18n/sections/common';
const m = vi.hoisted(() => ({ factory: vi.fn(), run: vi.fn(), leave: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/marketing/dneskai-audio-client', async (original) => ({ ...await original<typeof import('@/lib/marketing/dneskai-audio-client')>(), createDneskaiAudioUploadSession: (...args: unknown[]) => m.factory(...args) }));
(globalThis as {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', t = dneskaiAudio.en;
let root: Root, host: HTMLDivElement, client: QueryClient;
function Leave() {
    const navigate = useGuardedNavigation();
    return <button onClick={() => navigate(m.leave)}>TEST_ONLY_LEAVE</button>;
}
const render = (ownerId = owner) => act(() => root.render(<StrictMode><QueryClientProvider client={client}><NavigationGuardProvider><OwnerPreferencesProvider ownerId={ownerId}><DneskaiAudioLibrary lang="en"/></OwnerPreferencesProvider><Leave /></NavigationGuardProvider></QueryClientProvider></StrictMode>));
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.trim() === label)!;
const form = () => document.querySelector<HTMLFormElement>('[data-testid="dneskai-audio-upload"]')!;
const input = (key: string) => form().querySelector<HTMLInputElement>(`input[id$="-${key}"]`)!;
const fill = (key: string, value: string) => {
    const el = input(key);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = () => form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const settle = () => act(async () => {
    for (let i = 0; i < 4; i++)
        await new Promise(resolve => setTimeout(resolve, 10));
});
beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({tracks:[],trends:[],trendsStatus:'disabled',nextOffset:null})));
    document.documentElement.lang = 'en';
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData([...qk.dneskaiAudio, false, 'pages'], { pages: [{ tracks: [], trends: [], trendsStatus: 'disabled', nextOffset: null }], pageParams: [0] });
    m.factory.mockImplementation(() => ({ run: m.run }));
    render();
    await settle();
    act(() => button(t.upload.title).click());
    await settle();
    act(() => {
        const file = input('file');
        Object.defineProperty(file, 'files', { configurable: true, value: [new File(['fixture'], 'fixture.mp3', { type: 'audio/mpeg' })] });
        file.dispatchEvent(new Event('change', { bubbles: true }));
        fill('title', 'Fixture title');
        fill('artist', 'Fixture artist');
        fill('sourceUrl', 'https://example.test/audio');
        fill('licenceNote', 'Own fixture recording');
    });
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    client.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
it('captures same-frame edits once and protects an immediate pending exit', async () => {
    let finish!: (value: unknown) => void;
    m.run.mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    act(() => {
        fill('title', 'Immediate title');
        submit();
        submit();
        button('TEST_ONLY_LEAVE').click();
    });
    await settle();
    expect(m.factory).toHaveBeenCalledOnce();
    expect(m.factory.mock.calls[0][2].title).toBe('Immediate title');
    expect(m.run).toHaveBeenCalledOnce();
    expect(m.leave).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(common.en.unsaved.pendingTitle);
    expect(button(common.en.unsaved.discard).disabled).toBe(true);
    expect(input('title').disabled).toBe(true);
    act(() => button(common.en.unsaved.stay).click());
    finish({ title: 'Immediate title' });
    await settle();
    expect(input('title').value).toBe('');
    expect(input('licenceNote').value).toBe('');
});
it('retains a failed original session until retry or explicit memory-only discard', async () => {
    m.run.mockRejectedValue(new Error('TEST_ONLY_PRIVATE_DETAIL'));
    act(() => submit());
    await settle();
    expect(m.factory).toHaveBeenCalledOnce();
    expect(input('title').readOnly).toBe(true);
    expect(input('title').disabled).toBe(false);
    expect(input('file').disabled).toBe(true);
    expect(document.body.textContent).toContain(t.upload.retained);
    act(() => {
        fill('title', 'Unaccepted edit');
        submit();
    });
    await settle();
    expect(m.factory).toHaveBeenCalledOnce();
    expect(m.run).toHaveBeenCalledTimes(2);
    expect(input('title').value).toBe('Fixture title');
    act(() => button(t.upload.discard).click());
    expect(input('title').value).toBe('');
    expect(input('licenceNote').value).toBe('');
    expect(input('file').disabled).toBe(false);
    expect(input('file')).toBe(document.activeElement);
});
it('retires the original owner and ignores a late completion before cache invalidation', async () => {
    let finish!: (value: unknown) => void;
    m.run.mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    act(() => submit());
    await settle();
    const scope = m.factory.mock.calls[0][0];
    expect(scope.ownerId).toBe(owner);
    render(other);
    expect(scope.signal.aborted).toBe(true);
    finish({ title: 'Old private title' });
    await settle();
    expect(invalidate).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Old private title');
});
