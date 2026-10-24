// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { common } from '@/lib/i18n/sections/common';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }), useDict: () => ({ common: { unsaved: common.en.unsaved } }) }));
import { NavigationGuardProvider, pushDashboardHistory, useGuardedNavigation, useUnsavedDraft } from '@/components/navigation-guard';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
const t = common.en.unsaved;
const click = async (text: string) => {
  const button = [...document.querySelectorAll('button')].find(e => e.textContent === text)!;
  expect(button, text).toBeTruthy(); await act(async () => button.click());
};
function Form({ save, ready, leave, discard, pending = false }: { pending?: boolean; save: () => Promise<boolean>; ready: boolean; leave: () => void; discard?: () => void }) {
  const [text, setText] = useState('');
  const request = useGuardedNavigation();
  useUnsavedDraft({ dirty: !!text, pending, canSave: ready, save, discard });
  return <><input aria-label="Draft" value={text} onChange={e => setText(e.target.value)} /><button onClick={() => request(leave)}>Leave</button>
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- test the native anchor capture/replay boundary */}
    <a href="/elsewhere" onClick={e => { e.preventDefault(); leave(); }}>Other project</a></>;
}
function Harness({ save, ready = true, discard, pending = false }: { pending?: boolean; save: () => Promise<boolean>; ready?: boolean; discard?: () => void }) {
  const [editing, setEditing] = useState(true);
  return <NavigationGuardProvider>{editing ? <Form save={save} ready={ready} discard={discard} pending={pending} leave={() => setEditing(false)} /> : <h1>Other destination</h1>}</NavigationGuardProvider>;
}
const show = async (save = vi.fn(async () => true), ready = true, discard?: () => void, pending = false) => { await act(async () => root.render(<Harness save={save} ready={ready} discard={discard} pending={pending} />)); return save; };
const edit = async () => { const input = document.querySelector('input')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Keep this draft'); input.dispatchEvent(new Event('input', { bubbles: true })); }); };
beforeEach(() => { window.history.replaceState({ ownDashboardIndex: 0 }, '', 'http://localhost:3000/start'); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('persistent-shell draft navigation', () => {
  it('notifies the editor of an explicit discard before navigation can unmount it', async () => {
    const discard = vi.fn(() => expect(document.querySelector('input')).not.toBeNull());
    await show(vi.fn(async () => true), true, discard); await edit(); await click('Leave');
    await click(t.stay); expect(discard).not.toHaveBeenCalled();
    await click('Leave'); await click(t.discard);
    expect(discard).toHaveBeenCalledOnce(); expect(container.textContent).toContain('Other destination');
  });
  it('keeps the draft on Stay/Escape and warns on document unload, then discards on the chosen exit', async () => {
    await show(); await edit();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await click('Leave'); expect(document.querySelector('[role=dialog]')).not.toBeNull();
    await click(t.stay); expect(document.querySelector('input')?.value).toBe('Keep this draft');
    await click('Leave');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await click('Leave'); await click(t.discard);
    expect(container.textContent).toContain('Other destination'); expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('retains input after a failed save and leaves only after a successful retry', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await show(save); await edit(); await click('Leave'); await click(t.save);
    expect(document.querySelector('[role=alert]')?.textContent).toBe(t.failed);
    expect(document.querySelector('input')?.value).toBe('Keep this draft');
    await click(t.save); expect(save).toHaveBeenCalledTimes(2); expect(container.textContent).toContain('Other destination');
  });
  it('updates Save readiness while fit/validation settles, without dropping the pending exit', async () => {
    const save = vi.fn(async () => true); await show(save, false); await edit(); await click('Leave');
    expect([...document.querySelectorAll('button')].find(e => e.textContent === t.save)?.disabled).toBe(true);
    await show(save, true);
    expect([...document.querySelectorAll('button')].find(e => e.textContent === t.save)?.disabled).toBe(false);
    await click(t.save); expect(container.textContent).toContain('Other destination');
  });
  it('replays the original link through its SPA handler only after the owner chooses to leave', async () => {
    await show(); await edit();
    await act(async () => (container.querySelector('a') as HTMLAnchorElement).click());
    expect(container.querySelector('h1')).toBeNull(); await click(t.discard); expect(container.textContent).toContain('Other destination');
  });
  it('restores Back without adding entries, and resumes the exact traversal after Discard', async () => {
    await show(); act(() => pushDashboardHistory('/editor')); await edit();
    const length = window.history.length, seen = vi.fn(); window.addEventListener('popstate', seen);
    const move = (index: number) => { window.history.replaceState({ ownDashboardIndex: index }, '', index ? '/editor' : '/start'); window.dispatchEvent(new PopStateEvent('popstate', { state: { ownDashboardIndex: index } })); };
    const go = vi.spyOn(window.history, 'go').mockImplementation(delta => { queueMicrotask(() => move(Number(window.history.state.ownDashboardIndex) + Number(delta))); });
    try {
      await act(async () => move(0));
      expect(window.location.pathname).toBe('/editor'); expect(seen).not.toHaveBeenCalled();
      await click(t.stay); expect(window.history.length).toBe(length); expect(document.querySelector('input')?.value).toBe('Keep this draft');
      await act(async () => move(0)); await click(t.discard);
      expect(go.mock.calls.map(c => c[0])).toEqual([1, 1, -1]); expect(window.location.pathname).toBe('/start'); expect(seen).toHaveBeenCalledTimes(1); expect(window.history.length).toBe(length);
    } finally { window.removeEventListener('popstate', seen); }
  });
});


describe('pending external actions', () => {
  const button = (label: string) => [...document.querySelectorAll('button')].find(item => item.textContent === label)!;
  it('protects a pending action even when the editor has no dirty field', async () => {
    const save = vi.fn(async () => true), discard = vi.fn();
    await show(save, true, discard, true); await click('Leave');
    expect(document.querySelector('[role=dialog]')?.textContent).toContain(t.pendingTitle);
    expect(button(t.discard).disabled).toBe(true); expect(button(t.save).disabled).toBe(true); expect(button(t.stay).disabled).toBe(false);
    await click(t.discard); await click(t.save); expect(save).not.toHaveBeenCalled(); expect(discard).not.toHaveBeenCalled(); expect(container.querySelector('h1')).toBeNull();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await click(t.stay); expect(document.querySelector('[role=dialog]')).toBeNull();
    await show(save, true, discard, false); await click('Leave'); expect(container.textContent).toContain('Other destination');
  });
  it('retains the pending exit and failed draft while an action starts then fails', async () => {
    const save = vi.fn(async () => true), discard = vi.fn(); await show(save, true, discard); await edit(); await click('Leave');
    await show(save, false, discard, true);
    expect(button(t.discard).disabled).toBe(true); expect(document.querySelector('[role=dialog]')?.textContent).not.toContain(t.invalid);
    await show(save, true, discard, false);
    expect(button(t.discard).disabled).toBe(false); expect(button(t.save).disabled).toBe(false);
    expect(document.querySelector('input')?.value).toBe('Keep this draft'); await click(t.save);
    expect(save).toHaveBeenCalledOnce(); expect(discard).not.toHaveBeenCalled(); expect(container.textContent).toContain('Other destination');
  });
  it('still allows an invalid idle draft to be deliberately discarded', async () => {
    const discard = vi.fn(); await show(vi.fn(async () => false), false, discard); await edit(); await click('Leave');
    expect(button(t.save).disabled).toBe(true); expect(button(t.discard).disabled).toBe(false); await click(t.discard);
    expect(discard).toHaveBeenCalledOnce(); expect(container.textContent).toContain('Other destination');
  });
  it('does not let a second action discard or duplicate a guard-initiated save', async () => {
    let finish!: (value: boolean) => void; const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    await show(save); await edit(); await click('Leave'); await click(t.save);
    expect(button(t.discard).disabled).toBe(true); expect(button(t.stay).disabled).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('button[aria-label="Close"]')).toBeNull();
    await click(t.discard); await act(async () => { finish(false); });
    expect(save).toHaveBeenCalledOnce(); expect(container.querySelector('h1')).toBeNull(); expect(document.querySelector('input')?.value).toBe('Keep this draft');
    expect(document.querySelector('[role=alert]')?.textContent).toBe(t.failed);
  });
});
