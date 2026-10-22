import { describe, expect, it, vi } from 'vitest';
import { createDeckDraft, DNESKAI_DEFAULT_PUBLIC_REPLY, dneskaiDraftEngagement, dneskaiEditRequest, dneskaiEngagementChanged, draftProblems, newEngagementDraft } from '@/lib/marketing/dneskai-deck-editor';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
const now = new Date('2026-10-24T09:00:00Z');
const news = (): DneskaiWorkspacePost => ({ ...createDneskaiWorkspaceFixture(now).posts[0]!, engagement: null });
const engagement = { keyword: 'SKILL', replyMessage: 'Návod: otevřete aplikaci a začněte.', publicReply: 'Poslali jsme vám to do zpráv.' };
const education = (): DneskaiWorkspacePost => ({ ...news(), engagement });
const codes = (post: DneskaiWorkspacePost, draft: ReturnType<typeof createDeckDraft>) => draftProblems(post, draft, null, now).filter((problem) => problem.field.startsWith('engagement')).map((problem) => problem.code);

describe('engagement in the Lab draft (#159)', () => {
  it('starts from the saved engagement, an empty public reply standing for none, and sends nothing while unchanged', () => {
    expect(createDeckDraft(education()).engagement).toEqual(engagement);
    expect(createDeckDraft({ ...education(), engagement: { keyword: 'SKILL', replyMessage: 'Text.' } }).engagement).toEqual({ keyword: 'SKILL', replyMessage: 'Text.', publicReply: '' });
    expect(createDeckDraft(news()).engagement).toBeNull();
    expect(createDeckDraft({ ...news(), engagement: undefined }).engagement).toBeNull();
    expect(dneskaiEditRequest(education(), createDeckDraft(education()))).not.toHaveProperty('engagement');
    expect(dneskaiEditRequest(news(), createDeckDraft(news()))).not.toHaveProperty('engagement');
  });
  it('sends the normalised engagement when a field changes, and treats whitespace and case as no change', () => {
    const draft = createDeckDraft(education());
    expect(dneskaiEngagementChanged(education(), { engagement: { ...draft.engagement!, keyword: ' skill ', replyMessage: `${engagement.replyMessage}  ` } })).toBe(false);
    const edited = { ...draft, engagement: { ...draft.engagement!, replyMessage: '  Nový návod ve třech krocích.  ' } };
    expect(dneskaiEditRequest(education(), edited).engagement).toEqual({ ...engagement, replyMessage: 'Nový návod ve třech krocích.' });
    const noReply = { ...draft, engagement: { ...draft.engagement!, publicReply: '   ' } };
    expect(dneskaiEditRequest(education(), noReply).engagement).toEqual({ keyword: 'SKILL', replyMessage: engagement.replyMessage });
  });
  it('opts a news post in with the default public reply and removes a keyword with null', () => {
    expect(newEngagementDraft()).toEqual({ keyword: '', replyMessage: '', publicReply: DNESKAI_DEFAULT_PUBLIC_REPLY });
    const optedIn = { ...createDeckDraft(news()), engagement: { ...newEngagementDraft(), keyword: 'navod', replyMessage: 'Text zprávy.' } };
    expect(dneskaiEditRequest(news(), optedIn).engagement).toEqual({ keyword: 'NAVOD', replyMessage: 'Text zprávy.', publicReply: DNESKAI_DEFAULT_PUBLIC_REPLY });
    expect(dneskaiEditRequest(education(), { ...createDeckDraft(education()), engagement: null }).engagement).toBeNull();
    expect(dneskaiDraftEngagement(null)).toBeNull();
  });
  it('flags a keyword that is not one Latin word, an empty or long DM and a long public reply, as the server would', () => {
    const draft = (patch: Partial<typeof engagement>) => ({ ...createDeckDraft(education(), null, now), engagement: { ...engagement, ...patch } });
    expect(codes(education(), draft({}))).toEqual([]);
    for (const keyword of ['', 'dvě slova', 'NÁVOD', 'AI-TOOL', 'A'.repeat(25)]) expect(codes(education(), draft({ keyword }))).toEqual(['engagement-keyword-invalid']);
    expect(codes(education(), draft({ keyword: ' skill2 ' }))).toEqual([]);
    expect(codes(education(), draft({ replyMessage: '   ' }))).toEqual(['engagement-message-missing']);
    expect(codes(education(), draft({ replyMessage: 'x'.repeat(1001) }))).toEqual(['engagement-message-too-long']);
    expect(codes(education(), draft({ replyMessage: 'x'.repeat(1000), publicReply: 'x'.repeat(200) }))).toEqual([]);
    expect(codes(education(), draft({ publicReply: 'x'.repeat(201) }))).toEqual(['engagement-reply-too-long']);
    expect(codes(news(), createDeckDraft(news(), null, now))).toEqual([]);
  });
});
