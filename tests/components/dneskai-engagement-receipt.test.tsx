// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiPublishedTab } from '@/components/marketing/dneskai/published-tab';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => {
  // eslint-disable-next-line @next/next/no-img-element -- test double for next/image
  return <img src={String(props.src)} alt={String(props.alt ?? '')} />;
} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient(); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); });
const render = (read = createDneskaiWorkspaceFixture(new Date()), lang: 'en' | 'cs' = 'en') =>
  act(() => root.render(<QueryClientProvider client={client}><DneskaiPublishedTab read={read} lang={lang} preview refreshing={false} onRefresh={() => {}} /></QueryClientProvider>));

describe('keyword comment receipts in Příspěvky (#162)', () => {
  it.each(['en', 'cs'] as const)('shows the seven-day totals and the published post’s receipt with its failure by code (%s)', (lang) => {
    const t = dneskaiWorkspace[lang].engagementReceipts;
    render(undefined, lang);
    const summary = container.querySelector('[data-testid="dneskai-engagement-summary"]')!;
    expect(summary.textContent).toContain(t.summary(7));
    for (const text of [t.comments, '48', t.matches, '17', t.sent, '16', t.publicSent, t.failed]) expect(summary.textContent).toContain(text);
    const receipts = container.querySelectorAll('[data-testid="dneskai-engagement-receipt"]');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.closest('[data-testid="dneskai-post-row"]')!.getAttribute('data-state')).toBe('published');
    expect(receipts[0]!.textContent).toContain(t.failure(1));
    expect(receipts[0]!.querySelector('time')).not.toBeNull();
  });
  it('shows neither while the watcher is off', () => {
    const read = createDneskaiWorkspaceFixture(new Date());
    delete read.engagementSummary;
    for (const post of read.posts) delete post.engagementReceipt;
    render(read);
    expect(container.querySelector('[data-testid="dneskai-engagement-summary"]')).toBeNull();
    expect(container.querySelector('[data-testid="dneskai-engagement-receipt"]')).toBeNull();
  });
});
