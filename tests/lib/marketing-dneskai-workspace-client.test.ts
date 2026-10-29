import { afterEach, describe, expect, it, vi } from 'vitest';
import { DneskaiWorkspaceRequestError, dneskaiWorkspaceKeys, liveDneskaiWorkspaceApi } from '@/lib/marketing/dneskai-workspace-client';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';

const hash = 'a'.repeat(64);
afterEach(() => vi.unstubAllGlobals());
function stub(response: Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return response; }));
  return calls;
}

describe('DNESKAi workspace client (#119)', () => {
  it('approves the exact version by its hash through the existing revisions route', async () => {
    const calls = stub(Response.json({ publicationId: '00000000-0000-4000-8000-000000000001' }));
    await liveDneskaiWorkspaceApi.approve('00000000-0000-4000-8000-000000000002', hash);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/marketing/revisions');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ action: 'approve', id: '00000000-0000-4000-8000-000000000002', expectedHash: hash });
  });
  it('turns an approval refusal into its reason code and never into server text', async () => {
    stub(Response.json({ error: 'approval-unavailable', reason: 'render-blocked' }, { status: 409 }));
    await expect(liveDneskaiWorkspaceApi.approve('00000000-0000-4000-8000-000000000002', hash)).rejects.toMatchObject({ code: 'render-blocked', status: 409 });
    stub(Response.json({ error: 'Bearer PRIVATE text' }, { status: 500 }));
    await expect(liveDneskaiWorkspaceApi.approve('00000000-0000-4000-8000-000000000002', hash)).rejects.toMatchObject({ code: 'decision-failed' });
    stub(new Response('', { status: 429 }));
    await expect(liveDneskaiWorkspaceApi.decide('00000000-0000-4000-8000-000000000002', 'skipped')).rejects.toBeInstanceOf(DneskaiWorkspaceRequestError);
  });
  it('sends a return note trimmed and bounded, and a skip without one', async () => {
    let calls = stub(Response.json({ ok: true }));
    await liveDneskaiWorkspaceApi.decide('00000000-0000-4000-8000-000000000002', 'returned', `  ${'n'.repeat(2100)}  `);
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ action: 'returned', id: '00000000-0000-4000-8000-000000000002', feedback: 'n'.repeat(2000) });
    calls = stub(Response.json({ ok: true }));
    await liveDneskaiWorkspaceApi.decide('00000000-0000-4000-8000-000000000002', 'skipped', '   ');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ action: 'skipped', id: '00000000-0000-4000-8000-000000000002' });
  });
  it('validates the edit result and the review read before the UI sees them', async () => {
    stub(Response.json({ id: 'not-a-uuid' }));
    await expect(liveDneskaiWorkspaceApi.edit({ action: 'edit', id: '00000000-0000-4000-8000-000000000002', caption: 'x', scheduledAt: '2099-01-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'render-attach-failed' });
    // A saved version whose render did not attach comes back with its id, so the editor can move to it.
    stub(Response.json({ id: '00000000-0000-4000-8000-000000000003', ready: false, error: 'render-attach-failed' }, { status: 502 }));
    await expect(liveDneskaiWorkspaceApi.edit({ action: 'edit', id: '00000000-0000-4000-8000-000000000002', caption: 'x', scheduledAt: '2099-01-01T00:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'render-attach-failed', status: 502, revisionId: '00000000-0000-4000-8000-000000000003' });
    stub(Response.json({ id: 'nope', error: 'render-attach-failed' }, { status: 502 }));
    await expect(liveDneskaiWorkspaceApi.edit({ action: 'edit', id: '00000000-0000-4000-8000-000000000002', caption: 'x', scheduledAt: '2099-01-01T00:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'render-attach-failed', revisionId: null });
    const read = createDneskaiWorkspaceFixture(new Date('2026-10-24T09:00:00Z'));
    const calls = stub(Response.json(read));
    await expect(liveDneskaiWorkspaceApi.loadReview('22222222-2222-4222-8222-222222222222')).resolves.toMatchObject({ today: '2026-10-24' });
    expect(calls[0]!.url).toBe('/api/marketing/dneskai/review?projectId=22222222-2222-4222-8222-222222222222');
    stub(Response.json({ ...read, posts: [{ ...read.posts[0], caption: 'PRIVATE'.repeat(400) }] }));
    await expect(liveDneskaiWorkspaceApi.loadReview('22222222-2222-4222-8222-222222222222')).rejects.toThrow();
  });
  it('keys every read per project under the centralised marketing keys', () => {
    const keys = dneskaiWorkspaceKeys('p1');
    expect(keys.review).toEqual(['marketing', 'dneskai-review', 'p1']);
    expect(keys.costs).toEqual(['marketing', 'dneskai-costs', 'p1']);
    expect(keys.media('c1')).toEqual(['marketing', 'dneskai-media', 'p1', 'c1']);
  });
});

describe('DNESKAi workspace client: decisions 6, 8 and 9', () => {
  const id = '00000000-0000-4000-8000-000000000002', job = '00000000-0000-4000-8000-000000000003';
  it('binds approve-at to the hash and the slot shown, and turns a moved slot into its code', async () => {
    let calls = stub(Response.json({ id, scheduledAt: '2026-10-22T10:30:00.000Z', publicationId: job }));
    expect(await liveDneskaiWorkspaceApi.approveAt(id, hash, '2026-10-22T10:30:00.000Z')).toEqual({ id, scheduledAt: '2026-10-22T10:30:00.000Z' });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ action: 'approve-at', id, expectedHash: hash, scheduledAt: '2026-10-22T10:30:00.000Z' });
    calls = stub(Response.json({ error: 'slot-unavailable', scheduledAt: '2026-10-22T15:00:00.000Z' }, { status: 409 }));
    await expect(liveDneskaiWorkspaceApi.approveAt(id, hash, '2026-10-22T10:30:00.000Z')).rejects.toMatchObject({ code: 'slot-unavailable', status: 409 });
  });
  it('sends a regeneration note trimmed and bounded, and generate now to its own route', async () => {
    let calls = stub(Response.json({ jobId: job, status: 'queued', scheduling: 'tick' }, { status: 202 }));
    expect(await liveDneskaiWorkspaceApi.regenerate(id, hash, `  ${'n'.repeat(1200)} `)).toMatchObject({ jobId: job, status: 'queued' });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ action: 'regenerate', id, expectedHash: hash, note: 'n'.repeat(1000) });
    calls = stub(Response.json({ jobId: job, status: 'failed', errorCode: 'dneskai-daily-generation-budget-exhausted' }, { status: 202 }));
    expect(await liveDneskaiWorkspaceApi.generateNow(id)).toEqual({ jobId: job, status: 'failed', errorCode: 'dneskai-daily-generation-budget-exhausted' });
    expect(calls[0]!.url).toBe('/api/marketing/dneskai/generate');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ action: 'generate-now', briefId: id });
    stub(Response.json({ error: 'dneskai-daily-generation-budget-exhausted' }, { status: 409 }));
    await expect(liveDneskaiWorkspaceApi.generateNow(id)).rejects.toMatchObject({ code: 'dneskai-daily-generation-budget-exhausted' });
  });
});


it('preserves numeric and HTTP-date Retry-After cooldowns without exposing response text', async () => {
  stub(Response.json({ error: 'rate-limited' }, { status: 429, headers: { 'Retry-After': '15' } }));
  await expect(liveDneskaiWorkspaceApi.decide('00000000-0000-4000-8000-000000000002', 'skipped')).rejects.toMatchObject({ retryAfterMs: 15000 });
  const deadline = new Date(Date.now() + 30000).toUTCString();
  stub(new Response('', { status: 503, headers: { 'Retry-After': deadline } }));
  try { await liveDneskaiWorkspaceApi.decide('00000000-0000-4000-8000-000000000002', 'skipped'); }
  catch (error) { expect((error as DneskaiWorkspaceRequestError).retryAfterMs).toBeGreaterThan(28000); }
});

it('binds the Calendar response contract to its requested complete view',async()=>{
 const base=createDneskaiWorkspaceFixture(new Date('2026-10-28T10:00:00Z')),project='22222222-2222-4222-8222-222222222222';
 let calls=stub(Response.json({...base,calendarComplete:true}));
 expect((await liveDneskaiWorkspaceApi.loadReview(project,undefined,undefined,'calendar')).calendarComplete).toBe(true);expect(new URL(calls[0]!.url,'https://own.example').searchParams.get('view')).toBe('calendar');
 stub(Response.json(base));await expect(liveDneskaiWorkspaceApi.loadReview(project,undefined,undefined,'calendar')).rejects.toMatchObject({code:'dneskai-workspace-unavailable'});
 calls=stub(Response.json({...base,calendarComplete:true}));await expect(liveDneskaiWorkspaceApi.loadReview(project)).rejects.toMatchObject({code:'dneskai-workspace-unavailable'});expect(new URL(calls[0]!.url,'https://own.example').searchParams.has('view')).toBe(false);
});
