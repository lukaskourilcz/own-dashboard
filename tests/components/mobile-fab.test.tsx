// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HTMLAttributes } from 'react';
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: (input: HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => {
    const props = { ...input }; for (const key of ['initial', 'animate', 'exit', 'transition']) delete props[key]; return <div {...props} />;
  } },
}));
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ app: app.en }) }));
import { MobileFab } from '@/components/mobile-fab';
import { app } from '@/lib/i18n/sections/app';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
const t = app.en, key = 'dashboard.installDismissed';
const button = (label: string) => [...container.querySelectorAll('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label)!;
const emit = (prompt: () => Promise<void> = vi.fn(async () => undefined), userChoice = Promise.resolve({ outcome: 'dismissed' as const })) => {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice });
  act(() => window.dispatchEvent(event)); return { event, prompt };
};
const render = () => act(() => root.render(<MobileFab />));
beforeEach(() => {
  // Happy DOM binds prototype methods onto each instance on first access.
  // A fresh store keeps a deliberately throwing spy out of the next case.
  vi.spyOn(window, 'localStorage', 'get').mockReturnValue(new Storage());
  window.localStorage.clear();
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe('single-use installation invitation', () => {
  it('survives denied local storage and still waits for an explicit gesture', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Storage blocked', 'SecurityError'); });
    expect(render).not.toThrow(); const offered = emit();
    expect(container.textContent).toContain(t.installTitle); expect(offered.prompt).not.toHaveBeenCalled();
    expect(offered.event.defaultPrevented).toBe(true);
  });
  it.each(['dismissed', 'installed'] as const)('does not offer installation when already %s', mode => {
    if (mode === 'dismissed') window.localStorage.setItem(key, '1');
    else vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    render(); emit(); expect(container.textContent).not.toContain(t.installTitle);
  });
  it.each(['later', 'close'] as const)('keeps the current document dismissed after %s even when storage writes fail', action => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Storage blocked', 'SecurityError'); });
    render(); emit(); act(() => button(action === 'later' ? t.notNow : t.dismiss).click());
    emit(); expect(container.textContent).not.toContain(t.installTitle);
  });
  it('honors an appinstalled event even if another invitation arrives before navigation', () => {
    render(); emit(); act(() => window.dispatchEvent(new Event('appinstalled'))); emit();
    expect(container.textContent).not.toContain(t.installTitle);
  });
  it('consumes the event synchronously and ignores replacement invitations during the native prompt', async () => {
    render(); let resolve!: () => void;
    const prompt = vi.fn(() => new Promise<void>(done => { resolve = done; })); emit(prompt);
    const install = button(t.install); act(() => { install.click(); install.click(); });
    expect(prompt).toHaveBeenCalledTimes(1); const replacement = emit();
    expect(container.textContent).not.toContain(t.installTitle); expect(replacement.prompt).not.toHaveBeenCalled();
    await act(async () => resolve());
  });
  it('handles a rejected browser prompt without replaying it', async () => {
    render(); const prompt = vi.fn(async () => { throw new Error('Native fixture refusal'); }); emit(prompt);
    await act(async () => button(t.install).click());
    expect(prompt).toHaveBeenCalledTimes(1); expect(container.textContent).not.toContain(t.installTitle);
    emit(); expect(container.textContent).toContain(t.installTitle);
  });
  it('removes its listeners and leaves late native completion without a UI update', async () => {
    render(); let resolve!: () => void; emit(vi.fn(() => new Promise<void>(done => { resolve = done; })));
    act(() => button(t.install).click()); act(() => root.unmount()); root = createRoot(container);
    const errors = vi.spyOn(console, 'error'); await act(async () => resolve()); emit();
    expect(container.textContent).toBe(''); expect(errors).not.toHaveBeenCalled();
  });
});
