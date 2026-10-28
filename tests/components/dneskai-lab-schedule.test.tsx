// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DneskaiLabTab } from '@/components/marketing/dneskai/lab/lab-tab';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { dneskaiLabDeadline, dneskaiLabDay } from '@/lib/marketing/dneskai-lab';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
const m = vi.hoisted(() => ({ api: vi.fn(), approve: vi.fn(), loadMedia: vi.fn(async () => ({ candidates: [] })), fit: vi.fn(async () => ({})) }));
vi.mock('@/lib/marketing/dneskai-workspace-client', async importOriginal => ({ ...await importOriginal<object>(), dneskaiWorkspaceApi: m.api }));
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => {
  const rest = Object.fromEntries(Object.entries(props).filter(([key]) => !['unoptimized', 'priority'].includes(key)));
  // eslint-disable-next-line @next/next/no-img-element -- deterministic image load events
  return <img {...rest} alt={String(props.alt ?? '')} />;
} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, client: QueryClient;
const read = createDneskaiWorkspaceFixture(new Date('2026-10-28T09:00:00Z'));
const post = read.posts[0]!, at = Date.parse(post.scheduledAt);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at - 120_000); vi.clearAllMocks(); m.fit.mockRejectedValue(new Error('TEST_ONLY_FIT_OFFLINE')); m.api.mockResolvedValue(m); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('TEST_ONLY_NETWORK_DISABLED')));
  window.history.replaceState(null, '', `/?labPost=${post.id}`);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(lang: 'en' | 'cs' = 'en') {
  const current = { ...structuredClone(read), generatedAt: new Date().toISOString(), accounts: read.accounts.map(account => ({ ...account, enabled: true })) };
  await act(async () => { root.render(<QueryClientProvider client={client}><TooltipProvider><DneskaiLabTab read={current} projectId="dneskai" lang={lang} preview={false} refreshing={false} onRefresh={() => {}} renderFailed={new Set()} addRenderFailed={() => {}} /></TooltipProvider></QueryClientProvider>); });
  await act(async () => { host.querySelectorAll('img').forEach(image => image.dispatchEvent(new Event('load'))); });
  const button = host.querySelector<HTMLButtonElement>('[data-testid="dneskai-lab-approve"]')!; expect(button.disabled).toBe(false); return button;
}
it('treats the exact saved instant as passed, retaining a genuinely future instant', () => {
  expect(dneskaiLabDeadline(post.scheduledAt, at - 1).passed).toBe(false);
  expect(dneskaiLabDeadline(post.scheduledAt, at)).toMatchObject({ passed: true, urgent: false });
  expect(dneskaiLabDay(read, post.scheduledAt.slice(0, 10), at).approvable.some(row => row.id === post.id)).toBe(false);
});
for (const lang of ['en', 'cs'] as const) it(`withholds elapsed scheduled approval while retaining rescheduling actions (${lang})`, async () => {
  const approve = await mount(lang); await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(approve.disabled).toBe(true);
  const description = approve.getAttribute('aria-describedby'); expect(description).toBeTruthy(); expect(document.getElementById(description!)?.textContent).toBe(dneskaiLab[lang].actions.scheduleExpired);
  const publish = host.querySelector<HTMLButtonElement>('[data-testid="dneskai-lab-publish-now"]')!; expect(publish.disabled).toBe(false);
  expect(host.textContent).toContain(dneskaiLab[lang].actions.publishNow);
  expect(m.approve).not.toHaveBeenCalled();
});
it('rechecks the actual time before approving between shared-clock renders', async () => {
  const approve = await mount(); vi.setSystemTime(at);
  await act(async () => { approve.click(); });
  expect(m.approve).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
});

it('rechecks time after asynchronous API setup before admitting approval', async () => {
  const approve = await mount(); let resolve!: (api: typeof m) => void; m.api.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await act(async () => { approve.click(); }); vi.setSystemTime(at);
  await act(async () => { resolve(m); }); expect(m.approve).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
});
