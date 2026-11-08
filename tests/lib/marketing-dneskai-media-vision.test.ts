import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { parseDneskaiVision, rankDneskaiMedia, dneskaiVisionConfiguration } from '@/lib/marketing/dneskai-media-vision';
import { dneskaiOfferableMediaAssets, type DneskaiMediaAssetView } from '@/lib/marketing/dneskai-media-contracts';
import type { DneskaiMediaDatabase } from '@/lib/marketing/dneskai-media';
import { scene } from './marketing-dneskai-media-fixture';

const owner = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const env = { MARKETING_DNESKAI_VISION_ENABLED: 'true', MARKETING_AI_CONSENT: 'true', ANTHROPIC_API_KEY: 'offline-test-key' };

/** A Supabase stand-in that answers each table from fixed rows and records updates. */
function fakeDb(tables: Record<string, unknown>) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const from = (table: string) => {
    let update: Record<string, unknown> | null = null;
    const result = () => update ? { data: null, error: null } : { data: tables[table] ?? [], error: null };
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, gte: () => builder, in: () => builder, order: () => builder, limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: (tables[`${table}:one`] ?? null), error: null }),
      update: (values: Record<string, unknown>) => { update = values; updates.push({ table, values }); return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  };
  return { db: { from } as unknown as DneskaiMediaDatabase, updates };
}

describe('Claude vision ranking of DNESKAi pictures (8 November 2026)', () => {
  it('runs only with the switch, the consent and a key', () => {
    expect(dneskaiVisionConfiguration({})).toBeNull();
    expect(dneskaiVisionConfiguration({ ...env, MARKETING_AI_CONSENT: 'false' })).toBeNull();
    expect(dneskaiVisionConfiguration(env)).toMatchObject({ model: 'claude-sonnet-5-5', dailyUsd: 1 });
  });

  it('reads the answer and never scores a flagged picture above 3', () => {
    expect(parseDneskaiVision('Here: {"pictures":[{"index":0,"score":9,"flags":["logo-only"]},{"index":1,"score":7.6,"flags":[],"focal":{"x":0.3,"y":0.4}}]}')).toEqual([
      { index: 0, score: 3, flags: ['logo-only'] }, { index: 1, score: 8, flags: [], focal: { x: 0.3, y: 0.4 } },
    ]);
    expect(parseDneskaiVision('no json')).toBeNull();
    expect(parseDneskaiVision('{"pictures":[{"index":0,"score":11}]}')).toBeNull();
  });

  it('sends the thumbnails and the title, then stores scores, flags, focal point and cost', async () => {
    const bytes = await scene(0, 1440, 1800).jpeg().toBuffer();
    const links = [{ id: '33333333-3333-4333-8333-333333333333', position: 0, asset: { sha256: 'a'.repeat(64), purged_at: null } }, { id: '44444444-4444-4444-8444-444444444444', position: 1, asset: { sha256: 'b'.repeat(64), purged_at: null } }];
    const { db, updates } = fakeDb({ 'marketing_media_collections:one': { ranked_at: null }, marketing_media_collections: [{ rank_cost_usd: 0.02 }], marketing_media_asset_links: links });
    let sent: { model: string; messages: Array<{ content: Array<{ type: string; text?: string }> }> } | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"pictures":[{"index":0,"score":8,"flags":[],"focal":{"x":0.5,"y":0.3}},{"index":1,"score":2,"flags":["chrome-screenshot"]}]}' }], usage: { input_tokens: 2000, output_tokens: 100 } }), { status: 200 });
    }) as typeof fetch;
    const result = await rankDneskaiMedia(db, owner, project, { id: 'candidate-1', title: 'OpenAI ukázala nový model' }, { load: async () => bytes, env, fetchImpl });
    expect(result).toMatchObject({ status: 'ranked', pictures: 2 });
    expect(result.costUsd).toBeCloseTo(0.005, 6);
    expect(sent!.model).toBe('claude-sonnet-5-5');
    expect(sent!.messages[0]!.content.filter((block) => block.type === 'image')).toHaveLength(2);
    expect(sent!.messages[0]!.content.at(-1)!.text).toContain('OpenAI ukázala nový model');
    expect(updates.filter((update) => update.table === 'marketing_media_asset_links').map((update) => update.values)).toEqual([
      expect.objectContaining({ vision_score: 8, vision_flags: [], focal_x: 0.5, focal_y: 0.3 }), expect.objectContaining({ vision_score: 2, vision_flags: ['chrome-screenshot'], focal_x: null }),
    ]);
    expect(updates.find((update) => update.table === 'marketing_media_collections')!.values).toMatchObject({ rank_cost_usd: 0.005 });
  });

  it('ranks each candidate once and stops at the daily ceiling', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const ranked = fakeDb({ 'marketing_media_collections:one': { ranked_at: '2026-11-08T10:00:00Z' } });
    expect(await rankDneskaiMedia(ranked.db, owner, project, { id: 'c', title: 't' }, { load: async () => Buffer.alloc(0), env, fetchImpl })).toMatchObject({ status: 'skipped', code: 'vision-already-ranked' });
    const spent = fakeDb({ 'marketing_media_collections:one': { ranked_at: null }, marketing_media_collections: [{ rank_cost_usd: 0.99 }] });
    expect(await rankDneskaiMedia(spent.db, owner, project, { id: 'c', title: 't' }, { load: async () => Buffer.alloc(0), env, fetchImpl })).toMatchObject({ status: 'skipped', code: 'vision-daily-ceiling' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never offers a flagged picture to the brief', () => {
    const asset = (id: string, flags?: string[]) => ({ assetId: id, sha256: id.replace(/-/g, '').padEnd(64, '0').slice(0, 64), position: 0, originKind: 'og-image', originUrl: 'https://example.com/a.jpg', credit: 'Foto: X', width: 1200, height: 1200,
      mime: 'image/jpeg', bytes: 1, fetchedAt: '2026-11-08T00:00:00Z', fullBleedCapable: true, insetCapable: true, phash: null, duplicateOfAssetId: null, duplicateOfSha256: null, purged: false, previewUrl: null, ...(flags ? { visionFlags: flags } : {}) }) as DneskaiMediaAssetView;
    const offered = dneskaiOfferableMediaAssets({ assets: [asset('55555555-5555-4555-8555-555555555555'), asset('66666666-6666-4666-8666-666666666666', ['logo-only'])] });
    expect(offered.map((item) => item.assetId)).toEqual(['55555555-5555-4555-8555-555555555555']);
  });
});
