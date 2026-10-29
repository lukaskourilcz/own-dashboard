import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';

const migration = '20261029010744_confirmed_marketing_campaign_activation.sql';
const owner = '11111111-1111-4111-8111-111111111111', other = '99999999-9999-4999-8999-999999999999';
const selected = '22222222-2222-4222-8222-222222222222', previous = '33333333-3333-4333-8333-333333333333';
const hash = 'a'.repeat(64);
let db: PGlite;
async function invoke(id: string | null = selected, expected: string | null = hash, actor = owner) {
 await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]); await db.exec('set role authenticated');
 try { return await db.query('select marketing_activate_campaign($1,$2)', [id, expected]); }
 finally { await db.exec('reset role'); }
}
const snapshot = async () => (await db.query<{ id: string; user_id: string; brand: string; name: string; source_hash: string; status: string }>('select id,user_id,brand,name,source_hash,status from marketing_campaigns order by id')).rows;
async function seed() {
 await db.query(`insert into marketing_campaigns(id,user_id,brand,name,starts_on,ends_on,source_snapshot,source_hash,status)
  values($1,$3,'devshark','Selected','2026-10-29','2026-11-04','{}',$5,'draft'),
  ($2,$3,'devshark','Previous','2026-10-22','2026-10-28','{}',$5,'active'),
  ('44444444-4444-4444-8444-444444444444',$3,'devshark','Other draft','2026-10-15','2026-10-21','{}',$5,'draft'),
  ('55555555-5555-4555-8555-555555555555',$3,'dneskai','Other brand','2026-10-29','2026-11-04','{}',$5,'active'),
  ('66666666-6666-4666-8666-666666666666',$4,'devshark','Other owner','2026-10-29','2026-11-04','{}',$5,'active')`, [selected, previous, owner, other, hash]);
}
beforeAll(async () => {
 db = await createMigratedDatabase({ owner, instant: '2026-10-29T00:00:00Z', beforeMigration: migration });
 await db.query('insert into auth.users(id) values($1)', [other]); await seed();
 const before = await snapshot();
 if (process.env.AUDIT_ORIGINAL_CAMPAIGN_ACTIVATION !== '1') await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
 expect(await snapshot()).toEqual(before);
}, 120_000);
beforeEach(async () => {
 await db.exec('drop trigger if exists audit_activation on marketing_campaigns; truncate marketing_campaigns cascade'); await seed();
});
afterAll(async () => { await db.close(); });

it('activates the exact owned source, archives captured previous plans, and preserves other brands/owners', async () => {
 const before = await snapshot(); await invoke();
 const after = await snapshot();
 expect(after).toEqual(before.map(row => row.user_id === owner && row.brand === 'devshark' ? { ...row, status: row.id === selected ? 'active' : 'archived' } : row));
 await invoke(); expect(await snapshot()).toEqual(after);
 expect((await db.query<{ count: number }>('select count(*)::int as count from marketing_publications')).rows[0].count).toBe(0);
});
it.each([null, '', 'b'.repeat(64), 'a'.repeat(65)])('refuses missing, malformed or changed hash %s without archiving another plan', async expected => {
 const before = await snapshot(); await expect(invoke(selected, expected)).rejects.toThrow(); expect(await snapshot()).toEqual(before);
});
it('refuses a missing or foreign selected plan', async () => {
 const before = await snapshot(); await expect(invoke(null)).rejects.toThrow(); await expect(invoke(selected, hash, other)).rejects.toThrow(); expect(await snapshot()).toEqual(before);
});
it.each(['skip-target', 'change-target-status', 'change-target-hash', 'change-target-owner', 'skip-other-draft', 'change-archive-status', 'delete-target'] as const)('rolls back a suppressed or changed %s activation', async mode => {
 const before = await snapshot();
 const body = mode === 'skip-target' ? `if new.id='${selected}' and new.status='active' then return null; end if;`
  : mode === 'change-target-status' ? `if new.id='${selected}' and new.status='active' then new.status='draft'; end if;`
  : mode === 'change-target-hash' ? `if new.id='${selected}' and new.status='active' then new.source_hash='${'b'.repeat(64)}'; end if;`
  : mode === 'change-target-owner' ? `if new.id='${selected}' and new.status='active' then new.user_id='${other}'; new.brand='dneskai'; end if;`
  : mode === 'skip-other-draft' ? "if new.name='Other draft' and new.status='archived' then return null; end if;"
  : mode === 'change-archive-status' ? `if new.id='${previous}' and new.status='archived' then new.status='draft'; end if;`
  : `if new.id='${selected}' and new.status='active' then delete from public.marketing_campaigns where id=new.id; end if;`;
 await db.exec(`create or replace function public.audit_activation() returns trigger language plpgsql as $$begin ${body} return new; end$$;
  create trigger audit_activation ${mode === 'delete-target' ? 'after' : 'before'} update on marketing_campaigns for each row execute function public.audit_activation();`);
 await expect(invoke()).rejects.toThrow(); expect(await snapshot()).toEqual(before);
});
it('checks the complete stored result after AFTER triggers, not just UPDATE RETURNING', async () => {
 const before = await snapshot();
 await db.exec(`create or replace function public.audit_activation() returns trigger language plpgsql as $$begin
  if new.id='${selected}' and new.status='active' then update public.marketing_campaigns set status='draft' where id=new.id; end if; return new; end$$;
  create trigger audit_activation after update on marketing_campaigns for each row execute function public.audit_activation();`);
 await expect(invoke()).rejects.toThrow(); expect(await snapshot()).toEqual(before);
});
it('retains the existing authenticated-only execution and own-only reads', async () => {
 expect((await db.query("select has_function_privilege('anon','marketing_activate_campaign(uuid,text)','execute') as anon,has_function_privilege('authenticated','marketing_activate_campaign(uuid,text)','execute') as authenticated")).rows[0]).toEqual({ anon: false, authenticated: true });
 await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec('set role authenticated');
 try { expect((await db.query<{ user_id: string }>('select user_id from marketing_campaigns')).rows.every(row => row.user_id === owner)).toBe(true); }
 finally { await db.exec('reset role'); }
});
it('can restore the original function definition without rewriting campaign data', async () => {
 if (process.env.AUDIT_ORIGINAL_CAMPAIGN_ACTIVATION === '1') return;
 const original = readFileSync('supabase/migrations/20261013193105_marketing_durable_jobs.sql', 'utf8').split('create function public.marketing_activate_campaign(')[1].split('revoke all on function public.marketing_activate_campaign')[0];
 const before = await snapshot();
 try {
  await db.exec('create or replace function public.marketing_activate_campaign(' + original); expect(await snapshot()).toEqual(before);
  const definition = async () => (await db.query<{ definition: string }>("select pg_get_functiondef('public.marketing_activate_campaign(uuid,text)'::regprocedure) as definition")).rows[0].definition;
  const old = await definition();
  await db.exec('begin');
  try { await expect(db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8') + '\nselect 1/0;')).rejects.toThrow(); }
  finally { await db.exec('rollback'); }
  expect(await definition()).toBe(old); expect(await snapshot()).toEqual(before);
 }
 finally { await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8')); }
 expect(await snapshot()).toEqual(before);
});
