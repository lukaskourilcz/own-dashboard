import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';

/**
 * Per-channel sharing switches (20261108230000) over every migration in isolated PGlite: own-only rows on the owner's
 * own plan slots, which revision a switch turns off, and that the publishers' claim skips it. Synthetic data.
 */
const owner = '11111111-1111-4111-8111-111111111111', stranger = '99999999-9999-4999-8999-999999999999';
const project = '22222222-2222-4222-8222-222222222222', devProject = '23232323-2323-4323-8323-232323232323';
const slot = '33333333-3333-4333-8333-333333333333', threadsSlot = '34343434-3434-4434-8434-343434343434', devSlot = '35353535-3535-4535-8535-353535353535';
const head = '44444444-4444-4444-8444-444444444441', twin = '44444444-4444-4444-8444-444444444442', story = '44444444-4444-4444-8444-444444444443';
const evening = '44444444-4444-4444-8444-444444444444', devPost = '44444444-4444-4444-8444-444444444445', devThreads = '44444444-4444-4444-8444-444444444446';
const draft = '55555555-5555-4555-8555-555555555555';
let db: PGlite;
const as = async (role: string, user = owner) => { await db.query(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); };
const off = async (revision: string) => (await db.query<{ off: boolean }>('select public.marketing_publication_switched_off($1,$2) off', [owner, revision])).rows[0]!.off;

beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: '2026-11-08T12:00:00.000Z' });
  await db.query('insert into auth.users(id) values($1)', [stranger]);
  await db.query("insert into public.projects(id,user_id,name,slug,portfolio_key) values($1,$2,'DNESKAi','dneskai','aifirst'),($3,$2,'devShark','devshark','react-express-app')", [project, owner, devProject]);
  for (const [id, brand] of [[head, 'dneskai'], [twin, 'dneskai'], [story, 'dneskai'], [evening, 'dneskai'], [devPost, 'devshark'], [devThreads, 'devshark']] as const)
    await db.query("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash,ready,status) values($1,$2,$3,'{}'::jsonb,$4,true,'review')", [id, owner, brand, id.replace(/-/g, '').padEnd(64, 'a')]);
  await db.query("insert into public.marketing_dneskai_plan(id,user_id,project_id,date,local_time,instagram,threads,kind,revision_id,head_revision_id,threads_revision_id,story_revision_id) values($1,$2,$3,'2026-11-09','12:30',true,true,'news',$4,$4,$5,$6)", [slot, owner, project, head, twin, story]);
  await db.query("insert into public.marketing_dneskai_plan(id,user_id,project_id,date,local_time,instagram,threads,kind,revision_id,head_revision_id) values($1,$2,$3,'2026-11-09','20:00',false,true,'news',$4,$4)", [threadsSlot, owner, project, evening]);
  await db.query("insert into public.marketing_devshark_drafts(id,user_id,project_id,title,deck,caption,origin,status) values($1,$2,$3,'typeof null',$4,'Caption','concept','planned')", [draft, owner, devProject, JSON.stringify({ schemaVersion: 'devshark-deck/1', cover: 'light', slides: [] })]);
  await db.query("insert into public.marketing_devshark_plan(id,user_id,project_id,date,local_time,instagram,threads,draft_id,instagram_revision_id,threads_revision_id) values($1,$2,$3,'2026-11-09','12:00',true,true,$4,$5,$6)", [devSlot, owner, devProject, draft, devPost, devThreads]);
}, 120000);
afterAll(async () => { await db?.close(); });

describe('marketing_publishing_switches', () => {
  it('turns off exactly the switched version, and the whole post with "all"', async () => {
    await as('authenticated');
    await db.query("insert into public.marketing_publishing_switches(user_id,brand,slot_id,channel) values($1,'dneskai',$2,'threads')", [owner, slot]);
    await db.query('reset role');
    expect([await off(head), await off(twin), await off(story)]).toEqual([false, true, false]);
    await as('authenticated');
    await db.query("insert into public.marketing_publishing_switches(user_id,brand,slot_id,channel) values($1,'dneskai',$2,'all')", [owner, slot]);
    await db.query('reset role');
    expect([await off(head), await off(twin), await off(story)]).toEqual([true, true, true]);
    await as('authenticated');
    await db.query("delete from public.marketing_publishing_switches where slot_id=$1", [slot]);
    await db.query('reset role');
    expect([await off(head), await off(twin), await off(story)]).toEqual([false, false, false]);
  });

  it('treats a Threads-only DNESKAi slot\'s head as its Threads post, and covers devShark', async () => {
    await as('authenticated');
    await db.query("insert into public.marketing_publishing_switches(user_id,brand,slot_id,channel) values($1,'dneskai',$2,'threads'),($1,'devshark',$3,'instagram')", [owner, threadsSlot, devSlot]);
    await db.query('reset role');
    expect([await off(evening), await off(devPost), await off(devThreads)]).toEqual([true, true, false]);
  });

  it('keeps switches own-only and on the owner\'s own slots', async () => {
    await as('authenticated', stranger);
    expect((await db.query('select 1 from public.marketing_publishing_switches')).rows).toHaveLength(0);
    await expect(db.query("insert into public.marketing_publishing_switches(user_id,brand,slot_id,channel) values($1,'dneskai',$2,'story')", [stranger, slot])).rejects.toThrow();
    await as('authenticated');
    await expect(db.query("insert into public.marketing_publishing_switches(user_id,brand,slot_id,channel) values($1,'devshark',$2,'story')", [owner, slot])).rejects.toThrow('foreign plan slot');
    await expect(db.query("select public.marketing_publication_switched_off($1,$2)", [owner, head])).rejects.toThrow();
    await db.query('reset role');
  });

  it('makes the publishers\' claim skip a switched-off version', () => {
    const sql = readFileSync('supabase/migrations/20261108230000_publishing_switches.sql', 'utf8');
    const claim = sql.slice(sql.indexOf('create or replace function public.marketing_claim_due'));
    expect(claim).toContain('and not public.marketing_publication_switched_off(p_owner,r.id)');
  });
});
