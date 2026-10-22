// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DneskaiEngagementEditor } from '@/components/marketing/dneskai/lab/engagement-editor';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { createDeckDraft, DNESKAI_DEFAULT_PUBLIC_REPLY, dneskaiEditRequest, dneskaiEngagementChanged, draftProblems, type DeckDraft } from '@/lib/marketing/dneskai-deck-editor';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = dneskaiLab.en.engagement;
let container: HTMLDivElement; let root: Root; let latest: DeckDraft;
const fixture = () => createDneskaiWorkspaceFixture(new Date());
const education = (): DneskaiWorkspacePost => fixture().posts[1]!;
const news = (): DneskaiWorkspacePost => fixture().posts[0]!;

function Harness({ post, lang = 'en' }: { post: DneskaiWorkspacePost; lang?: 'en' | 'cs' }) {
  const [draft, setDraft] = useState(() => createDeckDraft(post));
  latest = draft;
  return <DneskaiEngagementEditor id="e" draft={draft} onDraft={setDraft} handle={post.account.handle} lang={lang} />;
}
const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector(selector) as T | null;
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  act(() => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Lab engagement editor (#159)', () => {
  it('shows the saved keyword as a chip, the DM with its counter and bubble preview, and the public reply', () => {
    const post = education();
    act(() => root.render(<Harness post={post} />));
    expect(q('[data-testid="dneskai-engagement-chip"]')?.textContent).toContain('KONTEXT');
    expect(q<HTMLTextAreaElement>('#e-message')?.value).toBe(post.engagement!.replyMessage);
    expect(q('#e-message-count')?.textContent).toMatch(/\/ 1000$/);
    expect(q('[data-testid="dneskai-engagement-preview"]')?.textContent).toContain('Díky za komentář.');
    expect(q<HTMLInputElement>('#e-reply')?.value).toBe(DNESKAI_DEFAULT_PUBLIC_REPLY);
    expect(dneskaiEngagementChanged(post, latest)).toBe(false);
  });
  it('upper-cases the keyword as typed, refuses diacritics or two words in place, and marks the draft dirty', () => {
    const post = education();
    act(() => root.render(<Harness post={post} />));
    const keyword = q<HTMLInputElement>('[data-testid="dneskai-engagement-keyword"]')!;
    type(keyword, 'návod');
    expect(keyword.value).toBe('NÁVOD');
    expect(keyword.getAttribute('aria-invalid')).toBe('true');
    expect(q('#e-keyword-error')?.textContent).toBe(t.keywordInvalid);
    expect(q('[data-testid="dneskai-engagement-chip"]')).toBeNull();
    expect(draftProblems(post, latest).map((problem) => problem.code)).toContain('engagement-keyword-invalid');
    type(keyword, 'navod');
    expect(keyword.getAttribute('aria-invalid')).toBeNull();
    expect(q('[data-testid="dneskai-engagement-chip"]')?.textContent).toContain('NAVOD');
    expect(dneskaiEngagementChanged(post, latest)).toBe(true);
    expect(dneskaiEditRequest(post, latest).engagement?.keyword).toBe('NAVOD');
    type(keyword, 'kontext');
    expect(dneskaiEngagementChanged(post, latest)).toBe(false);
  });
  it('previews the edited DM, sends no public reply when emptied, and flags an over-long message', () => {
    const post = education();
    act(() => root.render(<Harness post={post} />));
    type(q<HTMLTextAreaElement>('#e-message')!, 'Nový text zprávy.');
    expect(q('[data-testid="dneskai-engagement-preview"]')?.textContent).toContain('Nový text zprávy.');
    type(q<HTMLInputElement>('#e-reply')!, '');
    expect(dneskaiEditRequest(post, latest).engagement).toEqual({ keyword: 'KONTEXT', replyMessage: 'Nový text zprávy.' });
    type(q<HTMLTextAreaElement>('#e-message')!, 'x'.repeat(1001));
    expect(q('#e-message')?.getAttribute('aria-invalid')).toBe('true');
    expect(draftProblems(post, latest).map((problem) => problem.code)).toContain('engagement-message-too-long');
  });
  it('lets a news post opt in with the default public reply, and removes the keyword again', () => {
    const post = news();
    act(() => root.render(<Harness post={post} lang="cs" />));
    expect(q('[data-testid="dneskai-engagement"]')?.textContent).toContain(dneskaiLab.cs.engagement.none);
    act(() => q('[data-testid="dneskai-engagement-add"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(latest.engagement).toEqual({ keyword: '', replyMessage: '', publicReply: DNESKAI_DEFAULT_PUBLIC_REPLY });
    expect(q('[data-testid="dneskai-engagement-preview"]')?.textContent).toContain(dneskaiLab.cs.engagement.previewEmpty);
    expect(draftProblems(post, latest).map((problem) => problem.code)).toEqual(expect.arrayContaining(['engagement-keyword-invalid', 'engagement-message-missing']));
    act(() => q('[data-testid="dneskai-engagement-remove"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(latest.engagement).toBeNull();
    expect(dneskaiEngagementChanged(post, latest)).toBe(false);
  });
});
