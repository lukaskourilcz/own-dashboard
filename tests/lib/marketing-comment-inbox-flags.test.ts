import { describe, expect, it } from 'vitest';
import { commentDraftsEnabled, commentInboxEnabled } from '@/lib/marketing/comment-inbox';

describe('comment inbox switches', () => {
  it('captures only when the inbox switch is on', () => {
    expect(commentInboxEnabled({})).toBe(false);
    expect(commentInboxEnabled({ MARKETING_COMMENT_INBOX_ENABLED: 'true' })).toBe(true);
    expect(commentInboxEnabled({ MARKETING_COMMENT_INBOX_ENABLED: '1' })).toBe(false);
  });

  it('drafts with a model only when the inbox is on AND drafts AND AI consent are all true', () => {
    expect(commentDraftsEnabled({ MARKETING_COMMENT_DRAFTS_ENABLED: 'true', MARKETING_AI_CONSENT: 'true' })).toBe(false); // inbox off
    expect(commentDraftsEnabled({ MARKETING_COMMENT_INBOX_ENABLED: 'true', MARKETING_COMMENT_DRAFTS_ENABLED: 'true' })).toBe(false); // consent off
    expect(commentDraftsEnabled({ MARKETING_COMMENT_INBOX_ENABLED: 'true', MARKETING_AI_CONSENT: 'true' })).toBe(false); // drafts off
    expect(commentDraftsEnabled({ MARKETING_COMMENT_INBOX_ENABLED: 'true', MARKETING_COMMENT_DRAFTS_ENABLED: 'true', MARKETING_AI_CONSENT: 'true' })).toBe(true);
  });
});
