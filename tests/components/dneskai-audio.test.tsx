// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
import { DneskaiAudioPicker } from '@/components/marketing/dneskai/lab/audio-picker';
import { DneskaiAudioLibrary } from '@/components/marketing/dneskai-audio-library';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { DEMO_DNESKAI_AUDIO_TRACKS, dneskaiAudioFileProblem } from '@/lib/marketing/dneskai-audio-client';
import type { DneskaiAudioTrack } from '@/lib/marketing/dneskai-audio-contracts';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); });
const render = (node: React.ReactNode) => act(() => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
const settle = () => act(async () => { await new Promise(done => setTimeout(done, 20)); });
const track = (patch: Partial<DneskaiAudioTrack>): DneskaiAudioTrack => ({ ...DEMO_DNESKAI_AUDIO_TRACKS[0]!, ...patch });
const library = (tracks: DneskaiAudioTrack[] | null) => vi.stubGlobal('fetch', vi.fn(async () => tracks === null ? new Response('{"error":"not-found"}', { status: 404 }) : Response.json({ tracks })));

describe('Lab audio picker (#164)', () => {
  it.each(['en', 'cs'] as const)('offers the rotation and every enabled track with artist and length (%s)', async (lang) => {
    library([track({ id: '11111111-1111-4111-8111-111111111111', title: 'One', previewUrl: 'https://test-only.supabase.co/one.mp3' }), track({ id: '22222222-2222-4222-8222-222222222222', title: 'Off', enabled: false })]);
    render(<DneskaiAudioPicker value={null} onChange={() => {}} preview={false} lang={lang} />); await settle();
    const options = [...container.querySelectorAll('option')].map((option) => option.textContent);
    expect(options).toEqual([dneskaiAudio[lang].picker.rotation(null), 'One · Sample artist · 1:12']);
    expect(container.querySelector('label')?.textContent).toBe(dneskaiAudio[lang].picker.label);
  });

  it('reports a choice and keeps a chosen track that was switched off later, with its preview', async () => {
    library([track({ id: '11111111-1111-4111-8111-111111111111', title: 'One' }), track({ id: '22222222-2222-4222-8222-222222222222', title: 'Chosen', enabled: false, previewUrl: 'https://test-only.supabase.co/c.mp3' })]);
    const onChange = vi.fn();
    render(<DneskaiAudioPicker value="22222222-2222-4222-8222-222222222222" onChange={onChange} preview={false} lang="en" />); await settle();
    const select = container.querySelector('select')!;
    expect(select.value).toBe('22222222-2222-4222-8222-222222222222');
    expect(container.querySelector(`button[aria-label="${dneskaiAudio.en.play('Chosen')}"]`)).not.toBeNull();
    act(() => { select.value = '11111111-1111-4111-8111-111111111111'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    act(() => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('is hidden while Reels are switched off', async () => {
    library(null);
    render(<DneskaiAudioPicker value={null} onChange={() => {}} preview={false} lang="en" />); await settle();
    expect(container.innerHTML).toBe('');
  });

  it('says the library is empty instead of offering nothing', async () => {
    library([]);
    render(<DneskaiAudioPicker value={null} onChange={() => {}} preview={false} lang="cs" />); await settle();
    expect(container.textContent).toContain(dneskaiAudio.cs.picker.none);
    expect(container.querySelector('select')?.disabled).toBe(true);
  });
});

describe('Zdroje → Hudba (#164)', () => {
  it.each(['en', 'cs'] as const)('lists tracks with source, licence, source page and a labelled switch (%s)', async (lang) => {
    library([track({ title: 'Quiet Circuit' })]);
    render(<DneskaiAudioLibrary lang={lang} />); await settle();
    const t = dneskaiAudio[lang];
    for (const text of [t.title, 'Quiet Circuit', t.sources.pixabay, 'Pixabay Content License (sample)', t.sourcePage, t.upload.title]) expect(container.textContent).toContain(text);
    expect(container.querySelector(`[role="switch"][aria-label="${t.enable('Quiet Circuit')}"]`)).not.toBeNull();
    expect(container.querySelector('a[href="https://pixabay.com/music/"]')?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows sample tracks without an upload form in the preview, and nothing while switched off', async () => {
    render(<DneskaiAudioLibrary lang="en" preview />); await settle();
    expect(container.querySelectorAll('[data-testid="dneskai-audio-track"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="dneskai-audio-upload"]')).toBeNull();
    act(() => root.unmount()); root = createRoot(container); client.clear();
    library(null);
    render(<DneskaiAudioLibrary lang="en" />); await settle();
    expect(container.innerHTML).toBe('');
  });

  it('refuses a wrong file before anything is sent', () => {
    expect(dneskaiAudioFileProblem(null)).toBe('fileMissing');
    expect(dneskaiAudioFileProblem({ type: 'video/mp4', size: 10 })).toBe('fileType');
    expect(dneskaiAudioFileProblem({ type: 'audio/mpeg', size: 21 * 1024 * 1024 })).toBe('fileSize');
    expect(dneskaiAudioFileProblem({ type: 'audio/mpeg', size: 1024 })).toBeNull();
  });
});
