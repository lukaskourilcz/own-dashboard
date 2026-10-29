import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { ingestDneskaiAudioTrends, listDneskaiAudioTrends } from '@/lib/marketing/dneskai-audio-trends';
import { parseContentRevision } from '@/lib/marketing/contracts';
import { dneskaiAudioChoiceKey, dneskaiAudioFromKey } from '@/lib/marketing/dneskai-audio-contracts';
import type { MetaPublisherConfig } from '@/lib/marketing/publisher';
import {observationAccount as account,observationNow as now,observationReceipt,observationReadRow,type ObservationArgs} from '../helpers/dneskai-audio-observation-fixtures';
import { deckRevision } from './marketing-dneskai-revision-fixture';

const owner = '11111111-1111-4111-8111-111111111111';
const config = (patch: Partial<MetaPublisherConfig> = {}): MetaPublisherConfig => ({ enabled: true, apiVersion: 'v99.0', apiVersionVerifiedAt: '2026-10-20T06:00:00Z', loginMode: 'facebook',
  accessToken: 'TEST-ONLY-FB-TOKEN-0000001', tokenExpiresAt: '2099-01-01T00:00:00Z', scopes: ['instagram_basic', 'instagram_content_publish'], approvedAssetHosts: [], ...patch });

function store() {
  const upserts: unknown[][] = [];
  return {db:{rpc:(name:string,args:ObservationArgs)=>{
    if(name==='record_dneskai_audio_observations')upserts.push(args.p_items);
    const query={retry:()=>query,abortSignal:()=>query,then:(resolve:(value:unknown)=>unknown)=>resolve({data:name==='record_dneskai_audio_observations'?observationReceipt(args):{ownerId:owner,today:'2026-10-23',rows:[observationReadRow(1,{title:'Song',display_artist:'Artist',duration_ms:30000,days_seen:3,last_seen:'2026-10-23',observed_at:'2026-10-23T12:00:00Z'})]},error:null})};return query;
  }} as never,upserts};
}
const graph = (calls: string[]) => vi.fn(async (url: string, init: RequestInit) => {
  calls.push(url);
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TEST-ONLY-FB-TOKEN-0000001');
  const type = new URL(url).searchParams.get('audio_type');
  return Response.json({ data: type === 'music'
    ? [{ audio_id: '1', title: 'Song', display_artist: 'Artist', duration_in_ms: 30000, cover_artwork_thumbnail_uri: 'https://cdn.example/cover.jpg' }, { audio_id: 'bad', title: 'x' }]
    : [{ audio_id: 2, title: 'Original sound', duration_in_ms: 15000, cover_artwork_thumbnail_uri: 'http://insecure.example/c.jpg' }] });
}) as unknown as typeof fetch;

describe('trending audio ingest (#167)', () => {
  it('reads music and original sounds without a search query and records them per day', async () => {
    const calls: string[] = []; const { db, upserts } = store();
    expect(await ingestDneskaiAudioTrends(db, owner, { account, now, config: config(), remoteAccountId: '17841400000000001', today: '2026-10-23', fetcher: graph(calls) })).toEqual({ status: 'done', stored: 2 });
    expect(calls.map((url) => { const u = new URL(url); return `${u.host}${u.pathname}?${u.searchParams}`; })).toEqual([
      'graph.facebook.com/v99.0/ig_audio?audio_type=music&user_id=17841400000000001',
      'graph.facebook.com/v99.0/ig_audio?audio_type=original_sound&user_id=17841400000000001',
    ]);
    expect(calls.join(' ')).not.toContain('TEST-ONLY');
    expect(upserts[0]).toEqual([
      expect.objectContaining({ audio_id: '1', title: 'Song', display_artist: 'Artist', audio_type: 'music', cover_artwork_thumbnail_url: 'https://cdn.example/cover.jpg' }),
      expect.objectContaining({ audio_id: '2', audio_type: 'original_sound', cover_artwork_thumbnail_url: null }),
    ]);
  });
  it('reads nothing under Instagram Login or without a token', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(await ingestDneskaiAudioTrends(store().db, owner, { account, now, config: config({ loginMode: 'instagram' }), remoteAccountId: '1', today: '2026-10-23', fetcher })).toEqual({ status: 'skipped', code: 'audio-trends-facebook-login-required', stored: 0 });
    expect(await ingestDneskaiAudioTrends(store().db, owner, { account, now, config: config({ accessToken: '', credentialHold: 'access-token-missing' }), remoteAccountId: '1', today: '2026-10-23', fetcher })).toMatchObject({ status: 'skipped', code: 'access-token-missing' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('lists recent sounds for the picker', async () => {
    expect(await listDneskaiAudioTrends(store().db, owner, '2026-10-23')).toEqual([{ audioId: '1', title: 'Song', artist: 'Artist', type: 'music', durationMs: 30000, coverUrl: null, daysSeen: 3, nicheCount: 0, tiktok: false, attachable: true }]);
  });
});

describe('a trending sound on the revision', () => {
  it('is part of the revision as an Instagram audio id and round-trips through the picker key', () => {
    const revision = parseContentRevision({ ...deckRevision(), format: 'reel', audio: { instagramAudioId: '587784541076604' } });
    expect(revision.audio).toEqual({ instagramAudioId: '587784541076604' });
    expect(() => parseContentRevision({ ...deckRevision(), audio: { instagramAudioId: 'abc' } })).toThrow();
    expect(() => parseContentRevision({ ...deckRevision(), audio: { trackId: '44444444-4444-4444-8444-444444444444', instagramAudioId: '1' } })).toThrow();
    expect(dneskaiAudioChoiceKey(revision.audio)).toBe('ig:587784541076604');
    expect(dneskaiAudioFromKey('ig:587784541076604')).toEqual({ instagramAudioId: '587784541076604' });
    expect(dneskaiAudioFromKey('44444444-4444-4444-8444-444444444444')).toEqual({ trackId: '44444444-4444-4444-8444-444444444444' });
  });
});

describe('the niche ranking (#167)', () => {
  it('joins the ranking to Meta\'s list by audio id and appends the niche\'s own sounds as hints', async () => {
    const niche = [{ audioId: '1', title: 'Song', artist: 'Artist', reels: 4, plays: 1000, score: 12 }, { audioId: '9', title: 'Niche Song', artist: null, reels: 2, plays: 50, score: 4 }, { audioId: '8', title: null, artist: null, reels: 1, plays: 0, score: 1 }];
    expect(await listDneskaiAudioTrends(store().db, owner, '2026-10-23', niche)).toEqual([
      expect.objectContaining({ audioId: '1', nicheCount: 4, attachable: true }),
      { audioId: '9', title: 'Niche Song', artist: null, type: 'music', durationMs: null, coverUrl: null, daysSeen: 0, nicheCount: 2, tiktok: false, attachable: false },
    ]);
  });
});
