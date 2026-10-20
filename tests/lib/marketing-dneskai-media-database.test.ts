import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Real migration SQL in an isolated WASM database. Every URL, hash and candidate is a synthetic fixture.
const owner = '11111111-1111-4111-8111-111111111111';
const other = '99999999-9999-4999-8999-999999999999';
const project = '22222222-2222-4222-8222-222222222222';
const foreignProject = '44444444-4444-4444-8444-444444444444';
const fence = '55555555-5555-4555-8555-555555555555';
const otherFence = '66666666-6666-4666-8666-666666666666';
const run = '77777777-7777-4777-8777-777777777777';
const json = JSON.stringify;
const sha = (n: number) => n.toString(16).padStart(64, '0');
let db: PGlite;

async function as<T>(role: 'authenticated' | 'anon' | 'service_role', sub: string | null, action: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sub ?? '']);
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec('reset role'); }
}
const at = (instant: string) => db.query("select set_config('marketing.test_time',$1,false)", [instant]);
const service = <T>(sql: string, params: unknown[]) => as('service_role', null, async () => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T);
const begin = (candidate: string, f = fence, user = owner) => service<Record<string, unknown>>('select marketing_media_begin($1,$2,$3,$4) r', [user, project, candidate, f]);
const setPlan = (candidate: string, plan: unknown, page = 'not-applicable', error: string | null = null, f = fence) =>
  service('select marketing_media_set_plan($1,$2,$3,$4,$5,$6,$7) r', [owner, project, candidate, f, plan === null ? null : json(plan), page, error]);
