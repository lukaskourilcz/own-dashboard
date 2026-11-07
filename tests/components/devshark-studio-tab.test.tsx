// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevsharkStudioTab } from '@/components/marketing/devshark/studio-tab';
import { devsharkStudio } from '@/lib/i18n/sections/devshark-studio';

let root: Root; let host: HTMLDivElement;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('devShark studio in the preview', () => {
  it('shows the sample concept with editable fields and calls no server', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await act(async () => { root.render(<QueryClientProvider client={new QueryClient()}><DevsharkStudioTab lang="cs" preview /></QueryClientProvider>); });
    const t = devsharkStudio.cs;
    expect(host.textContent).toContain(t.title);
    expect(host.textContent).toContain(t.previewOnly);
    expect(host.querySelectorAll('textarea').length).toBeGreaterThan(3);
    // The first slide has the kicker field; the others do not.
    expect(host.textContent?.match(new RegExp(t.fields.kicker.replace(/[()]/g, '\\$&'), 'g'))).toHaveLength(1);
    const render = [...host.querySelectorAll('button')].find((button) => button.textContent === t.render)!;
    expect(render.disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
