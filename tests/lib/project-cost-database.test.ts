import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
const owner = '11111111-1111-4111-8111-111111111111', stranger = '99999999-9999-4999-8999-999999999999';
const project = '22222222-2222-4222-8222-222222222222', foreign = '22222222-2222-4222-8222-222222222223';
let db: PGlite;
const as = async (user = owner) => { await db.exec('reset role; set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); };
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: '2026-11-10T18:00:00Z' });
  await db.query('insert into auth.users(id) values($1)', [stranger]);
  await db.query("insert into projects(id,user_id,name,slug) values($1,$2,'Own','own'),($3,$4,'Foreign','foreign')", [project,owner,foreign,stranger]);
}, 120000);
afterAll(async () => { await db?.close(); });
describe('project cost evidence persistence', () => {
  it('requires provenance and an ordered period, and prevents duplicate evidence', async () => {
    await as();
    const insert = "insert into project_costs(user_id,project_id,label,amount,cost_type,period_start,period_end,verified_on,source_key) values($1,$2,'Usage',7.7,'usage',$3,$4,$5,$6) returning id";
    await expect(db.query(insert,[owner,project,null,null,null,null])).rejects.toThrow();
    await expect(db.query(insert,[owner,project,'2026-11-10','2026-11-01','2026-11-10','bad'])).rejects.toThrow();
    const args = [owner,project,'2026-11-01','2026-11-10','2026-11-10','provider-period'];
    expect((await db.query(insert,args)).rows).toHaveLength(1);
    await expect(db.query(insert,args)).rejects.toThrow();
  });
  it('rejects foreign-parent writes and hides owner evidence from other sessions', async () => {
    await as();
    await expect(db.query("insert into project_costs(user_id,project_id,label) values($1,$2,'Foreign')",[owner,foreign])).rejects.toThrow();
    await expect(db.query('update project_costs set project_id=$1 where project_id=$2',[foreign,project])).rejects.toThrow();
    await as(stranger);
    expect((await db.query('select * from project_costs where project_id=$1',[project])).rows).toEqual([]);
    expect((await db.query('update project_costs set amount=0 where project_id=$1 returning id',[project])).rows).toEqual([]);
  });
});
