// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DneskaiSlideInspector } from '@/components/marketing/dneskai/lab/slide-inspector';
import { createDeckDraft, dneskaiEditRequest, draftProblems, type DeckDraft } from '@/lib/marketing/dneskai-deck-editor';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import type { DneskaiSlide } from '@/lib/marketing/dneskai-slides';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
for (const lang of ['en', 'cs'] as const) it(`offers explicit first-slide cleanup without changing the saved revision (${lang})`, async () => {
  const now = new Date('2026-10-24T09:00:00Z'), post = structuredClone(createDneskaiWorkspaceFixture(now).posts[0]!);
  const statement: DneskaiSlide = { type: 'statement', headline: 'Krátký titulek', body: 'Starší odstavec.', images: [], alt: 'Popis sdělení.' };
  post.deck!.slides = [statement, { ...statement, headline: 'Další titulek' }];
  const changed = vi.fn<(draft: DeckDraft) => void>();
  function Harness() {
    const [draft, setDraft] = useState(() => createDeckDraft(post, null, now));
    return <DneskaiSlideInspector post={post} draft={draft} index={0} onDraft={value => { changed(value); setDraft(value); }}
      fit={{ status: 'idle', result: null }} previews={new Map()} mediaState="ready" lang={lang} />;
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<Harness />));
  expect(host.querySelector('[data-testid="dneskai-unplaced-text"]')?.textContent).toContain(dneskaiLab[lang].slide.firstSlideHelp);
  const cleanup = [...host.querySelectorAll('button')].find(button => button.textContent === dneskaiLab[lang].slide.keepHeadline)!;
  expect(cleanup).toBeDefined();
  expect(changed).not.toHaveBeenCalled();
  await act(async () => cleanup.click());
  const draft = changed.mock.calls[0]![0];
  expect(draft.slides[0]!.slide.body).toBeUndefined();
  expect(post.deck!.slides[0]!.body).toBe('Starší odstavec.');
  expect(draftProblems(post, draft, null, now)).toEqual([]);
  expect(dneskaiEditRequest(post, draft).deck!.slides[0]).toMatchObject({ from: 0, body: null });
  expect(host.querySelector('[data-testid="dneskai-unplaced-text"]')).toBeNull();
  expect(host.querySelector('[data-testid="dneskai-inspector-notice"]')?.textContent).toBe(dneskaiLab[lang].slide.textCleaned);
});
