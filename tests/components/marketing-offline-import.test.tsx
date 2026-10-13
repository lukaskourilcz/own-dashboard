// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OfflineDraftImport } from '@/components/marketing/offline-import';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const envelope = (id: string) => ({ campaignId: '11111111-1111-4111-8111-111111111111', entryId: id, entryVersion: 0, date: '2026-10-18', role: 'carousel' });
async function select() {
  const files = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'].map(id => new File([JSON.stringify(envelope(id))], `${id}.json`, { type: 'application/json' }));
  const input = container.querySelector('input')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
}
it('keeps preview mode disabled and explains draft-only import in Czech', () => {
  act(() => root.render(<OfflineDraftImport lang="cs" disabled onImported={vi.fn()}/>));
  expect(container.querySelector('input')?.disabled).toBe(true);
  expect(container.textContent).toContain('nic neschvaluje ani nepublikuje');
});
it('only transmits after owner clicks save, and stops the batch at first failure', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false }); vi.stubGlobal('fetch', fetcher);
  const onImported = vi.fn();
  act(() => root.render(<OfflineDraftImport lang="en" onImported={onImported}/>));
  await select(); expect(fetcher).not.toHaveBeenCalled(); expect(container.textContent).toContain('2 drafts');
  await act(async () => { container.querySelector('button')!.click(); });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(onImported).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Saved 0 drafts'); expect(container.textContent).toContain('not retried automatically');
});
it('retains the failed and remaining files while refreshing a partially imported batch', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false }); vi.stubGlobal('fetch', fetcher);
  const onImported = vi.fn();
  act(() => root.render(<OfflineDraftImport lang="en" onImported={onImported}/>));
  await select(); await act(async () => { container.querySelector('button')!.click(); });
  expect(fetcher).toHaveBeenCalledTimes(2); expect(onImported).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Saved 1 drafts'); expect(container.textContent).toContain('1 drafts ·');
});
it('lets the owner stop after an in-flight draft without starting the next one', async () => {
  let finish!: (value: { ok: boolean }) => void;
  const pending = new Promise<{ ok: boolean }>(resolve => { finish = resolve; });
  const fetcher = vi.fn().mockReturnValue(pending); vi.stubGlobal('fetch', fetcher);
  const onImported = vi.fn();
  act(() => root.render(<OfflineDraftImport lang="en" onImported={onImported}/>));
  await select(); act(() => { container.querySelector('button')!.click(); });
  act(() => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Stop after this draft')!.click(); });
  await act(async () => { finish({ ok: true }); await pending; });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(onImported).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Import stopped. Saved 1 drafts');
});
