import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
type Day = { focus_date: Date; completed: boolean; completed_count: number; total: number };
async function read(user: string) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try {
    return (await db.query<Day>("select * from daily_focus_garden('2026-10-23')")).rows.map(row => ({
      ...row, focus_date: row.focus_date.toISOString().slice(0, 10),
    }));
  } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-23T12:00:00Z" });
  await db.query("insert into auth.users(id,email) values($1,'other@example.test')", [other]);
  await db.query("insert into daily_focus_sets(user_id,focus_date,generation) select $1,'2026-10-23',n from generate_series(1,400) n", [owner]);
  await db.query("insert into daily_focus_sets(user_id,focus_date,generation) values($1,'2026-09-05',1),($1,'2026-09-04',1),($1,'2026-10-21',1),($1,'2026-10-21',2),($2,'2026-10-23',1)", [owner, other]);
  await db.exec(`insert into daily_focus_items(set_id,user_id,position,title_snapshot,waiting_since,completed_at)
    select s.id,s.user_id,n,'Synthetic task',now(),case when (s.focus_date<>'2026-10-21' and (s.generation=1 or n<=4)) or (s.focus_date='2026-10-21' and n<=3) then now() end
    from daily_focus_sets s cross join generate_series(1,7) n where not(s.focus_date='2026-10-21' and s.generation=1 and n>3)`);
}, 120000);
afterAll(async () => { await db?.close(); });
describe("complete daily focus garden", () => {
  it("keeps completed generations beyond the old 350-row cap and the full 49-day window", async () => {
    expect(await read(owner)).toEqual([
      { focus_date: "2026-09-05", completed: true, completed_count: 7, total: 7 },
      { focus_date: "2026-10-21", completed: false, completed_count: 3, total: 7 },
      { focus_date: "2026-10-23", completed: true, completed_count: 7, total: 7 },
    ]);
  });
  it("keeps foreign owners out and preserves the latest generation on equal partial counts", async () => {
    expect(await read(other)).toEqual([{ focus_date: "2026-10-23", completed: true, completed_count: 7, total: 7 }]);
  });
  it("uses invoker RLS with no anonymous or service execution grant", async () => {
    expect((await db.query<{ definer: boolean; anon: boolean; service: boolean }>("select prosecdef as definer,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where proname='daily_focus_garden'")).rows).toEqual([{ definer: false, anon: false, service: false }]);
  });
});
