import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';

/** devShark concepts and plan (20261107180000) in isolated PGlite: owner-only decisions and the daily slot shape. */
const owner = '11111111-1111-4111-8111-111111111111', stranger = '99999999-9999-4999-8999-999999999999';
const project = '22222222-2222-4222-8222-222222222222', draft = '33333333-3333-4333-8333-333333333333';
let db: PGlite;
const as = async (role: string, user = owner) => { await db.query(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); };
const deck = JSON.stringify({ schemaVersion: 'devshark-deck/1', cover: 'light', slides: [] });

beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: '2026-11-07T17:00:00.000Z' });
  await db.query('insert into auth.users(id) values($1)', [stranger]);
  await db.query("insert into public.projects(id,user_id,name,slug,portfolio_key) values($1,$2,'devShark','devshark','react-express-app')", [project, owner]);
  await db.query("insert into public.marketing_devshark_drafts(id,user_id,project_id,title,deck,caption,origin) values($1,$2,$3,'typeof null',$4,'Caption','concept')", [draft, owner, project, deck]);
}, 120000);
afterAll(async () => { await db?.close(); });

describe('marketing_devshark_drafts and _plan', () => {
  it('lets only the owner approve a concept, and only through the decision function', async () => {
    await as('authenticated', stranger);
    await expect(db.query("select public.marketing_devshark_decide($1,'approved')", [draft])).rejects.toThrow('draft unavailable');
    await as('authenticated', owner);
    await expect(db.query("update public.marketing_devshark_drafts set status='approved'")).rejects.toThrow();
    expect((await db.query<{ d: string }>("select public.marketing_devshark_decide($1,'approved') d", [draft])).rows[0]!.d).toBe('approved');
    await db.query('reset role');
    expect((await db.query<{ status: string; decided: boolean }>('select status, decided_at is not null decided from public.marketing_devshark_drafts where id=$1', [draft])).rows[0]).toEqual({ status: 'approved', decided: true });
  });

  it('keeps 12:00 for Instagram and Threads and 19:00 for Threads alone', async () => {
    await as('service_role');
    await expect(db.query("insert into public.marketing_devshark_plan(user_id,project_id,date,local_time,instagram,threads,draft_id) values($1,$2,'2026-11-08','19:00',true,true,$3)", [owner, project, draft])).rejects.toThrow();
    await db.query("insert into public.marketing_devshark_plan(user_id,project_id,date,local_time,instagram,threads,draft_id) values($1,$2,'2026-11-08','12:00',true,true,$3)", [owner, project, draft]);
    await db.query('reset role');
    await as('authenticated', owner);
    await expect(db.query("select public.marketing_devshark_decide($1,'rejected')", [draft])).resolves.toBeTruthy();
    await db.query('reset role');
  });
});
