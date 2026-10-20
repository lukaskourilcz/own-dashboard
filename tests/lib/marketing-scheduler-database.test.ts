import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { authenticateAutomation } from '@/lib/marketing/automation-auth';

// The real migrations against an isolated WASM Postgres with pgcrypto. pg_cron, pg_net and Vault are
// Supabase services PGlite cannot load; the stand-ins below have their call signatures and record calls.
const owner = '11111111-1111-4111-8111-111111111111', other = '99999999-9999-4999-8999-999999999999';
const holderA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', holderB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secret = 'TEST-ONLY-scheduler-secret-0123456789abcdef';
const url = 'https://own-dashboard.example.test/api/marketing/tick';
const instant = '2026-10-20T20:05:00Z';
const migrations = ['20261020160000_marketing_scheduler.sql', '20261020160100_marketing_scheduler_cron.sql'];
let db: PGlite;
const setTime = (value: string) => db.query("select set_config('marketing.test_time',$1,false)", [value]);
const as = async <T>(role: string, user: string | null, run: () => Promise<T>) => {
  await db.exec(`set role ${role}`);
  if (user) await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try { return await run(); } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
};
const service = <T = unknown>(sql: string, params: unknown[] = []) => as('service_role', null, async () => (await db.query<{ r: T }>(sql, params)).rows[0].r);
const post = async (kind: string) => (await db.query<{ r: number | null }>('select marketing_private.scheduler_post($1) r', [kind])).rows[0].r;
const captured = async () => (await db.query<{ url: string; body: string; headers: Record<string, string>; timeout_milliseconds: number }>('select url,body,headers,timeout_milliseconds from net.captured order by id')).rows;
const setSecret = (name: string, value: string) => db.query('insert into vault.secrets(name,secret) values($1,$2) on conflict(name) do update set secret=excluded.secret', [name, value]);

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    grant usage on schema auth,public to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create schema marketing_private; revoke all on schema marketing_private from public,anon,authenticated; grant usage on schema marketing_private to service_role;
    create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$ select current_setting('marketing.test_time')::timestamptz $$;
    -- Supabase installs pgcrypto in the extensions schema.
    create schema extensions; create extension pgcrypto with schema extensions;
    -- Vault: the function reads only name and decrypted_secret.
    create schema vault; create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text not null,created_at timestamptz default now());
    create view vault.decrypted_secrets as select id,name,secret as decrypted_secret,created_at from vault.secrets;
    -- pg_net: same signature as net.http_post 0.20; records the bytes pg_net would send (body::text).
    create schema net; create table net.captured(id bigserial primary key,url text,body text,headers jsonb,timeout_milliseconds integer);
    create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{"Content-Type": "application/json"}'::jsonb,timeout_milliseconds integer default 5000)
      returns bigint language sql as $$ insert into net.captured(url,body,headers,timeout_milliseconds) values(url,convert_from(convert_to(body::text,'UTF8'),'UTF8'),headers,timeout_milliseconds) returning id $$;
    -- pg_cron: cron.schedule(name, schedule, command) replaces a job of the same name.
    create schema cron; create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text);
    create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values(job_name,schedule,command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid $$;
    create function cron.unschedule(job_name text) returns boolean language sql as $$ with removed as (delete from cron.job where jobname=job_name returning 1) select exists(select 1 from removed) $$;`);
  await setTime(instant);
  await db.query('insert into auth.users values($1),($2)', [owner, other]);
  for (const file of migrations) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
}, 30000);
afterAll(async () => await db.close());

describe('pg_cron schedule (20261020160100)', () => {
  it('schedules exactly the two tick jobs, and re-running the file replaces rather than duplicates them', async () => {
    const jobs = async () => (await db.query<{ jobname: string; schedule: string; command: string }>('select jobname,schedule,command from cron.job order by jobname')).rows;
    const expected = [
      { jobname: 'marketing-tick-daily', schedule: '15 2 * * *', command: "select marketing_private.scheduler_post('daily')" },
      { jobname: 'marketing-tick-minute', schedule: '*/5 * * * *', command: "select marketing_private.scheduler_post('minute')" },
    ];
    expect(await jobs()).toEqual(expected);
    await db.exec(readFileSync(`supabase/migrations/${migrations[1]}`, 'utf8'));
    expect(await jobs()).toEqual(expected);
    expect(await db.query("select cron.unschedule('marketing-tick-minute')")).toBeTruthy();
    expect((await jobs()).map((job) => job.jobname)).toEqual(['marketing-tick-daily']);
    await db.exec(readFileSync(`supabase/migrations/${migrations[1]}`, 'utf8'));
    expect(await jobs()).toEqual(expected);
  });

  it('contains no secret or URL value and sends nothing until Vault holds a usable URL and secret', async () => {
    const source = readFileSync(`supabase/migrations/${migrations[1]}`, 'utf8');
    expect(source).not.toMatch(/vault\.create_secret\('(?!<|https:\/\/own-dashboard-tau)/);
    expect(source).not.toMatch(/insert into vault/i);
    expect(await post('minute')).toBeNull();
    await setSecret('marketing_scheduler_url', url);
    expect(await post('minute')).toBeNull();
    await setSecret('marketing_scheduler_secret', 'too-short');
    expect(await post('minute')).toBeNull();
    await setSecret('marketing_scheduler_secret', `${secret} with space`);
    expect(await post('minute')).toBeNull();
    // The secret is never sent to any other path or scheme.
    await setSecret('marketing_scheduler_secret', secret);
    for (const wrong of ['http://own-dashboard.example.test/api/marketing/tick', 'https://own-dashboard.example.test/api/marketing/n8n', 'https://own-dashboard.example.test/api/marketing/tick?x=1', 'https://user@own-dashboard.example.test/api/marketing/tick']) {
      await setSecret('marketing_scheduler_url', wrong);
      expect(await post('daily')).toBeNull();
    }
    expect(await captured()).toEqual([]);
    await expect(post('hourly')).rejects.toThrow('scheduler kind invalid');
  });

  it('signs the exact bytes pg_net sends, and the TypeScript verifier accepts them as the scheduler role', async () => {
    await setSecret('marketing_scheduler_url', url);
    await setSecret('marketing_scheduler_secret', secret);
    expect(await post('minute')).toEqual(expect.any(Number));
    expect(await post('daily')).toEqual(expect.any(Number));
    const [minute, daily] = await captured();
    const now = Date.parse(instant);
    for (const [request, kind] of [[minute, 'minute'], [daily, 'daily']] as const) {
      expect(request.url).toBe(url);
      expect(request.timeout_milliseconds).toBe(55000);
      expect(request.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'X-Marketing-Timestamp': String(now / 1000) });
      expect(request.headers['X-Marketing-Signature']).toBe(createHmac('sha256', secret).update(`${now / 1000}.${request.body}`).digest('hex'));
      const body = JSON.parse(request.body);
      expect(Object.keys(body).sort()).toEqual(['kind', 'tick']);
      expect(body.kind).toBe(kind);
      expect(body.tick).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const signed = new Request(url, { method: 'POST', headers: request.headers, body: request.body });
      const env = { MARKETING_OWNER_ID: owner, MARKETING_SCHEDULER_SECRET: secret };
      expect(authenticateAutomation(signed, request.body, env, now)).toEqual({ ownerId: owner, brand: null, role: 'scheduler' });
      expect(authenticateAutomation(signed, request.body, env, now + 301_000)).toBeNull();
      expect(authenticateAutomation(signed, `${request.body} `, env, now)).toBeNull();
    }
    expect(minute.body).not.toBe(daily.body);
  });

  it('computes the same digest as the TypeScript HMAC for any canonical string', async () => {
    for (const body of ['{"kind": "minute", "tick": "00000000-0000-4000-8000-000000000000"}', '{"poznámka": "Příliš žluťoučký kůň"}', '']) {
      const digest = (await db.query<{ r: string }>('select marketing_private.scheduler_signature($1,$2,$3) r', [secret, '1792526700', body])).rows[0].r;
      expect(digest).toBe(createHmac('sha256', secret).update(`1792526700.${body}`).digest('hex'));
    }
  });

  it('keeps the request builder away from every API role', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const fn of ['marketing_private.scheduler_post(text)', 'marketing_private.scheduler_signature(text,text,text)']) {
        expect((await db.query<{ allowed: boolean }>(`select has_function_privilege('${role}','${fn}','execute') allowed`)).rows[0].allowed).toBe(false);
      }
    }
    await expect(as('service_role', null, () => db.query("select marketing_private.scheduler_post('minute')"))).rejects.toThrow();
  });
});

describe('tick record and category leases (20261020160000)', () => {
  it('records a tick id once: a replay begins nothing and finishes nothing', async () => {
    const tick = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    expect(await service('select marketing_scheduler_begin_tick($1,$2,$3) r', [owner, tick, 'minute'])).toBe(true);
    expect(await service('select marketing_scheduler_begin_tick($1,$2,$3) r', [owner, tick, 'minute'])).toBe(false);
    expect(await service('select marketing_scheduler_begin_tick($1,$2,$3) r', [other, tick, 'daily'])).toBe(false);
    await expect(service('select marketing_scheduler_begin_tick($1,$2,$3) r', [owner, holderA, 'hourly'])).rejects.toThrow('tick input invalid');
    const did = [{ category: 'collection', status: 'noop', ms: 3 }];
    expect(await service('select marketing_scheduler_finish_tick($1,$2,$3,$4) r', [owner, tick, JSON.stringify(did), '[]'])).toBe(true);
    expect(await service('select marketing_scheduler_finish_tick($1,$2,$3,$4) r', [owner, tick, '[]', '[]'])).toBe(false);
    const row = (await db.query<{ kind: string; did: unknown; finished_at: string | null }>('select kind,did,finished_at from marketing_ticks where id=$1', [tick])).rows[0];
    expect(row).toMatchObject({ kind: 'minute', did });
    expect(row.finished_at).not.toBeNull();
  });

  it('gives a category to one holder at a time, fences release and honours backoff', async () => {
    const acquire = (holder: string, category = 'media', seconds = 90) => service<Record<string, unknown>>('select marketing_scheduler_acquire($1,$2,$3,$4) r', [owner, category, holder, seconds]);
    const release = (holder: string, next: string | null, state: unknown) => service<boolean>('select marketing_scheduler_release($1,$2,$3,$4,$5) r', [owner, 'media', holder, next, state === null ? null : JSON.stringify(state)]);
    expect(await acquire(holderA)).toMatchObject({ acquired: true, state: {} });
    expect(await acquire(holderB)).toMatchObject({ acquired: false, reason: 'busy' });
    expect(await acquire(holderA)).toMatchObject({ acquired: true });
    expect(await release(holderB, null, null)).toBe(false);
    expect(await release(holderA, '2026-10-20T20:07:05Z', { busy: 1 })).toBe(true);
    expect(await acquire(holderB)).toMatchObject({ acquired: false, reason: 'backoff' });
    // Another category is independent.
    expect(await acquire(holderB, 'briefs')).toMatchObject({ acquired: true });
    await setTime('2026-10-20T20:07:06Z');
    expect(await acquire(holderB)).toMatchObject({ acquired: true, state: { busy: 1 } });
    // A lease that outlived its tick is taken over, and the old holder can no longer write.
    await setTime('2026-10-20T20:08:37Z');
    expect(await acquire(holderA)).toMatchObject({ acquired: true });
    expect(await release(holderB, null, { lost: true })).toBe(false);
    expect(await release(holderA, null, null)).toBe(true);
    expect((await db.query<{ state: unknown; next_allowed_at: string | null }>("select state,next_allowed_at from marketing_scheduler_state where user_id=$1 and category='media'", [owner])).rows[0]).toEqual({ state: { busy: 1 }, next_allowed_at: null });
    await expect(acquire(holderA, 'everything')).rejects.toThrow('lease input invalid');
    await expect(acquire(holderA, 'media', 3600)).rejects.toThrow('lease input invalid');
    await expect(service('select marketing_scheduler_release($1,$2,$3,$4,$5) r', [owner, 'media', holderA, '2026-10-30T00:00:00Z', null])).rejects.toThrow('lease backoff invalid');
    await setTime(instant);
  });

  it('serialises two concurrent acquisitions of the same category', async () => {
    const tasks = [holderA, holderB].map((holder) => service<{ acquired: boolean }>('select marketing_scheduler_acquire($1,$2,$3,$4) r', [owner, 'generation', holder, 90]));
    const results = await Promise.all(tasks);
    expect(results.filter((result) => result.acquired)).toHaveLength(1);
  });

  it('keeps fourteen days of ticks for the owner only', async () => {
    await setTime('2026-10-01T00:00:00Z');
    await service('select marketing_scheduler_begin_tick($1,$2,$3) r', [owner, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'minute']);
    await service('select marketing_scheduler_begin_tick($1,$2,$3) r', [other, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'minute']);
    await setTime(instant);
    expect(await service('select marketing_scheduler_prune_ticks($1,$2) r', [owner, 14])).toBe(1);
    expect((await db.query('select id from marketing_ticks where id=$1', ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'])).rows).toHaveLength(1);
    await expect(service('select marketing_scheduler_prune_ticks($1,$2) r', [owner, 0])).rejects.toThrow('tick retention invalid');
  });

  it('is own-only: the owner reads, other users read nothing, and browsers can neither write nor call the functions', async () => {
    const owned = await as('authenticated', owner, async () => (await db.query('select id from marketing_ticks')).rows.length);
    expect(owned).toBeGreaterThan(0);
    expect(await as('authenticated', other, async () => (await db.query("select id from marketing_ticks where user_id<>$1", [other])).rows)).toEqual([]);
    expect(await as('authenticated', other, async () => (await db.query('select * from marketing_scheduler_state where user_id=$1', [owner])).rows)).toEqual([]);
    await expect(as('authenticated', owner, () => db.query("insert into marketing_ticks(id,user_id,kind) values(gen_random_uuid(),$1,'minute')", [owner]))).rejects.toThrow();
    await expect(as('authenticated', owner, () => db.query("update marketing_scheduler_state set next_allowed_at=null"))).rejects.toThrow();
    for (const fn of ['marketing_scheduler_begin_tick(uuid,uuid,text)', 'marketing_scheduler_finish_tick(uuid,uuid,jsonb,jsonb)', 'marketing_scheduler_acquire(uuid,text,uuid,integer)', 'marketing_scheduler_release(uuid,text,uuid,timestamptz,jsonb)', 'marketing_scheduler_prune_ticks(uuid,integer)']) {
      for (const role of ['anon', 'authenticated']) expect((await db.query<{ allowed: boolean }>(`select has_function_privilege('${role}','${fn}','execute') allowed`)).rows[0].allowed).toBe(false);
      expect((await db.query<{ allowed: boolean }>(`select has_function_privilege('service_role','${fn}','execute') allowed`)).rows[0].allowed).toBe(true);
    }
  });
});
