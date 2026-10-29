// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CountedField } from '@/components/marketing/dneskai/counted-field';
import { DneskaiEngagementEditor } from '@/components/marketing/dneskai/lab/engagement-editor';
import { DneskaiRenderProblems, dneskaiFieldLabel } from '@/components/marketing/dneskai/render-problems';
import { dneskaiDraftCaption, draftProblems, type DeckDraft } from '@/lib/marketing/dneskai-deck-editor';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import type { DneskaiRenderReport } from '@/lib/marketing/contracts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
function render(element: React.ReactNode) {
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); act(() => root!.render(element));
  return { container };
}
afterEach(() => { act(() => root?.unmount()); root = undefined; container?.remove(); });
const draft = { caption: 'TEST_ONLY', engagement: { keyword: 'TEST', replyMessage: '😀'.repeat(501), publicReply: '😀'.repeat(101) } } as DeckDraft;

describe.each(['en', 'cs'] as const)('%s: honest field and diagnostic feedback', lang => {
  it('matches the caption save boundary, including leading/trailing whitespace', () => {
    const view = render(<CountedField id="caption" label="Caption" value={'a'.repeat(2200) + ' '} max={2200} count={value => value.length} lang={lang} onChange={vi.fn()} />);
    expect(view.container.querySelector('#caption')!.getAttribute('aria-invalid')).toBe('true');
    expect(view.container.textContent).toContain('2201 / 2200');
  });
  it.each(['😀'.repeat(1101), 'e\u0301'.repeat(1101)])('rejects overlong raw captions with the server UTF-16 limit', caption => {
    const problems = draftProblems({ deck: null }, { ...draft, slides: [], caption, scheduledLocal: '2026-10-25T10:00' }, null, new Date('2026-10-25T08:00:00Z'));
    expect(problems.some(problem => problem.code === 'caption-too-long')).toBe(true);
  });
  it('includes the restored keyword line before accepting a caption', () => {
    const value = { ...draft, slides: [], caption: 'a'.repeat(2190), scheduledLocal: '2026-10-25T10:00' };
    expect(dneskaiDraftCaption(value).length).toBeGreaterThan(2200);
    expect(draftProblems({ deck: null }, value, null, new Date('2026-10-25T08:00:00Z')).some(problem => problem.code === 'caption-too-long')).toBe(true);
  });
  it('rejects overlong raw alt text without changing the authored string', () => {
    const value = { ...draft, slides: [{ from: 0, fields: [], slide: { type: 'statement' as const, headline: 'TEST_ONLY', alt: '😀'.repeat(501), images: [] } }], scheduledLocal: '2026-10-25T10:00' };
    expect(draftProblems({ deck: null }, value, null, new Date('2026-10-25T08:00:00Z'))).toContainEqual({ slide: 0, field: 'alt', code: 'alt-too-long' });
    expect(value.slides[0].slide.alt).toHaveLength(1002);
  });
  it('counts engagement messages in the same UTF-16 units as saved message limits', () => {
    const view = render(<DneskaiEngagementEditor id="test" draft={draft} onDraft={vi.fn()} handle="TEST_ONLY" lang={lang} />);
    const message = view.container.querySelector('#test-message')!;
    const reply = view.container.querySelector('#test-reply')!;
    expect(message.getAttribute('aria-invalid')).toBe('true');
    expect(reply.getAttribute('aria-invalid')).toBe('true');
    expect(view.container.textContent).toContain('1002 / 1000');
    expect(view.container.textContent).toContain('202 / 200');
  });
  it('keeps trimmed NFC code-point counting for ordinary slide text', () => {
    const view = render(<CountedField id="headline" label="Headline" value={' e\u0301😀 '} max={2} lang={lang} onChange={vi.fn()} />);
    expect(view.container.querySelector('#headline')!.hasAttribute('aria-invalid')).toBe(false);
    expect(view.container.textContent).toContain('2 / 2');
  });
  it('does not interpret an unknown schema-valid field as an inherited translation', () => {
    expect(dneskaiFieldLabel('constructor', lang)).toBeNull();
    expect(dneskaiFieldLabel('headline', lang)).toBe(dneskaiWorkspace[lang].fields.headline);
    expect(dneskaiFieldLabel('sources[1]', lang)).toBe(`${dneskaiWorkspace[lang].fields.sources} 2`);
  });
  it('makes the complete sorted problem list available without silently hiding its remainder', () => {
    const problems: DneskaiRenderReport['problems'] = Array.from({ length: 21 }, (_, index) => ({ slide: index % 10, code: 'text-clipped', message: 'TEST_ONLY render detail', blocking: index === 20, field: 'headline' }));
    const before = structuredClone(problems);
    const view = render(<DneskaiRenderProblems problems={problems} lang={lang} />);
    expect([...view.container.querySelectorAll('li')]).toHaveLength(20);
    const more = view.container.querySelector('button')!;
    expect(more.textContent).toContain('21');
    act(() => more.click());
    expect([...view.container.querySelectorAll('li')]).toHaveLength(21);
    expect([...view.container.querySelectorAll('li')][0].textContent).toContain(dneskaiWorkspace[lang].card.problemSlide(1));
    act(() => view.container.querySelector('button')!.click());
    expect([...view.container.querySelectorAll('li')]).toHaveLength(20);
    expect(problems).toEqual(before);
  });
});
