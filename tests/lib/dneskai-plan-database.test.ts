import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase, setDatabaseTime } from '../helpers/supabase-pglite';

/**
 * The DNESKAi publishing plan (20261107140000) over every migration in isolated PGlite: own-only rows, one post per
 * slot, the Threads-only evening slot and the service-role approval that only takes a planned revision. Synthetic data.
 */
const owner = '11111111-1111-4111-8111-111111111111', stranger = '99999999-9999-4999-8999-999999999999';
const project = '22222222-2222-4222-8222-222222222222';
const topic = '66666666-6666-4666-8666-666666666666';
let db: PGlite;
const as = async (role: 'service_role' | 'authenticated', user = owner) => {
  await db.query(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
};

beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: '2026-11-07T14:00:00.000Z' });
  await db.query('insert into auth.users(id) values($1)', [stranger]);
  await db.query("insert into public.projects(id,user_id,name,slug,portfolio_key) values($1,$2,'DNESKAi','dneskai','aifirst')", [project, owner]);
  await db.query("insert into public.marketing_dneskai_topics(id,user_id,project_id,kind,source_kind,source_ref,title_cs,status,approved_at) values($1,$2,$3,'education','feed','report:00000000-0000-4000-8000-000000000001','Synthetic topic','approved',now())", [topic, owner, project]);
}, 120000);
afterAll(async () => { await db?.close(); });

describe('marketing_dneskai_plan', () => {
  it('keeps one post per slot and the 20:00 slot for Threads only', async () => {
    await as('service_role');
    await db.query("insert into public.marketing_dneskai_plan(user_id,project_id,date,local_time,instagram,threads,kind,topic_id) values($1,$2,'2026-11-08','12:30',true,true,'education',$3)", [owner, project, topic]);
    await expect(db.query("insert into public.marketing_dneskai_plan(user_id,project_id,date,local_time,instagram,threads,kind,topic_id) values($1,$2,'2026-11-08','20:00',true,true,'education',$3)", [owner, project, topic])).rejects.toThrow();
    await expect(db.query("insert into public.marketing_dneskai_plan(user_id,project_id,date,local_time,instagram,threads,kind,topic_id) values($1,$2,'2026-11-08','08:00',false,true,'education',$3)", [owner, project, topic])).rejects.toThrow();
    await expect(db.query("insert into public.marketing_dneskai_plan(user_id,project_id,date,local_time,instagram,threads,kind,topic_id) values($1,$2,'2026-11-09','12:30',true,true,'education',$3)", [owner, project, topic])).rejects.toThrow();
    await db.query('reset role');
  });

  it('refuses another owner\'s topic and lets the owner read only their rows', async () => {
    await as('service_role');
    await expect(db.query("insert into public.marketing_dneskai_plan(user_id,project_id,date,local_time,instagram,threads,kind,topic_id) values($1,$2,'2026-11-09','08:00',true,true,'education',$3)", [stranger, project, topic])).rejects.toThrow();
    await as('authenticated', owner);
    expect((await db.query('select id from public.marketing_dneskai_plan')).rows).toHaveLength(1);
    await expect(db.query("update public.marketing_dneskai_plan set status='skipped'")).rejects.toThrow();
    await as('authenticated', stranger);
    expect((await db.query('select id from public.marketing_dneskai_plan')).rows).toHaveLength(0);
    await db.query('reset role');
  });

  it('approves only a planned revision and only for the service role', async () => {
    await setDatabaseTime(db, '2026-11-07T14:00:00.000Z');
    await as('service_role');
    await expect(db.query("select public.marketing_dneskai_plan_approve($1,gen_random_uuid(),$2)", [owner, 'a'.repeat(64)])).rejects.toThrow('revision unavailable');
    await as('authenticated', owner);
    await expect(db.query("select public.marketing_dneskai_plan_approve($1,gen_random_uuid(),$2)", [owner, 'a'.repeat(64)])).rejects.toThrow();
    await expect(db.query("select public.marketing_dneskai_plan_retire($1,gen_random_uuid())", [owner])).rejects.toThrow();
    await db.query('reset role');
  });

  it('caps a brief extension at 45 days', async () => {
    await as('service_role');
    await expect(db.query("select public.marketing_dneskai_plan_extend_brief($1,$2,now()+interval '60 days')", [owner, 'e'.repeat(64)])).rejects.toThrow('extension too long');
    expect((await db.query<{ n: number }>("select public.marketing_dneskai_plan_extend_brief($1,$2,now()+interval '3 days') n", [owner, 'e'.repeat(64)])).rows[0]!.n).toBe(0);
    await db.query('reset role');
  });
});
