// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiPostEditor } from '@/components/marketing/dneskai/post-editor';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import type { DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
// A plain element stands in for next/image; the editor only needs its src, size and alt.
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => {
  const rest = Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'unoptimized'));
  // eslint-disable-next-line @next/next/no-img-element -- test double for next/image
  return <img {...(rest as object)} alt={String(props.alt ?? '')} />;
} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = dneskaiWorkspace.en;
const project = '22222222-2222-4222-8222-222222222222';
let container: HTMLDivElement; let root: Root; let client: QueryClient; let read: DneskaiWorkspaceRead;
let posted: unknown[];
const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 20)); });

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  read = createDneskaiWorkspaceFixture(new Date());
  posted = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/marketing/dneskai/media')) return Response.json({ schemaVersion: 'dneskai-media/1', candidates: [] });
    if (url === '/api/marketing/revisions') {
      posted.push(JSON.parse(String(init?.body)));
      return Response.json({ id: 'd0e5ca10-0000-4000-8000-0000000000ff', ready: false, contentHash: 'f'.repeat(64),
        render: { status: 'refused', problems: [{ slide: 0, code: 'text-clipped', blocking: true, message: 'cut', field: 'headline' }] } });
    }
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

function open(postIndex: number, slide = 0, onSaved = vi.fn(), extra: { onRenderFailed?: (id: string, previousId: string) => void; renderFailed?: ReadonlySet<string>; postId?: string } = {}) {
  const post = read.posts[postIndex]!;
  act(() => root.render(<QueryClientProvider client={client}>
    <DneskaiPostEditor open onOpenChange={() => {}} postId={extra.postId ?? post.id} initialSlide={slide} read={read} projectId={project} lang="en" preview={false}
      onSaved={onSaved} onApprove={async () => true} approving={false} onRenderFailed={extra.onRenderFailed} renderFailed={extra.renderFailed} />
  </QueryClientProvider>));
  return post;
}
const editor = () => document.querySelector<HTMLElement>('[data-testid="dneskai-slide-editor"]')!;
const labelled = (scope: HTMLElement, label: string) => { const node = [...scope.querySelectorAll('label')].find((item) => item.textContent === label); return node ? document.getElementById(node.htmlFor) as HTMLInputElement | HTMLTextAreaElement : null; };
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!;
  act(() => { setter.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
const select = (index: number) => act(() => { document.querySelectorAll<HTMLButtonElement>(`[aria-label="${t.editor.select(index)}"]`)[0]!.click(); });

describe('DNESKAi post editor (#119)', () => {
  it('offers only the fields each slide type draws, each with its template limit', async () => {
    open(0); await settle();
    const fields = () => [...editor().querySelectorAll('label')].map((label) => label.textContent).filter((text) => text !== t.fields.alt && text !== t.editor.zoom);
    expect(fields()).toEqual([t.fields.headline, t.fields.kicker, t.fields.credit]);
    expect(editor().textContent).toContain('/ 110');
    select(2); expect(fields()).toEqual([t.fields.headline, t.fields.body, t.fields.credit]);
    select(3); expect(fields()).toEqual([t.fields.headline, t.fields.body, t.fields.kicker, t.fields.credit]);
    expect(editor().textContent).toContain('/ 28');
    select(4); expect(fields()).toEqual([t.fields.headline, t.fields.body]);
    expect(editor().textContent).toContain('/ 170');
    select(5); expect(fields()).toEqual([]); expect(editor().textContent).toContain(t.editor.noText);
  });

  it('counts characters, says how far over the limit a field is and marks it invalid', async () => {
    open(0); await settle();
    const headline = labelled(editor(), t.fields.headline)!;
    type(headline, 'x'.repeat(115));
    expect(headline.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(headline.getAttribute('aria-describedby')!.split(' ')[0]!)!.textContent).toBe(`115 / 110 · ${t.over(5)}`);
    type(headline, 'Krátký titulek');
    expect(headline.getAttribute('aria-invalid')).toBeNull();
  });

  it('moves the focal point with the arrow keys and Home, and reads it out', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/marketing/dneskai/media')
      ? Response.json({ schemaVersion: 'dneskai-media/1', candidates: [{ candidateId: 'ukazka-blog-1', sourceId: 'x', title: 'x', url: 'https://www.example.com/x', candidateStatus: 'selected', captionOnly: false, mediaType: null, collection: null,
        assets: [{ assetId: '00000000-0000-4000-8000-000000000001', sha256: read.posts[0]!.deck!.slides[0]!.images[0]!.assetSha256, position: 0, originKind: 'og-image', originUrl: 'https://www.example.com/a.jpg', credit: 'Foto: x', width: 1600, height: 1200,
          mime: 'image/jpeg', bytes: 1, fetchedAt: '2026-10-20T00:00:00Z', fullBleedCapable: true, insetCapable: true, duplicateOfAssetId: null, duplicateOfSha256: null, purged: false, previewUrl: 'https://example.supabase.co/preview.jpg' }] }] })
      : new Response('{}', { status: 404 })));
    open(0); await settle();
    const picker = document.querySelector<HTMLElement>('[data-testid="dneskai-focal-picker"]')!;
    expect(picker).not.toBeNull();
    const readout = () => document.getElementById(picker.getAttribute('aria-describedby')!.split(' ')[1]!)!.textContent;
    expect(readout()).toBe(t.editor.focalValue(42, 55));
    const press = (key: string) => act(() => { picker.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
    press('ArrowRight'); press('ArrowRight'); press('ArrowDown');
    expect(readout()).toBe(t.editor.focalValue(46, 57));
    press('ArrowLeft'); press('ArrowUp'); press('ArrowUp');
    expect(readout()).toBe(t.editor.focalValue(44, 53));
    press('Home');
    expect(readout()).toBe(t.editor.focalValue(50, 50));
    for (let index = 0; index < 40; index += 1) press('ArrowLeft');
    expect(readout()).toBe(t.editor.focalValue(0, 50));
  });

  it('submits exactly the changed fields, the order and the removals, then switches to the new version', async () => {
    const onSaved = vi.fn();
    const post = open(0, 0, onSaved); await settle();
    type(labelled(editor(), t.fields.headline)!, 'Benchmark čtěte s metodikou');
    act(() => { document.querySelector<HTMLButtonElement>(`[aria-label="${t.editor.moveDown}: ${t.card.problemSlide(2)}"]`)!.click(); });
    act(() => { document.querySelector<HTMLButtonElement>(`[aria-label="${t.editor.remove}: ${t.card.problemSlide(5)}"]`)!.click(); });
    const main = document.querySelector<HTMLButtonElement>('[data-testid="dneskai-editor-main"]')!;
    expect(main.textContent).toBe(t.editor.save);
    await act(async () => { main.click(); await new Promise((done) => setTimeout(done, 20)); });
    expect(posted).toEqual([{ action: 'edit', id: post.id, caption: post.caption, scheduledAt: post.scheduledAt,
      deck: { slides: [{ from: 0, headline: 'Benchmark čtěte s metodikou' }, { from: 2 }, { from: 1 }, { from: 3 }] } }]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'd0e5ca10-0000-4000-8000-0000000000ff', ready: false }), post.id);
    expect(document.body.textContent).toContain(t.editor.savedBlocked);
    // Switched to the new version, which this read does not hold yet: the editor waits for it instead of showing the old one.
    act(() => root.render(<QueryClientProvider client={client}>
      <DneskaiPostEditor open onOpenChange={() => {}} postId="d0e5ca10-0000-4000-8000-0000000000ff" initialSlide={0} read={read} projectId={project} lang="en" preview={false}
        onSaved={onSaved} onApprove={async () => true} approving={false} />
    </QueryClientProvider>));
    expect(document.body.textContent).toContain(t.editor.waiting);
  });

  it('after a render that did not attach, reads the review again and moves to the saved version', async () => {
    const saved = 'd0e5ca10-0000-4000-8000-0000000000fe';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/marketing/dneskai/media')) return Response.json({ schemaVersion: 'dneskai-media/1', candidates: [] });
      posted.push(JSON.parse(String(init?.body)));
      return Response.json({ id: saved, ready: false, error: 'render-attach-failed' }, { status: 502 });
    }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const onRenderFailed = vi.fn(); const onSaved = vi.fn();
    const post = open(0, 0, onSaved, { onRenderFailed }); await settle();
    type(labelled(editor(), t.fields.headline)!, 'Benchmark čtěte s metodikou');
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="dneskai-editor-main"]')!.click(); await new Promise((done) => setTimeout(done, 20)); });
    expect(onSaved).not.toHaveBeenCalled();
    expect(onRenderFailed).toHaveBeenCalledWith(saved, post.id);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['marketing', 'dneskai-review', project] });
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('its slides were not attached');
  });

  it('offers Render again for a version whose slides never attached and sends it unchanged', async () => {
    const stuck = read.posts.findIndex((item) => item.title === 'Co stojí jeden dotaz');
    const post = open(stuck); await settle();
    expect(document.body.textContent).toContain(t.states.problem);
    expect(document.body.textContent).toContain('its slides were not attached');
    const main = document.querySelector<HTMLButtonElement>('[data-testid="dneskai-editor-main"]')!;
    expect(main.textContent).toBe(t.editor.rerender);
    await act(async () => { main.click(); await new Promise((done) => setTimeout(done, 20)); });
    expect(posted).toEqual([{ action: 'edit', id: post.id, caption: post.caption, scheduledAt: post.scheduledAt }]);
  });

  it('reads a version this session saw fail as a problem at once, and follows the successor of a replaced version', async () => {
    const fresh = read.posts.findIndex((item) => item.title === 'Lokální model na notebooku');
    const post = open(fresh); await settle();
    expect(document.body.textContent).toContain(t.states.preparing); expect(document.body.textContent).toContain(t.card.notRendered);
    expect(document.querySelector('[data-testid="dneskai-editor-main"]')!.textContent).toContain(t.card.approve);
    open(fresh, 0, vi.fn(), { renderFailed: new Set([post.id]) }); await settle();
    expect(document.body.textContent).toContain(t.states.problem);
    expect(document.body.textContent).toContain(t.card.renderFailed); expect(document.body.textContent).not.toContain(t.card.notRendered);
    expect(document.querySelector('[data-testid="dneskai-editor-main"]')!.textContent).toBe(t.editor.rerender);
    // The open version was superseded by a save that then timed out: the editor shows its successor.
    read = { ...read, posts: read.posts.map((item) => item.id === post.id ? { ...item, replacesId: 'd0e5ca10-0000-4000-8000-0000000000fd' } : item) };
    open(fresh, 0, vi.fn(), { postId: 'd0e5ca10-0000-4000-8000-0000000000fd' }); await settle();
    expect(document.body.textContent).toContain(post.title);
    expect(document.body.textContent).not.toContain(t.editor.waiting);
  });

  it('refuses to send a draft the editor can see is wrong and names the slide and field', async () => {
    open(0); await settle();
    type(labelled(editor(), t.fields.headline)!, '');
    const main = document.querySelector<HTMLButtonElement>('[data-testid="dneskai-editor-main"]')!;
    await act(async () => { main.click(); await new Promise((done) => setTimeout(done, 10)); });
    expect(posted).toEqual([]);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain(`${t.card.problemSlide(1)} · ${t.fields.headline} ${t.draftProblems['text-missing']}`);
  });
});
