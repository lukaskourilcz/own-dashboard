import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const migration = '20261025214416_complete_captured_career_reads.sql';
const sql = readFileSync(`supabase/migrations/${migration}`, 'utf8');

async function snapshot(db: PGlite) {
 const { rows } = await db.query(`select jsonb_build_object(
  'listings',(select jsonb_agg(to_jsonb(j)-'native_remote_verified') from job_listings j),
  'triage',(select jsonb_agg(to_jsonb(j)) from job_user_state j),
  'saved',(select jsonb_agg(to_jsonb(j)) from saved_job_positions j),
  'applications',(select jsonb_agg(to_jsonb(j)) from job_applications j),
  'events',(select jsonb_agg(to_jsonb(j)) from job_application_events j),
  'templates',(select jsonb_agg(to_jsonb(j)) from cover_letter_templates j),
  'sources',(select jsonb_agg(to_jsonb(j)) from career_private.source_snapshots j)) data`);
 return rows;
}

it.each(['upgrade', 'rollback'] as const)('preserves existing Career history and source watermarks through %s', async mode => {
 const db = await createMigratedDatabase({ owner, instant: '2026-10-25T12:00:00Z', beforeMigration: migration });
 try {
  await db.exec(`insert into job_listings(source,external_id,title,url,role,remote) values
   ('ashby-sanity','legacy','Synthetic React role','https://jobs.ashbyhq.com/sanity/legacy','frontend',true)`);
  const id = (await db.query<{ id: string }>('select id from job_listings')).rows[0].id;
  await db.query("insert into job_user_state(user_id,listing_id,state) values($1,$2,'deleted')", [owner,id]);
  await db.query("insert into saved_job_positions(user_id,listing_id,title,url,cover_letter) values($1,$2,'Synthetic saved role','https://jobs.ashbyhq.com/sanity/legacy','Synthetic draft')", [owner,id]);
  const app = (await db.query<{ id: string }>("insert into job_applications(user_id,listing_id,title,cover_letter,status,applied_on) values($1,$2,'Synthetic application','Synthetic letter','applied','2026-10-25') returning id", [owner,id])).rows[0].id;
  await db.query("insert into job_application_events(user_id,application_id,kind,detail) values($1,$2,'applied','Synthetic event')", [owner,app]);
  await db.query("insert into cover_letter_templates(user_id,name,body) values($1,'Synthetic template','Synthetic body')", [owner]);
  await db.exec("insert into career_private.source_snapshots(source,observed_at,snapshot_hash) values('ashby-sanity',now(),repeat('a',64))");
  const before = await snapshot(db);
  if (mode === 'upgrade') await db.exec(sql);
  else await expect(db.transaction(async tx => { await tx.exec(sql); throw Error('synthetic rollback'); })).rejects.toThrow('synthetic rollback');
  expect(await snapshot(db)).toEqual(before);
  const upgraded = mode === 'upgrade';
  expect((await db.query<{ found: boolean }>("select to_regprocedure('public.read_career_records(text,uuid)') is not null found")).rows[0].found).toBe(upgraded);
  expect((await db.query<{ found: boolean }>("select exists(select 1 from pg_attribute where attrelid='public.job_listings'::regclass and attname='native_remote_verified' and not attisdropped) found")).rows[0].found).toBe(upgraded);
  if (upgraded) {
   expect((await db.query('select remote,native_remote_verified from job_listings')).rows).toEqual([{ remote:true,native_remote_verified:false }]);
   const definition = (await db.query<{ definition: string }>("select pg_get_functiondef('public.career_apply_source_snapshot(text,timestamptz,jsonb,boolean)'::regprocedure) definition")).rows[0].definition;
   expect(definition).toContain('native_remote_verified');
  }
 } finally { await db.close(); }
}, 60_000);

it('keeps the read stable/invoker with only authenticated execution and the source writer service-only', async () => {
 const db = await createMigratedDatabase({ owner, instant:'2026-10-25T12:00:00Z' });
 try {
  const rows = (await db.query(`select role,
   has_function_privilege(role,'public.read_career_records(text,uuid)','execute') reader,
   has_function_privilege(role,'public.career_apply_source_snapshot(text,timestamptz,jsonb,boolean)','execute') writer
   from unnest(array['anon','authenticated','service_role']) role`)).rows;
  expect(rows).toEqual([{ role:'anon',reader:false,writer:false },{ role:'authenticated',reader:true,writer:false },{ role:'service_role',reader:false,writer:true }]);
  expect((await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid='public.read_career_records(text,uuid)'::regprocedure")).rows).toEqual([{ prosecdef:false,provolatile:'s',proconfig:['search_path=""'] }]);
  for (const entity of ['saved_job_positions','../job_listings',null]) {
   await expect(db.transaction(async tx => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await tx.query('select public.read_career_records($1,$2)',[entity,entity === 'saved_job_positions' ? null : owner]);
   })).rejects.toThrow();
  }
 } finally { await db.close(); }
}, 60_000);
