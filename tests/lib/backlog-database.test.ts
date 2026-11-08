import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';

/** The shared backlog (20261108200000) in isolated PGlite: the agents' insert contract and own-only RLS. */
const owner = '11111111-1111-4111-8111-111111111111', stranger = '99999999-9999-4999-8999-999999999999';
let db: PGlite;
const as = async (role: string, user = owner) => { await db.query(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); };

beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: '2026-11-08T12:00:00.000Z' }); }, 120000);
afterAll(async () => { await db?.close(); });

describe('backlog_items', () => {
  it('takes the agents\' insert as postgres with only the five contract columns, for the single owner', async () => {
    await db.query('reset role');
    const row = (await db.query<{ user_id: string; status: string; created: boolean }>(
      "insert into public.backlog_items(project,title,description,source,external_ref) values('heyDarlink','Fix the toast','Steps','claude:test','LDEV-1') returning user_id,status,created_at is not null created")).rows[0]!;
    expect(row).toEqual({ user_id: owner, status: 'open', created: true });
  });

  it('refuses an unknown project or status', async () => {
    await db.query('reset role');
    await expect(db.query("insert into public.backlog_items(project,title) values('LINKA','x')")).rejects.toThrow();
    await expect(db.query("insert into public.backlog_items(project,title,status) values('personal','x','waiting')")).rejects.toThrow();
  });

  it('shows and changes a row only for its owner, and keeps the owner on update', async () => {
    await db.query('reset role');
    await db.query('insert into auth.users(id) values($1)', [stranger]);
    await as('authenticated', stranger);
    expect((await db.query('select id from public.backlog_items')).rows).toHaveLength(0);
    expect((await db.query("update public.backlog_items set status='done' returning id")).rows).toHaveLength(0);
    await as('authenticated', owner);
    const updated = (await db.query<{ status: string; user_id: string }>("update public.backlog_items set status='in_progress', user_id=$1 returning status,user_id", [stranger])).rows;
    expect(updated).toEqual([{ status: 'in_progress', user_id: owner }]);
    await db.query('reset role');
  });

  it('needs the owner named once a second account exists', async () => {
    await db.query('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await expect(db.query("insert into public.backlog_items(project,title) values('personal','x')")).rejects.toThrow('backlog owner required');
    await as('authenticated', owner);
    const row = (await db.query<{ user_id: string }>("insert into public.backlog_items(project,title) values('personal','From the app') returning user_id")).rows[0]!;
    expect(row.user_id).toBe(owner);
    await db.query('reset role');
  });
});
