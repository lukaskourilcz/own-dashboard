// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevsharkStudioTab } from '@/components/marketing/devshark/studio-tab';
import { devsharkStudio } from '@/lib/i18n/sections/devshark-studio';
import { demoDevsharkStudio, resetDemoDevsharkStudio } from '@/lib/demo/devshark-studio-demo';

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

let root: Root; let host: HTMLDivElement;
beforeEach(() => { resetDemoDevsharkStudio(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('devShark studio in the preview', () => {
  it('shows the sample concept with editable fields and calls no server', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await act(async () => { root.render(<QueryClientProvider client={new QueryClient()}><DevsharkStudioTab lang="cs" preview /></QueryClientProvider>); });
    await settle();
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

  it('saves an edit in memory in the preview, without a server, and returns the concept to review', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await act(async () => { root.render(<QueryClientProvider client={new QueryClient()}><DevsharkStudioTab lang="en" preview /></QueryClientProvider>); });
    await settle();
    const t = devsharkStudio.en;
    const headline = host.querySelectorAll('textarea')[0] as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(headline, 'typeof null, edited');
      headline.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = [...host.querySelectorAll('button')].find((button) => button.textContent === t.save)!;
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); });
    await settle();
    expect((await demoDevsharkStudio.load()).drafts[0]!.deck.slides[0]!.headline).toBe('typeof null, edited');
    expect(fetch).not.toHaveBeenCalled();
  });
});
