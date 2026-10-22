import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { dneskaiDefaultRevisionFormat } from '@/lib/marketing/dneskai-reel-format';
import { requestDneskaiReelRender } from '@/lib/marketing/dneskai-reel';

describe('default format of a new post (#165)', () => {
  it('starts education posts as a Reel and news as a carousel, only while Reels are on', () => {
    const on = { MARKETING_DNESKAI_REELS_ENABLED: 'true' };
    expect(dneskaiDefaultRevisionFormat('carousel', 'tool', on)).toBe('reel');
    expect(dneskaiDefaultRevisionFormat('carousel', 'ai-project', on)).toBe('reel');
    expect(dneskaiDefaultRevisionFormat('carousel', 'ai-news', on)).toBe('carousel');
    expect(dneskaiDefaultRevisionFormat('carousel', 'tool', {})).toBe('carousel');
    expect(dneskaiDefaultRevisionFormat('single-image', 'tool', on)).toBe('post');
  });
});

describe('requestDneskaiReelRender', () => {
  const secret = 's'.repeat(40);
  const revisionId = '22222222-2222-4222-8222-222222222222';
  it('posts a scheduler-signed async request to this deployment and accepts 202', async () => {
    const fetcher = vi.fn(async () => new Response('{"status":"rendering"}', { status: 202 }));
    expect(await requestDneskaiReelRender({ origin: 'https://own.example', revisionId, audioTrackId: null, env: { MARKETING_SCHEDULER_SECRET: secret }, fetcher })).toBe(true);
    const [url, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://own.example/api/marketing/dneskai/render-reel');
    expect(JSON.parse(String(init.body))).toEqual({ revisionId, audioTrackId: null, async: true });
    const time = init.headers['X-Marketing-Timestamp'];
    expect(init.headers['X-Marketing-Signature']).toBe(createHmac('sha256', secret).update(`${time}.${init.body}`).digest('hex'));
  });
  it('sends nothing without a usable secret or to a plain-http host, and reports a refusal', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 404 }));
    expect(await requestDneskaiReelRender({ origin: 'https://own.example', revisionId, audioTrackId: null, env: {}, fetcher })).toBe(false);
    expect(await requestDneskaiReelRender({ origin: 'http://own.example', revisionId, audioTrackId: null, env: { MARKETING_SCHEDULER_SECRET: secret }, fetcher })).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await requestDneskaiReelRender({ origin: 'https://own.example', revisionId, audioTrackId: null, env: { MARKETING_SCHEDULER_SECRET: secret }, fetcher })).toBe(false);
  });
});
