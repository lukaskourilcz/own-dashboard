import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { strategyPublishedPost } from '@/lib/marketing/strategy/server';
const id = '11111111-1111-4111-8111-111111111111';
const receipt = { id, revision_id: id, platform: 'instagram', remote_media_id: '123', remote_url: 'https://www.instagram.com/p/example/', revision_row: { brand: 'dneskai', revision: { brand: 'dneskai', title: 'Published lesson', format: 'carousel', account: { platform: 'instagram' }, assets: [{ url: 'https://private.example/signed?token=private' }] } } };
describe('strategy publication evidence', () => {
  it('projects confirmed matching receipts without exposing signed assets or source data', () => {
    const post = strategyPublishedPost(receipt, 'dneskai');
    expect(post).toEqual({ id, revisionId: id, title: 'Published lesson', channel: 'instagram', format: 'carousel', remoteUrl: receipt.remote_url });
    expect(JSON.stringify(post)).not.toContain('private');
  });
  it('refuses brand/account mismatches, missing remote ids and unsafe URLs', () => {
    expect(strategyPublishedPost(receipt, 'devshark')).toBeNull();
    expect(strategyPublishedPost({ ...receipt, platform: 'threads' }, 'dneskai')).toBeNull();
    expect(strategyPublishedPost({ ...receipt, remote_media_id: ' ' }, 'dneskai')).toBeNull();
    expect(strategyPublishedPost({ ...receipt, remote_url: 'https://secret@example.com/post' }, 'dneskai')).toBeNull();
    expect(strategyPublishedPost({ ...receipt, remote_url: null }, 'dneskai')).toBeNull();
  });
  it('allows an Instagram Story id without a permanent URL and keeps it separate from feed posts', () => {
    const story = { ...receipt, remote_url: null, revision_row: { brand: 'dneskai', revision: { ...receipt.revision_row.revision, format: 'story' } } };
    expect(strategyPublishedPost(story, 'dneskai')?.channel).toBe('story');
  });
});
