// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNow } from '@/lib/use-now';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.useFakeTimers(); host=document.createElement('div'); document.body.append(host); root=createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
function Clock() { return <time>{useNow()?.toISOString()}</time>; }
it('refreshes immediately when a destination reopens after the shared clock was idle', async () => {
  vi.setSystemTime(new Date('2026-10-23T08:00:00Z'));
  await act(async () => root.render(<Clock />));
  expect(host.textContent).toBe('2026-10-23T08:00:00.000Z');
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
  vi.setSystemTime(new Date('2026-10-24T10:00:00Z'));
  await act(async () => root.render(<Clock />));
  expect(host.textContent).toBe('2026-10-24T10:00:00.000Z');
});
it('shares one timer across visible consumers and releases it after the last unmount', async () => {
  await act(async () => root.render(<><Clock /><Clock /></>));
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => vi.advanceTimersByTime(30000));
  const times=host.querySelectorAll('time');expect(times[0].textContent).toBe(times[1].textContent);
  act(() => root.render(null));expect(vi.getTimerCount()).toBe(0);
});
