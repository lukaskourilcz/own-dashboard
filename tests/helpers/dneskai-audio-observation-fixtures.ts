import type { DneskaiAudioAccount } from '@/lib/marketing/dneskai-audio-trends';
export const observationOwner = '11111111-1111-4111-8111-111111111111';
export const observationAccount: DneskaiAudioAccount = { id: '33333333-3333-4333-8333-333333333333', user_id: observationOwner, brand: 'dneskai', platform: 'instagram', remote_account_id: '17841400000000001', verified_at: '2026-10-20T00:00:00.000001Z', enabled: false };
export const observationNow = new Date('2026-10-23T12:00:00Z');
export type ObservationItem = {
    audio_id: string;
    title: string;
    display_artist: string | null;
    audio_type: 'music' | 'original_sound';
    duration_ms: number | null;
    cover_artwork_thumbnail_url: string | null;
};
export type ObservationArgs = {
    p_owner: string;
    p_account: string;
    p_remote: string;
    p_verified_at: string;
    p_day: string;
    p_observed_at: string;
    p_items: ObservationItem[];
};
export function observationReceipt(args: ObservationArgs) { return { ownerId: args.p_owner, accountId: args.p_account, remoteAccountId: args.p_remote, verifiedAt: args.p_verified_at, day: args.p_day, observedAt: args.p_observed_at, status: 'done', rows: args.p_items.map(item => ({ audioId: item.audio_id, outcome: 'stored', title: item.title, artist: item.display_artist, type: item.audio_type, durationMs: item.duration_ms, coverUrl: item.cover_artwork_thumbnail_url, firstSeen: args.p_day, lastSeen: args.p_day, daysSeen: 1, accountId: args.p_account, remoteAccountId: args.p_remote, verifiedAt: args.p_verified_at, observedAt: args.p_observed_at })) }; }
export const observationReadRow = (id: number, patch = {}) => ({ user_id: observationOwner, audio_id: String(id), title: `Sound ${id}`, display_artist: null, audio_type: 'music', duration_ms: 1000, cover_artwork_thumbnail_url: null, days_seen: 1, tiktok: false, last_seen: '2026-10-25', observed_account_id: observationAccount.id, observed_remote_account_id: observationAccount.remote_account_id, observed_verified_at: observationAccount.verified_at, observed_at: '2026-10-25T12:00:00Z', ...patch });
