import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
const owner = '11111111-1111-4111-8111-111111111111', stranger = '99999999-9999-4999-8999-999999999999';
const dev = '22222222-2222-4222-8222-222222222222', dne = '22222222-2222-4222-8222-222222222223';
const revision = '33333333-3333-4333-8333-333333333333', pub = '44444444-4444-4444-8444-444444444444';
const deck = { schemaVersion: 'devshark-deck/1', cover: 'light', slides: [] };
const metrics = { reach: 100, views: null, saves: 0, shares: null, replies: null, follows: null, profileVisits: null, linkVisits: null, productionMinutes: null };
let db: PGlite;
const as = async (user = owner) => { await db.exec('reset role; set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); };
const add = (project = dev, brand = 'devshark', idea = 'promise-order') => db.query<{ link: { draft_id: string | null; topic_id: string | null } }>(
  "select public.marketing_strategy_draft($1,$2,$3,'A lesson',$4::jsonb,'Caption','https://javascript.info/','DATA','Internal brief') link", [project, brand, idea, JSON.stringify(deck)]);
const snapshot = (patch: Record<string, unknown> = {}) => {
  const row = { user: owner, project: dev, brand: 'devshark', publication: pub, observed: '2026-11-04T12:00:00Z', metrics, ...patch };
  return db.query("insert into public.marketing_strategy_results(user_id,project_id,brand,publication_id,published_at,observed_at,experiment,variant,evidence,metrics) values($1,$2,$3,$4,'2026-11-01T12:00:00Z',$5,'hook','A','Native Insights',$6::jsonb)", [row.user, row.project, row.brand, row.publication, row.observed, JSON.stringify(row.metrics)]);
};
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: '2026-11-10T18:00:00Z' });
  await db.query('insert into auth.users(id) values($1)', [stranger]);
  await db.query("insert into public.projects(id,user_id,name,slug,portfolio_key) values($1,$2,'devShark','devshark','react-express-app'),($3,$2,'DNESKAi','dneskai','aifirst')", [dev, owner, dne]);
  await db.query("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash) values($1,$2,'devshark',$3::jsonb,$4)", [revision, owner, JSON.stringify({ brand: 'devshark', title: 'Lesson', format: 'post', account: { platform: 'instagram' } }), 'a'.repeat(64)]);
  await db.query("insert into public.marketing_publications(id,user_id,revision_id,platform,status,scheduled_at,remote_media_id,remote_url) values($1,$2,$3,'instagram','published','2026-11-01T12:00:00Z','media-123','https://www.instagram.com/p/example/')", [pub, owner, revision]);
}, 120000);
afterAll(async () => { await db?.close(); });

describe('strategy persistence and own-only boundaries', () => {
  it('creates one unapproved concept per idea and never inserts a plan or approval', async () => {
    await as();
    const first = (await add()).rows[0]!.link;
    expect(first.draft_id).toBeTruthy(); expect(first.topic_id).toBeNull();
    expect((await add()).rows[0]!.link).toEqual(first);
    const rows = (await db.query<{ status: string; decided_at: string | null }>('select status,decided_at from public.marketing_devshark_drafts')).rows;
    expect(rows).toEqual([{ status: 'draft', decided_at: null }]);
    expect((await db.query('select * from public.marketing_devshark_plan')).rows).toHaveLength(0);
    await expect(db.query("insert into public.marketing_strategy_links(user_id,project_id,brand,idea_id,draft_id) values($1,$2,'devshark','other',$3)", [owner, dev, first.draft_id])).rejects.toThrow();
  });
  it('creates a proposed topic with its evidence and refuses brand/project substitution', async () => {
    await as();
    const result = (await add(dne, 'dneskai', 'porada')).rows[0]!.link;
    expect(result.topic_id).toBeTruthy();
    const topic = (await db.query<{ status: string; evidence: { urls: string[] } }>('select status,evidence from public.marketing_dneskai_topics where id=$1', [result.topic_id])).rows[0]!;
    expect(topic.status).toBe('proposed'); expect(topic.evidence.urls).toEqual(['https://javascript.info/']);
    await expect(add(dne, 'devshark')).rejects.toThrow('strategy project unavailable');
    await expect(add(dev, 'dneskai')).rejects.toThrow('strategy project unavailable');
  });
  it('rejects cross-user reads, draft creation and measurement even when the foreign ids are known', async () => {
    await as(stranger);
    expect((await db.query('select * from public.marketing_strategy_links')).rows).toHaveLength(0);
    await expect(add()).rejects.toThrow('strategy project unavailable');
    await expect(snapshot({ user: stranger })).rejects.toThrow('strategy project unavailable');
    await expect(snapshot()).rejects.toThrow();
  });
  it('stores measured zero, rejects duplicates, bad counts, future times and cross-brand receipts', async () => {
    await as(); await snapshot();
    expect((await db.query<{ metrics: typeof metrics }>('select metrics from public.marketing_strategy_results')).rows[0]!.metrics).toEqual(metrics);
    await expect(snapshot()).rejects.toThrow();
    await expect(snapshot({ brand: 'dneskai', project: dne })).rejects.toThrow('strategy publication unavailable');
    await expect(snapshot({ observed: '2027-01-01T12:00:00Z' })).rejects.toThrow('strategy observation in future');
    await expect(snapshot({ metrics: { ...metrics, saves: -1 } })).rejects.toThrow('strategy metrics invalid');
    await expect(snapshot({ metrics: { ...metrics, reach: null, saves: null } })).rejects.toThrow('strategy measurement required');
    await expect(db.query("update public.marketing_strategy_results set variant='B'")).rejects.toThrow();
    await db.exec('reset role');
    await db.query("update public.marketing_publications set status='reconciliation' where id=$1", [pub]);
    await as();
    await expect(snapshot({ observed: '2026-11-04T13:00:00Z' })).rejects.toThrow('strategy publication unavailable');
  });
});