const record = (candidate: string, asset: Record<string, unknown>, f = fence) => service<Record<string, unknown>>('select marketing_media_record_asset($1,$2,$3,$4,$5) r', [owner, project, candidate, f, json(asset)]);
const finish = (candidate: string, status: string, skipped: unknown[] = [], f = fence) => service<Record<string, unknown>>('select marketing_media_finish($1,$2,$3,$4,$5,$6) r', [owner, project, candidate, f, status, json(skipped)]);
function asset(position: number, patch: Record<string, unknown> = {}) {
  return { sha256: sha(position + 1), position, originUrl: `https://scontent.cdninstagram.test/${position}.jpg`, originKind: position === 0 ? 'instagram-display' : 'instagram-child',
    width: 1080, height: 1350, mime: 'image/jpeg', bytes: 1000 + position, phash: null, credit: 'Foto: @mosseri', uploaded: true, ...patch };
}
const igPlan = (count: number) => Array.from({ length: count }, (_, position) => ({ position, url: `https://scontent.cdninstagram.test/${position}.jpg`, kind: position === 0 ? 'instagram-display' : 'instagram-child' }));
async function insertCandidate(id: string, status = 'selected', user = owner, projectId = project) {
  await db.query("insert into marketing_dneskai_candidates(id,user_id,project_id,run_id,candidate,canonical_url_hash,normalized_text_hash,content_hash,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [id, user, projectId, run, json({ id, sourceId: 'instagram:mosseri', externalId: `OFFLINE-${id}`, status }), `url-${id}`, `text-${id}`, sha(id.length * 7919 + id.charCodeAt(id.length - 1)), status]);
}

beforeAll(async () => {
  db = new PGlite();
  // Mirrors Supabase defaults: new tables and functions are granted to API roles unless revoked.
  await db.exec(`create schema auth; create schema storage; create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    grant usage on schema auth,storage,public to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb default '{}',unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant execute on function auth.uid(),storage.foldername(text) to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;
    -- Deliberately broad pre-existing feature policy: the restrictive guards must still hold.
    create policy existing_feature_access on storage.objects for all to anon,authenticated using(true) with check(true);
    create table public.projects(id uuid primary key,user_id uuid,portfolio_key text,repo_full_name text,parent_id uuid,previous_repo_full_names text[] default '{}');
    create table public.user_preferences(hidden_project_tabs text[] default '{}');
    create table public.ai_links(id uuid primary key,user_id uuid not null);
    create schema marketing_private; create table marketing_private.generation_pilots(user_id uuid primary key,starts_at timestamptz,expires_at timestamptz);
    create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$ select current_setting('marketing.test_time')::timestamptz $$;`);
  await at('2026-10-20T21:00:00Z');
  await db.query('insert into auth.users values($1),($2)', [owner, other]);
  await db.query("insert into projects(id,user_id,portfolio_key) values($1,$2,'aifirst'),($3,$4,'aifirst')", [project, owner, foreignProject, other]);
  for (const file of ['20261012225640_marketing_control_surface.sql', '20261013001528_marketing_private_assets.sql', '20261013165236_marketing_dneskai_collection.sql', '20261020130000_dneskai_source_media.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.query("insert into marketing_dneskai_runs(id,user_id,project_id,date,target_date) values($1,$2,$3,'2026-10-20','2026-10-21')", [run, owner, project]);
  for (const id of ['cand-a', 'cand-b', 'cand-c', 'cand-d', 'cand-e']) await insertCandidate(id);
  await insertCandidate('cand-held', 'held');
}, 30000);
afterAll(async () => { await db?.close(); });

describe('marketing-media bucket', () => {
  it('is a separate private bucket for original JPEG, PNG and WebP up to 32 MiB; marketing-assets is untouched', async () => {
    const { rows } = await db.query('select id,public,file_size_limit::int size,allowed_mime_types from storage.buckets order by id');
    expect(rows).toEqual([
      { id: 'marketing-assets', public: false, size: 8388608, allowed_mime_types: ['image/jpeg'] },
      { id: 'marketing-media', public: false, size: 33554432, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] },
    ]);
  });
  it('lets the signed-in owner read only their own prefix and refuses every browser write', async () => {
    await as('service_role', null, () => db.query("insert into storage.objects(bucket_id,name) values('marketing-media',$1),('marketing-media',$2)", [`${owner}/${sha(1)}.jpg`, `${other}/${sha(2)}.png`]));
    expect((await as('authenticated', owner, () => db.query<{ name: string }>("select name from storage.objects where bucket_id='marketing-media'"))).rows.map(row => row.name)).toEqual([`${owner}/${sha(1)}.jpg`]);
    expect((await as('anon', null, () => db.query("select name from storage.objects where bucket_id='marketing-media'"))).rows).toEqual([]);
    for (const role of ['anon', 'authenticated'] as const) {
      await as(role, owner, async () => {
        await expect(db.query("insert into storage.objects(bucket_id,name) values('marketing-media',$1)", [`${owner}/${sha(3)}.jpg`])).rejects.toThrow('row-level security');
        expect((await db.query("update storage.objects set metadata='{\"x\":1}' where bucket_id='marketing-media' returning id")).rows).toEqual([]);
        expect((await db.query("delete from storage.objects where bucket_id='marketing-media' returning id")).rows).toEqual([]);
      });
    }
    expect((await db.query("select * from storage.objects where bucket_id='marketing-media'")).rows).toHaveLength(2);
    await db.query("delete from storage.objects where bucket_id='marketing-media'");
  });
});

describe('marketing_media tables: own-only reads, service-role functions only', () => {
  it('grants the owner select only and every function to the service role only', async () => {
    for (const table of ['marketing_media_assets', 'marketing_media_asset_links', 'marketing_media_collections']) {
      const { rows } = await db.query<Record<string, boolean>>("select has_table_privilege('anon',$1,'select') anon_s,has_table_privilege('authenticated',$1,'select') auth_s,has_table_privilege('authenticated',$1,'insert') auth_i,has_table_privilege('authenticated',$1,'update') auth_u,has_table_privilege('authenticated',$1,'delete') auth_d,(select relrowsecurity from pg_class where relname=$2) rls", [`public.${table}`, table]);
      expect(rows[0], table).toEqual({ anon_s: false, auth_s: true, auth_i: false, auth_u: false, auth_d: false, rls: true });
    }
    for (const signature of ['marketing_media_begin(uuid,uuid,text,uuid)', 'marketing_media_set_plan(uuid,uuid,text,uuid,jsonb,text,text)', 'marketing_media_record_asset(uuid,uuid,text,uuid,jsonb)', 'marketing_media_finish(uuid,uuid,text,uuid,text,jsonb)', 'marketing_media_lookup(uuid,text)', 'marketing_media_claim_purge(uuid,integer,integer)', 'marketing_media_unmark_purge(uuid,jsonb)']) {
      const { rows } = await db.query<Record<string, boolean>>("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service", [signature]);
      expect(rows[0], signature).toEqual({ anon: false, authenticated: false, service: true });
    }
  });
  it('claims only selected candidates and only once while a lease is live', async () => {
    expect(await begin('cand-held')).toEqual({ claimed: false, reason: 'candidate-not-selected' });
    expect(await begin('missing')).toEqual({ claimed: false, reason: 'candidate-not-selected' });
    expect(await begin('cand-a', fence, other)).toEqual({ claimed: false, reason: 'candidate-not-selected' });
    const claimed = await begin('cand-a');
    expect(claimed).toMatchObject({ claimed: true, links: [], state: { status: 'pending', plan: null, page_status: 'not-applicable' } });
    expect(JSON.stringify(claimed)).not.toContain(fence);
    expect(await begin('cand-a', otherFence)).toEqual({ claimed: false, reason: 'collection-busy' });
    await expect(setPlan('cand-a', igPlan(3), 'not-applicable', null, otherFence)).rejects.toThrow('fence');
  });
  it('fixes one ordered plan and stores each picture once per owner, linked to every candidate that uses it', async () => {
    await expect(setPlan('cand-a', [{ position: 0, url: 'http://insecure.test/a.jpg', kind: 'instagram-display' }])).rejects.toThrow('plan invalid');
    await expect(setPlan('cand-a', [{ position: 0, url: 'https://a.test/a.jpg', kind: 'instagram-display' }, { position: 0, url: 'https://a.test/b.jpg', kind: 'instagram-child' }])).rejects.toThrow('plan invalid');
    await setPlan('cand-a', igPlan(3));
    await expect(setPlan('cand-a', igPlan(2))).rejects.toThrow('already fixed');
    await expect(record('cand-a', asset(0, { uploaded: false }))).rejects.toThrow('upload required');
    await expect(record('cand-a', asset(5))).rejects.toThrow('outside plan');
    await expect(record('cand-a', asset(0, { originUrl: 'https://elsewhere.test/0.jpg' }))).rejects.toThrow('outside plan');
    const first = await record('cand-a', asset(0));
    expect(first).toMatchObject({ created: true, linkedPosition: 0, duplicateOfAssetId: null, sha256: sha(1) });
    // displayUrl and images[0] are often the same file: the same bytes link once, at the first position.
    expect(await record('cand-a', asset(1, { sha256: sha(1), bytes: 1000 }))).toMatchObject({ created: false, linkedPosition: 0, assetId: first.assetId });
    await expect(record('cand-a', asset(2, { sha256: sha(1), width: 640 }))).rejects.toThrow('metadata mismatch');
    await record('cand-a', asset(2));
    expect(await finish('cand-a', 'complete', [{ position: 1, code: 'media-duplicate-bytes', retryable: false, attempts: 1 }])).toMatchObject({ status: 'complete', asset_count: 2 });
    expect(await begin('cand-a')).toMatchObject({ claimed: false, reason: 'collection-finished', state: { status: 'complete' } });
    // The same picture fetched for a second candidate is not stored again.
    await begin('cand-b');
    await setPlan('cand-b', [{ position: 0, url: 'https://cdn.publisher.test/hero.jpg', kind: 'og-image' }]);
    const reused = await record('cand-b', asset(0, { originUrl: 'https://cdn.publisher.test/hero.jpg', originKind: 'og-image', credit: 'Obrázek: Publisher', uploaded: false }));
    expect(reused).toMatchObject({ created: false, assetId: first.assetId, linkedPosition: 0 });
    await finish('cand-b', 'complete');
    expect((await db.query('select * from marketing_media_assets where sha256=$1', [sha(1)])).rows).toHaveLength(1);
    expect((await db.query<{ candidate_id: string; credit: string }>('select candidate_id,credit from marketing_media_asset_links where asset_id=$1 order by candidate_id', [first.assetId])).rows)
      .toEqual([{ candidate_id: 'cand-a', credit: 'Foto: @mosseri' }, { candidate_id: 'cand-b', credit: 'Obrázek: Publisher' }]);
    const stored = (await db.query<Record<string, unknown>>('select storage_path,origin_kind,candidate_id,source_id,external_id,credit from marketing_media_assets where id=$1', [first.assetId])).rows[0];
    expect(stored).toEqual({ storage_path: `marketing-media/${owner}/${sha(1)}.jpg`, origin_kind: 'instagram-display', candidate_id: 'cand-a', source_id: 'instagram:mosseri', external_id: 'OFFLINE-cand-a', credit: 'Foto: @mosseri' });
  });
  it('refuses inconsistent finishes and keeps the linked count authoritative', async () => {
    await begin('cand-c');
    await expect(finish('cand-c', 'complete')).rejects.toThrow('result invalid');
    await expect(finish('cand-c', 'pending', [{ position: 0, code: 'Not A Code', retryable: true, attempts: 1 }])).rejects.toThrow('result invalid');
    // A retryable article-page failure keeps the plan open for at most three reads.
    await setPlan('cand-c', null, 'failed', 'media-page-timeout');
    await setPlan('cand-c', null, 'failed', 'media-page-timeout');
    await expect(setPlan('cand-c', null, 'failed', 'media-page-timeout')).rejects.toThrow('plan invalid');
    await setPlan('cand-c', [], 'failed', 'media-page-timeout');
    expect(await finish('cand-c', 'empty')).toMatchObject({ status: 'empty', asset_count: 0, page_attempts: 3, page_status: 'failed', page_error: 'media-page-timeout' });
  });
  it('marks a near-identical picture as a duplicate of the larger one, which stays canonical', async () => {
    await begin('cand-d');
    await setPlan('cand-d', igPlan(3));
    const small = await record('cand-d', asset(0, { sha256: sha(100), width: 640, height: 800, bytes: 500, phash: 'f0f0f0f0f0f0f0f0' }));
    expect(small.duplicateOfAssetId).toBeNull();
    const large = await record('cand-d', asset(1, { sha256: sha(101), width: 1440, height: 1800, bytes: 900, phash: 'f0f0f0f0f0f0f0f3' }));
    expect(large.duplicateOfAssetId).toBeNull();
    const far = await record('cand-d', asset(2, { sha256: sha(102), phash: '0f0f0f0f0f0f0f0f' }));
    expect(far.duplicateOfAssetId).toBeNull();
    const rows = (await db.query<{ sha256: string; duplicate_of_asset_id: string | null }>('select sha256,duplicate_of_asset_id from marketing_media_assets where sha256 in($1,$2,$3) order by sha256', [sha(100), sha(101), sha(102)])).rows;
    expect(rows).toEqual([{ sha256: sha(100), duplicate_of_asset_id: large.assetId }, { sha256: sha(101), duplicate_of_asset_id: null }, { sha256: sha(102), duplicate_of_asset_id: null }]);
    // A later, smaller copy points at the canonical picture directly.
    await finish('cand-d', 'complete');
    await begin('cand-e');
    await setPlan('cand-e', igPlan(1));
    expect((await record('cand-e', asset(0, { sha256: sha(103), width: 320, height: 400, bytes: 100, phash: 'f0f0f0f0f0f0f0f1' }))).duplicateOfAssetId).toBe(large.assetId);
    await finish('cand-e', 'complete');
  });
  it('lets the owner read only their own rows and never write them', async () => {
    const counts = await as('authenticated', owner, async () => ({
      assets: (await db.query('select * from marketing_media_assets')).rows.length,
      links: (await db.query('select * from marketing_media_asset_links')).rows.length,
      collections: (await db.query('select * from marketing_media_collections')).rows.length,
    }));
    expect(counts).toEqual({ assets: 6, links: 7, collections: 5 });
    expect(await as('authenticated', other, async () => (await db.query('select * from marketing_media_assets')).rows.length)).toBe(0);
    await expect(as('anon', null, () => db.query('select * from marketing_media_assets'))).rejects.toThrow('permission denied');
    await expect(as('authenticated', owner, () => db.query("update marketing_media_assets set credit='x'"))).rejects.toThrow('permission denied');
    await expect(as('authenticated', owner, () => db.query('delete from marketing_media_asset_links'))).rejects.toThrow('permission denied');
    await expect(as('authenticated', owner, () => db.query('select marketing_media_lookup($1,$2)', [owner, sha(1)]))).rejects.toThrow('permission denied');
  });
  it('checks ownership and the storage path even for service-role writes', async () => {
    await expect(db.query("insert into marketing_media_assets(user_id,project_id,sha256,candidate_id,source_id,external_id,origin_url,origin_kind,position,width,height,mime,bytes,storage_path,credit) values($1,$2,$3,'c','s','e','https://a.test/x.jpg','og-image',0,1,1,'image/jpeg',1,$4,'Obrázek: X')",
      [owner, foreignProject, sha(200), `marketing-media/${owner}/${sha(200)}.jpg`])).rejects.toThrow('foreign media project');
    await expect(db.query("insert into marketing_media_assets(user_id,project_id,sha256,candidate_id,source_id,external_id,origin_url,origin_kind,position,width,height,mime,bytes,storage_path,credit) values($1,$2,$3,'c','s','e','https://a.test/x.jpg','og-image',0,1,1,'image/png',1,$4,'Obrázek: X')",
      [owner, project, sha(201), `marketing-media/${owner}/${sha(201)}.jpg`])).rejects.toThrow('check constraint');
    await expect(db.query("insert into marketing_media_assets(user_id,project_id,sha256,candidate_id,source_id,external_id,origin_url,origin_kind,position,width,height,mime,bytes,storage_path,credit) values($1,$2,$3,'c','s','e','https://a.test/x.jpg','og-image',0,1,1,'image/jpeg',1,$4,' ')",
      [owner, project, sha(202), `marketing-media/${owner}/${sha(202)}.jpg`])).rejects.toThrow('check constraint');
    const lookup = await service<Record<string, unknown>>('select marketing_media_lookup($1,$2) r', [owner, sha(1)]);
    expect(lookup).toMatchObject({ sha256: sha(1), storagePath: `marketing-media/${owner}/${sha(1)}.jpg`, mime: 'image/jpeg', purgedAt: null });
    expect(await service('select marketing_media_lookup($1,$2) r', [other, sha(1)])).toBeNull();
  });
});

describe('retention', () => {
  it('purges only old assets that no deck draws and no recent candidate linked, keeping rows', async () => {
    await expect(service('select marketing_media_claim_purge($1,$2,$3) r', [owner, 0, 10])).rejects.toThrow('purge invalid');
    expect(await service('select marketing_media_claim_purge($1,$2,$3) r', [owner, 30, 100])).toEqual([]);
    await db.query("insert into marketing_revisions(user_id,project_id,brand,revision,content_hash,status) values($1,$2,'dneskai',$3,$4,'returned')",
      [owner, project, json({ deck: { schemaVersion: 'dneskai-slides/1', format: 'carousel', slides: [{ type: 'cover-photo', headline: 'OFFLINE', images: [{ slot: 'image-1', assetSha256: sha(101) }], alt: 'OFFLINE' }] } }), sha(300)]);
    await at('2026-11-25T21:00:00Z');
    const purged = await service<Array<{ id: string; storagePath: string }>>('select marketing_media_claim_purge($1,$2,$3) r', [owner, 30, 100]);
    const paths = purged.map(row => row.storagePath);
    expect(paths).toHaveLength(5);
    expect(paths).not.toContain(`marketing-media/${owner}/${sha(101)}.jpg`);
    expect(paths).toContain(`marketing-media/${owner}/${sha(1)}.jpg`);
    expect(Number((await db.query<{ n: string }>('select count(*) n from marketing_media_assets')).rows[0].n)).toBe(6);
    expect(await service('select marketing_media_claim_purge($1,$2,$3) r', [owner, 30, 100])).toEqual([]);
    // A failed storage deletion is undone, so the next daily pass deletes it.
    expect(await service('select marketing_media_unmark_purge($1,$2) r', [owner, json([purged[0].id])])).toBe(1);
    expect(await service<unknown[]>('select marketing_media_claim_purge($1,$2,$3) r', [owner, 30, 100])).toHaveLength(1);
    // The same bytes fetched again come back only with a fresh upload.
    await insertCandidate('cand-f');
    await begin('cand-f');
    await setPlan('cand-f', igPlan(1));
    await expect(record('cand-f', asset(0, { uploaded: false }))).rejects.toThrow('upload required');
    expect(await record('cand-f', asset(0))).toMatchObject({ created: false, sha256: sha(1) });
    expect((await service<Record<string, unknown>>('select marketing_media_lookup($1,$2) r', [owner, sha(1)])).purgedAt).toBeNull();
    await finish('cand-f', 'complete');
  });
});
