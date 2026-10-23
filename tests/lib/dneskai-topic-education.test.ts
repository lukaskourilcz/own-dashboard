import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { dneskaiBriefGenerationRequest, dneskaiTopicEducation } from '@/lib/marketing/dneskai-briefs';
import { GenerationInputSchema } from '@/lib/marketing/generation';
import { briefFixture, briefPacket, briefPictures } from './marketing-dneskai-generation-fixture';

/** #222: an education topic's keyword becomes `education: { keyword }` on the brief's generation request. */
const owner = '11111111-1111-4111-8111-111111111111', topicId = '33333333-3333-4333-8333-333333333333';
const store = (keyword: string | null) => ({ educationKeyword: vi.fn(async () => keyword) });

describe('education keyword for topic briefs (#222)', () => {
  it('sends an education topic keyword in capitals', async () => {
    expect(await dneskaiTopicEducation(store('Prikazy'), owner, { topic_id: topicId })).toEqual({ keyword: 'PRIKAZY' });
  });

  it('sends nothing for a news topic, a night brief, or a missing or invalid keyword', async () => {
    // The store answers null for a news topic: only `education` topics have a keyword to send.
    expect(await dneskaiTopicEducation(store(null), owner, { topic_id: topicId })).toBeNull();
    const night = store('Prikazy');
    expect(await dneskaiTopicEducation(night, owner, { topic_id: null })).toBeNull();
    expect(night.educationKeyword).not.toHaveBeenCalled();
    expect(await dneskaiTopicEducation(store('dvě slova'), owner, { topic_id: topicId })).toBeNull();
    expect(await dneskaiTopicEducation(store('   '), owner, { topic_id: topicId })).toBeNull();
    expect(await dneskaiTopicEducation({}, owner, { topic_id: topicId })).toBeNull();
  });

  it('puts it on the generation request, which the worker accepts; without it the request has no education', async () => {
    const packet = briefPacket(briefFixture(await briefPictures()));
    const admitted = { campaignId: '44444444-4444-4444-8444-444444444444', entryId: '55555555-5555-4555-8555-555555555555', entryVersion: 1 };
    const account = { remote_account_id: '17841400000000000', handle: 'dneskai' };
    const education = dneskaiBriefGenerationRequest({ owner, packet, account, admitted, education: { keyword: 'PRIKAZY' } });
    expect(education.generation).toMatchObject({ education: { keyword: 'PRIKAZY' } });
    expect(GenerationInputSchema.parse({ ...education.generation, source: packet }).education).toEqual({ keyword: 'PRIKAZY' });
    const news = dneskaiBriefGenerationRequest({ owner, packet, account, admitted, education: null });
    expect('education' in news.generation).toBe(false);
  });
});
