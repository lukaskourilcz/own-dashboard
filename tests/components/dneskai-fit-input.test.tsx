// @vitest-environment happy-dom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ fit: vi.fn(), dirty: vi.fn() }));
vi.mock('@/lib/marketing/dneskai-workspace-client', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/marketing/dneskai-workspace-client')>(), dneskaiWorkspaceApi: async () => ({ fit: m.fit }) }));
import { useDneskaiDraft } from '@/components/marketing/dneskai/lab/use-draft';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { setImageCrop, setSlideText } from '@/lib/marketing/dneskai-deck-editor';
import type { DneskaiFitRequest } from '@/lib/marketing/dneskai-lab';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement, current: ReturnType<typeof useDneskaiDraft>, post: DneskaiWorkspacePost, accountId: string;
function Harness() {
  const value = useDneskaiDraft(post, accountId, true, false, m.dirty); useLayoutEffect(() => { current = value; }); return null;
}
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T09:00:00Z')); m.fit.mockReset(); m.dirty.mockReset();
  m.fit.mockImplementation(async (input: DneskaiFitRequest) => ({ schemaVersion: 'dneskai-fit/1', kit: input.kit, slides: input.slides.map((_, index) => ({ index, fits: true, fields: [], codes: [] })) }));
  const read = createDneskaiWorkspaceFixture(new Date()); post = read.posts.find(row => row.status === 'review' && row.ready && row.deck)!; accountId = read.accounts[0]!.id;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); await act(async () => { root.render(<Harness />); }); await advance(300); expect(m.fit).toHaveBeenCalledOnce();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('does not repeat an identical fit request when only the picture crop changes', async () => {
  const input = structuredClone(m.fit.mock.calls[0]![0]), slot = current.draft.slides[0]!.slide.images[0]!.slot;
  await act(async () => current.setDraft(before => setImageCrop(before, 0, slot, { focal: { x: 0.8, y: 0.2 } })));
  expect(current.draft.slides[0]!.slide.images[0]!.crop?.focal).toEqual({ x: 0.8, y: 0.2 }); await advance(300);
  expect(m.fit.mock.lastCall![0]).toEqual(input); expect(current.fit.status).toBe('ready'); expect(m.fit).toHaveBeenCalledOnce();
});
it('does not repeat an identical fit request for alternative-text-only changes', async () => {
  const input = structuredClone(m.fit.mock.calls[0]![0]); await act(async () => current.setDraft(before => setSlideText(before, 0, 'alt', 'Updated alternative text'))); await advance(300);
  expect(m.fit.mock.lastCall![0]).toEqual(input); expect(m.fit).toHaveBeenCalledOnce();
});
it('marks changed text as checking immediately and keeps the existing debounce', async () => {
  await act(async () => current.setDraft(before => setSlideText(before, 0, 'headline', 'A different headline')));
  expect(current.fit).toEqual({ status: 'checking', result: null }); await advance(299); expect(m.fit).toHaveBeenCalledOnce(); await advance(1);
  expect(m.fit).toHaveBeenCalledTimes(2); expect(m.fit.mock.lastCall![0].slides[0].headline).toBe('A different headline'); expect(current.fit.status).toBe('ready');
});
it('keeps a pending fit alive through crop-only changes', async () => {
  let finish!: (value: unknown) => void; m.fit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => current.setDraft(before => setSlideText(before, 0, 'headline', 'A pending headline'))); await advance(300);
  const [input, signal] = m.fit.mock.lastCall!; const slot = current.draft.slides[0]!.slide.images[0]!.slot;
  await act(async () => current.setDraft(before => setImageCrop(before, 0, slot, { zoom: 1.2 })));
  expect(signal.aborted).toBe(false); await advance(300); expect(m.fit).toHaveBeenCalledTimes(2);
  await act(async () => finish({ schemaVersion: 'dneskai-fit/1', kit: input.kit, slides: input.slides.map((_: unknown, index: number) => ({ index, fits: true, fields: [], codes: [] })) })); expect(current.fit.status).toBe('ready');
});
it('cancels superseded text work and refuses its late feedback', async () => {
  let finish!: (value: unknown) => void; m.fit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => current.setDraft(before => setSlideText(before, 0, 'headline', 'First pending headline'))); await advance(300); const oldSignal = m.fit.mock.lastCall![1];
  await act(async () => current.setDraft(before => setSlideText(before, 0, 'headline', 'Second current headline'))); expect(oldSignal.aborted).toBe(true); expect(current.fit.result).toBeNull(); await advance(300);
  expect(current.fit.status).toBe('ready'); const accepted = current.fit.result;
  await act(async () => finish({ schemaVersion: 'dneskai-fit/1', kit: 'editorial', slides: [{ index: 0, fits: false, fields: [], codes: [] }] })); expect(current.fit.result).toBe(accepted); expect(m.fit).toHaveBeenCalledTimes(3);
});
it('refits kit and slide-order changes', async () => {
  await act(async () => current.setDraft(before => ({ ...before, kit: 'ticker' }))); expect(current.fit.result).toBeNull(); await advance(300); expect(m.fit.mock.lastCall![0].kit).toBe('ticker');
  const prior = structuredClone(m.fit.mock.lastCall![0]); await act(async () => current.setDraft(before => ({ ...before, slides: [...before.slides].reverse() }))); await advance(300);
  expect(m.fit).toHaveBeenCalledTimes(3); expect(m.fit.mock.lastCall![0].slides).toEqual([...prior.slides].reverse());
});
it('retains an invalid draft without crashing or sending it, then fits its repair', async () => {
  await act(async () => current.setDraft(before => setSlideText(before, 0, 'headline', 'x'.repeat(201))));
  expect(current.fit).toEqual({ status: 'unavailable', result: null }); expect(current.draft.slides[0]!.slide.headline).toHaveLength(201); await advance(300); expect(m.fit).toHaveBeenCalledOnce();
  await act(async () => current.setDraft(before => setSlideText(before, 0, 'headline', 'Repaired headline'))); expect(current.fit.status).toBe('checking'); await advance(300); expect(current.fit.status).toBe('ready'); expect(m.fit).toHaveBeenCalledTimes(2);
});
it('updates original-slot expiry while open without replacing the current private draft', async () => {
  post = { ...post, scheduledAt: new Date(Date.now() + 120_000).toISOString() };
  await act(async () => { root.render(<Harness key="future-slot" />); });
  expect(current.expired).toBe(false); const scheduled = current.draft.scheduledLocal;
  await act(async () => current.setDraft(before => ({ ...before, caption: 'Retained unsaved caption' })));
  await advance(61_000); await act(async () => { root.render(<Harness key="future-slot" />); });
  expect(current.expired).toBe(true); expect(current.draft.scheduledLocal).toBe(scheduled); expect(current.draft.caption).toBe('Retained unsaved caption');
});
