// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiTopicsList } from '@/components/marketing/dneskai/lab/topics-list';
import { resetDemoDneskaiTopics } from '@/lib/demo/dneskai-topics-demo';
import { demoTopicId } from '@/lib/demo/dneskai-topics-fixtures';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { dneskaiTopicsKey } from '@/lib/marketing/dneskai-topics-client';
import type { DneskaiTopicsRead } from '@/lib/marketing/dneskai-topics';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = dneskaiLab.en.topics;
const project = 'proj-dneskai';
let container: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { resetDemoDneskaiTopics(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const wait = (ms = 300) => act(async () => { await new Promise((done) => setTimeout(done, ms)); });
/** Renders the list and waits for its first read (the preview demo is a dynamic import, slow on a loaded machine). */
const show = async (preview = true) => {
  act(() => root.render(<QueryClientProvider client={client}><DneskaiTopicsList projectId={project} lang="en" preview={preview} /></QueryClientProvider>));
  for (let tries = 0; tries < 50 && client.getQueryState(dneskaiTopicsKey(project))?.status !== 'success'; tries += 1) await wait(100);
  await wait(50);
};
const row = (n: number) => container.querySelector<HTMLElement>(`[data-topic-row="${demoTopicId(n)}"]`);
const button = (scope: ParentNode, name: string) => [...scope.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === name || item.textContent === name);
const statusOf = (n: number) => {
  const read = client.getQueryData<DneskaiTopicsRead>(dneskaiTopicsKey(project))!;
  for (const kind of ['news', 'education'] as const) for (const [status, topics] of Object.entries(read.groups[kind])) if (topics.some((topic) => topic.id === demoTopicId(n))) return status;
  return null;
};
const press = (target: HTMLElement, key: string) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });

describe('DNESKAi topics list (#154)', () => {
  it('groups proposed topics by News and Education with source, verdict and keyword', async () => {
    await show();
    const section = container.querySelector('[data-testid="dneskai-topics"]')!;
    expect(section.textContent).toContain(t.title);
    const lists = [...section.querySelectorAll('ul[aria-label]')].map((list) => list.getAttribute('aria-label'));
    expect(lists).toEqual([t.listLabel('News'), t.listLabel('Education')]);
    expect(row(4)!.textContent).toContain('@ukazkovy.tvurce');
    expect(row(4)!.textContent).toContain(t.verdict.fact);
    expect(row(4)!.textContent).toContain('#PRIKAZY');
    expect(row(3)!.textContent).toContain(t.approved);
    expect(button(row(3)!, `${t.approve}: ${row(3)!.querySelector('p')!.textContent}`)).toBeUndefined();
  });

  it('approves and rejects one topic with an optimistic update', async () => {
    await show();
    act(() => button(row(1)!, `${t.approve}: ${row(1)!.querySelector('p')!.textContent}`)!.click());
    // Moved before the demo server (80 ms) answers, then confirmed by its answer.
    await wait(20);
    expect(statusOf(1)).toBe('approved');
    await wait();
    expect(statusOf(1)).toBe('approved');
    expect(container.textContent).toContain(t.done.approve(1));
    act(() => button(row(2)!, `${t.reject}: ${row(2)!.querySelector('p')!.textContent}`)!.click());
    await wait();
    expect(statusOf(2)).toBe('rejected');
    expect(row(2)).toBeNull();
  });

  it('restores a rejected or expired topic from the disclosure', async () => {
    await show();
    const archive = container.querySelector('[data-testid="dneskai-topics-archive"]')!;
    expect(archive.querySelector('summary')!.textContent).toBe(t.archive(2));
    act(() => [...archive.querySelectorAll('button')].find((item) => item.getAttribute('aria-label')?.includes('zamítnutý'))!.click());
    await wait();
    expect(statusOf(8)).toBe('proposed');
    expect(row(8)).not.toBeNull();
  });

  it('approves the selected topics at once', async () => {
    await show();
    for (const n of [1, 5]) act(() => row(n)!.querySelector<HTMLButtonElement>('button[role="checkbox"]')!.click());
    const bulk = container.querySelector<HTMLButtonElement>('[data-testid="dneskai-topics-approve-selected"]')!;
    expect(bulk.textContent).toBe(t.approveSelected(2));
    act(() => bulk.click());
    await wait();
    expect([statusOf(1), statusOf(5)]).toEqual(['approved', 'approved']);
    expect(container.textContent).toContain(t.done.approve(2));
    expect(container.querySelector('[data-testid="dneskai-topics-approve-selected"]')).toBeNull();
  });

  it('moves with the arrow keys, approves with A and rejects with Z', async () => {
    await show();
    const first = row(1)!;
    expect(first.tabIndex).toBe(0);
    act(() => first.focus());
    press(first, 'ArrowDown');
    expect(document.activeElement).toBe(row(2));
    press(row(2)!, 'a');
    await wait();
    expect(statusOf(2)).toBe('approved');
    press(row(2)!, 'ArrowDown');
    expect(document.activeElement).toBe(row(3));
    press(row(3)!, 'z');
    await wait();
    expect(statusOf(3)).toBe('rejected');
  });

  it('edits the keyword and refuses one that is not a single Latin word', async () => {
    await show();
    act(() => button(row(5)!, t.keyword.edit('Prompt'))!.click());
    const input = row(5)!.querySelector('input')!;
    const set = (value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
    set('dvě slova');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(button(row(5)!, t.keyword.save)!.disabled).toBe(true);
    set('Zkratky');
    act(() => button(row(5)!, t.keyword.save)!.click());
    await wait();
    expect(row(5)!.textContent).toContain('#Zkratky');
    expect(container.textContent).toContain(t.done.edit);
  });

  it('shows the empty state with the last search time', async () => {
    await show();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      act(() => button(row(n)!, `${t.reject}: ${row(n)!.querySelector('p')!.textContent}`)!.click());
      await wait();
    }
    const empty = container.querySelector('[data-testid="dneskai-topics-empty"]')!;
    expect(empty.textContent).toContain(t.empty);
    expect(empty.textContent).toMatch(/Last search: /);
  });

  it('renders nothing while the server has topics off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not-found' }), { status: 404 })));
    await show(false);
    expect(container.innerHTML).toBe('');
  });

  it('rolls back and says so when the action fails', async () => {
    let calls = 0;
    const { createDneskaiTopicsFixture } = await import('@/lib/demo/dneskai-topics-fixtures');
    vi.stubGlobal('fetch', vi.fn(async () => (calls += 1) === 1 ? new Response(JSON.stringify(createDneskaiTopicsFixture(new Date())), { status: 200 })
      : calls === 2 ? new Response(JSON.stringify({ error: 'dneskai-topics-unavailable' }), { status: 503 }) : new Response(JSON.stringify(createDneskaiTopicsFixture(new Date())), { status: 200 })));
    await show(false);
    act(() => button(row(1)!, `${t.approve}: ${row(1)!.querySelector('p')!.textContent}`)!.click());
    await wait();
    expect(statusOf(1)).toBe('proposed');
    expect(container.textContent).toContain(t.failed);
  });
});
