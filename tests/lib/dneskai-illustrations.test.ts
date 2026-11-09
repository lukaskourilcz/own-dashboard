import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { DNESKAI_ILLUSTRATION_TOPICS, dneskaiIllustrationSettings, illustrationUsable, IllustrationLookSchema } from '@/lib/marketing/dneskai-illustrations';

describe('the DNESKAi illustration library (9 November 2026)', () => {
  it('covers the owner topic set with searches, and stays idle without its switch, consent or keys', () => {
    expect(DNESKAI_ILLUSTRATION_TOPICS.map((entry) => entry.topic)).toEqual(['ai', 'chips', 'phones', 'banking', 'startups', 'prague', 'office', 'datacenter', 'work', 'crypto', 'energy', 'cars', 'space', 'health', 'education', 'policy']);
    expect(dneskaiIllustrationSettings({})).toEqual({ idle: 'illustrations-disabled' });
    expect(dneskaiIllustrationSettings({ DNESKAI_ILLUSTRATIONS_ENABLED: 'true' })).toEqual({ idle: 'generation-consent-required' });
    expect(dneskaiIllustrationSettings({ DNESKAI_ILLUSTRATIONS_ENABLED: 'true', MARKETING_AI_CONSENT: 'true', ANTHROPIC_API_KEY: 'a' })).toEqual({ idle: 'illustrations-pexels-key-missing' });
    expect(dneskaiIllustrationSettings({ DNESKAI_ILLUSTRATIONS_ENABLED: 'true', MARKETING_AI_CONSENT: 'true', ANTHROPIC_API_KEY: 'a', PEXELS_API_KEY: 'p', DNESKAI_ILLUSTRATIONS_DAILY_USD: '99' })).toEqual({ pexelsKey: 'p', anthropicKey: 'a', dailyUsd: 2 });
  });
  it('keeps out a picture with a brand, readable text, a person as the subject or poor quality', () => {
    const clean = IllustrationLookSchema.parse({ tags: ['server room', 'data center', 'cloud'], description: 'Rows of server racks.', brand_or_logo: false, readable_text: false, person_as_subject: false, looks_like_stock_photo_ok: true });
    expect(illustrationUsable(clean)).toBe(true);
    for (const flag of ['brand_or_logo', 'readable_text', 'person_as_subject'] as const) expect(illustrationUsable({ ...clean, [flag]: true })).toBe(false);
    expect(illustrationUsable({ ...clean, looks_like_stock_photo_ok: false })).toBe(false);
  });
});
