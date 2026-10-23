import { writeFileSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { createMigratedDatabase } from '../helpers/supabase-pglite';

/** Local measurements only: existing synthetic fixtures and an isolated migrated PostgreSQL database. */
describe('DNESKAi audit measurements', () => {
  it('measures bounded payloads, private-thumbnail candidates and owner-scoped query plans', async () => {
    const fixture = createDneskaiWorkspaceFixture(new Date('2026-10-23T12:00:00Z'));
    const posts = Array.from({ length: 60 }, (_, index) => ({ ...fixture.posts[index % fixture.posts.length]!, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
    const full = JSON.stringify({ ...fixture, posts });
    const summary = JSON.stringify(posts.map(post => ({ id: post.id, title: post.title, status: post.status, contentHash: post.contentHash, scheduledAt: post.scheduledAt, cover: post.assets?.[0] ?? null })));
    const payload = (json: string) => {
      const samples = Array.from({ length: 5 }, () => { const start = performance.now(); for (let i = 0; i < 100; i++) JSON.parse(json); return (performance.now() - start) / 100; }).sort((a, b) => a - b);
      return { bytes: Buffer.byteLength(json), gzipBytes: gzipSync(json).length, brotliBytes: brotliCompressSync(json).length, medianParseMs: samples[2] };
    };
    const image = await sharp('public/demo/dneskai/slide-a4.jpg').metadata();
    const originalBytes = (await sharp('public/demo/dneskai/slide-a4.jpg').toBuffer()).length;
    const derivative = await sharp('public/demo/dneskai/slide-a4.jpg').resize({ width: 192 }).webp({ quality: 78 }).toBuffer();
    const owner = '11111111-1111-4111-8111-111111111111';
    const db = await createMigratedDatabase({ owner, instant: '2026-10-23T12:00:00Z' });
    try {
      await db.query(`insert into public.marketing_revisions(user_id,brand,revision,content_hash,status,created_at)
        select $1::uuid,case when n%5=0 then 'dneskai' else 'devshark' end,'{}',repeat('a',64),
          case when n%17=0 then 'review' when n%19=0 then 'returned' else 'published' end,
          '2026-10-23T12:00:00Z'::timestamptz-n*interval '1 minute' from generate_series(1,25000) n`, [owner]);
      await db.exec('analyze public.marketing_revisions');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      const sql = `select id,status,created_at from public.marketing_revisions where user_id=$1::uuid and brand='dneskai' and status in('review','returned') order by created_at desc,id desc limit 31`;
      const plan = async () => {
        await db.exec('set role authenticated');
        try { return (await db.query<Record<string, unknown>>(`explain (analyze,buffers,format json) ${sql}`, [owner])).rows[0]!['QUERY PLAN']; }
        finally { await db.exec('reset role'); }
      };
      const before = await plan();
      await db.exec("create index audit_decisions_candidate on public.marketing_revisions(user_id,brand,created_at desc,id desc) where status in('review','returned')");
      const after = await plan();
      const size = (await db.query<{ bytes: number }>("select pg_relation_size('audit_decisions_candidate')::int as bytes")).rows[0]!.bytes;
      expect((await db.query(sql, [owner])).rows).toHaveLength(31);
      const other = '22222222-2222-4222-8222-222222222222';
      expect((await db.query(sql, [other])).rows).toHaveLength(0);
      const result = {
        measuredAt: '2026-10-23', environment: 'Synthetic fixtures; PGlite/WASM PostgreSQL; warm local process. No Production timing or network latency.',
        payload: { posts: posts.length, full: payload(full), summaryExperiment: payload(summary) },
        thumbnail: { source: 'public/demo/dneskai/slide-a4.jpg', width: image.width, height: image.height, originalBytes, derivativeWidth: 192, webpBytes: derivative.length, uniqueTenSlideOriginalBytes: originalBytes * 10, uniqueTenSlideDerivativeBytes: derivative.length * 10, note: 'Derivative is an experiment, not approval media. Identical URLs can share the browser cache.' },
        database: { rows: 25000, existingPlan: before, candidatePlan: after, candidateIndexBytes: size, note: 'Candidate index exists only in this disposable database. Live cardinality, write cost and Production plans remain unmeasured.' },
      };
      if (process.env.DNESKAI_AUDIT_MEASURE_OUT) writeFileSync(process.env.DNESKAI_AUDIT_MEASURE_OUT, JSON.stringify(result, null, 2) + '\n');
    } finally { await db.close(); }
  }, 120_000);
});
