// @vitest-environment happy-dom
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (children: ReactNode) => act(() => root.render(children));
const formData = () => new window.FormData(container.querySelector('form')!);

describe('shared toggle behavior inside the larger pointer target', () => {
  it.each([['checkbox', Checkbox], ['switch', Switch]] as const)('%s retains named native form values, a forwarded button and one change per activation', (role, Control) => {
    const change = vi.fn(), ref = createRef<HTMLButtonElement>();
    render(<form><Control ref={ref} id="setting" name="setting" value="enabled" onCheckedChange={change} /><label htmlFor="setting">Setting</label></form>);
    const button = container.querySelector<HTMLButtonElement>(`[role="${role}"]`)!;
    expect(ref.current).toBe(button); expect(button.type).toBe('button'); expect(button.getAttribute('aria-checked')).toBe('false'); expect(formData().has('setting')).toBe(false);
    act(() => button.click()); expect(change.mock.calls).toEqual([[true]]); expect(button.getAttribute('aria-checked')).toBe('true'); expect(formData().get('setting')).toBe('enabled');
    act(() => button.click()); expect(change.mock.calls).toEqual([[true], [false]]); expect(formData().has('setting')).toBe(false);
  });
  it.each([['checkbox', Checkbox], ['switch', Switch]] as const)('%s keeps disabled state noninteractive and excluded from submission', (role, Control) => {
    const change = vi.fn(); render(<form><Control disabled defaultChecked name="setting" onCheckedChange={change} aria-label="Setting" /></form>);
    const button = container.querySelector<HTMLButtonElement>(`[role="${role}"]`)!; act(() => button.click()); expect(change).not.toHaveBeenCalled(); expect(button.disabled).toBe(true); expect(button.getAttribute('aria-checked')).toBe('true'); expect(formData().has('setting')).toBe(false);
  });
  it('keeps the checkbox indeterminate state, selects it on activation and restores it on native form reset', () => {
    render(<form><Checkbox name="setting" defaultChecked="indeterminate" aria-label="Setting" required /></form>);
    const button = container.querySelector<HTMLButtonElement>('[role="checkbox"]')!, input = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(button.getAttribute('aria-checked')).toBe('mixed'); expect(input.required).toBe(true); expect(formData().has('setting')).toBe(false);
    act(() => button.click()); expect(button.getAttribute('aria-checked')).toBe('true'); expect(input.indeterminate).toBe(false); expect(formData().get('setting')).toBe('on');
    act(() => container.querySelector('form')!.reset()); expect(button.getAttribute('aria-checked')).toBe('mixed'); expect(input.indeterminate).toBe(true); expect(formData().has('setting')).toBe(false);
  });
  it('keeps controlled values owned by the parent and refuses Enter as checkbox form submission', () => {
    const change = vi.fn(); render(<form><Checkbox checked={false} onCheckedChange={change} aria-label="Setting" /></form>);
    const button = container.querySelector<HTMLButtonElement>('[role="checkbox"]')!; act(() => button.click()); expect(change).toHaveBeenCalledWith(true); expect(button.getAttribute('aria-checked')).toBe('false');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); act(() => button.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true);
  });
});
