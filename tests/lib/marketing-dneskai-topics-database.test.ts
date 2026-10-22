import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { BRIEF_MIGRATIONS, createBriefsDatabase } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

/** The prepared topics SQL (#150, plan A1) over the brief migrations, in isolated PGlite; every value is synthetic. */
const TOPICS = '20261023100000_dneskai_topics.sql';
const owner = '11111111-1111-4111-8111-111111111111', other = '33333333-3333-4333-8333-333333333333';
const project = '22222222-2222-4222-8222-222222222222', foreign = '44444444-4444-4444-8444-444444444444';
let db: PGlite;
beforeAll(async () => {
  db = await createBriefsDatabase([owner, other], [{ id: project, owner }, { id: foreign, owner: other }], '2026-10-23T08:00:00Z', [...BRIEF_MIGRATIONS, TOPICS]);
}, 60_000);
afterAll(async () => { await db?.close(); });

async function as<T>(user: string | null, sql: string, params: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? '']);
  await db.exec('set role authenticated');
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
/** A topic the pipeline proposed, written with service-role rights. */
async function seed(user = owner, projectId = project, patch: { status?: string; approved?: boolean } = {}) {
  const id = randomUUID();
  await db.query(`insert into marketing_dneskai_topics(id,user_id,project_id,kind,source_kind,source_ref,title_cs,keyword,status,approved_at)
    values($1,$2,$3,'education','instagram',$4,'Syntetický námět','prompt',$5,$6)`, [id, user, projectId, `instagram:${id}`, patch.status ?? 'proposed', patch.approved ? '2026-10-23T08:00:00Z' : null]);
  return id;
}
const row = async (id: string) => (await db.query<{ status: string; approved_at: string | null; title_cs: string; keyword: string | null }>('select status,approved_at,title_cs,keyword from marketing_dneskai_topics where id=$1', [id])).rows[0]!;
const decide = (id: string, action: string, user = owner) => as<{ r: { id: string; status: string } }>(user, 'select marketing_dneskai_topic_decide($1,$2) r', [id, action]);

describe('marketing_dneskai_topics (#150)', () => {
  it('keeps the table own-only: the owner reads only own rows and cannot write directly', async () => {
    const mine = await seed(), theirs = await seed(other, foreign);
    const visible = (await as<{ id: string }>(owner, 'select id from marketing_dneskai_topics')).map((item) => item.id);
    expect(visible).toContain(mine); expect(visible).not.toContain(theirs);
    await expect(as(owner, "update marketing_dneskai_topics set status='approved' where id=$1", [mine])).rejects.toThrow(/permission denied/);
    await expect(as(owner, "insert into marketing_dneskai_topics(user_id,project_id,kind,source_kind,source_ref,title_cs) values($1,$2,'news','manual','x','Titulek')", [owner, project])).rejects.toThrow(/permission denied/);
    expect(await as(null, 'select id from marketing_dneskai_topics')).toEqual([]);
  });

  it('grants the owner functions to authenticated only', async () => {
    for (const fn of ['marketing_dneskai_topic_decide(uuid,text)', 'marketing_dneskai_topic_edit(uuid,text,text)', 'marketing_dneskai_topic_create(uuid,text,text,text,text)']) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated", [fn]);
      expect(rows[0], fn).toEqual({ anon: false, authenticated: true });
    }
  });

  it('refuses a project of another owner and checks every column', async () => {
    await expect(db.query("insert into marketing_dneskai_topics(user_id,project_id,kind,source_kind,source_ref,title_cs) values($1,$2,'news','feed','feed:1','Titulek')", [owner, foreign])).rejects.toThrow(/foreign collection project/);
    const insert = (patch: Record<string, string>) => {
      const values = { kind: 'news', source_kind: 'feed', source_ref: `check:${randomUUID()}`, title_cs: 'Titulek', ...patch };
      const columns = Object.keys(values);
      return db.query(`insert into marketing_dneskai_topics(user_id,project_id,${columns.join(',')}) values($1,$2,${columns.map((_, index) => `$${index + 3}`).join(',')})`, [owner, project, ...Object.values(values)]);
    };
    for (const patch of [{ kind: 'story' }, { source_kind: 'web' }, { verdict: 'maybe' }, { keyword: 'dvě slova' }, { keyword: 'čeština' }, { status: 'queued' }, { title_cs: ' padding ' }, { title_cs: 'x'.repeat(161) }] as Array<Record<string, string>>) {
      await expect(insert(patch), JSON.stringify(patch)).rejects.toThrow(/check/);
    }
    await expect(db.query("insert into marketing_dneskai_topics(user_id,project_id,kind,source_kind,source_ref,title_cs,status) values($1,$2,'news','feed','approved:1','Titulek','approved')", [owner, project])).rejects.toThrow(/check/);
    await db.query("insert into marketing_dneskai_topics(user_id,project_id,kind,source_kind,source_ref,title_cs) values($1,$2,'news','feed','dup:1','Titulek')", [owner, project]);
    await expect(db.query("insert into marketing_dneskai_topics(user_id,project_id,kind,source_kind,source_ref,title_cs) values($1,$2,'news','feed','dup:1','Jiný')", [owner, project])).rejects.toThrow(/unique|duplicate/);
  });

  it('approves, rejects and restores through the allowed transitions only', async () => {
    const id = await seed();
    expect((await decide(id, 'approve'))[0]!.r.status).toBe('approved');
    expect((await row(id)).approved_at).not.toBeNull();
    await expect(decide(id, 'approve')).rejects.toThrow(/topic status/);
    await expect(decide(id, 'restore')).rejects.toThrow(/topic status/);
    expect((await decide(id, 'reject'))[0]!.r.status).toBe('rejected');
    expect((await row(id)).approved_at).toBeNull();
    expect((await decide(id, 'restore'))[0]!.r.status).toBe('proposed');
    const expired = await seed(owner, project, { status: 'expired' });
    expect((await decide(expired, 'restore'))[0]!.r.status).toBe('proposed');
    const started = await seed(owner, project, { status: 'enriching', approved: true });
    await expect(decide(started, 'reject')).rejects.toThrow(/topic status/);
    await expect(decide(id, 'publish')).rejects.toThrow(/topic action invalid/);
  });

  it('never acts on another owner’s topic or without a session', async () => {
    const theirs = await seed(other, foreign);
    await expect(decide(theirs, 'approve')).rejects.toThrow(/topic unavailable/);
    await expect(as(null, 'select marketing_dneskai_topic_decide($1,$2) r', [theirs, 'approve'])).rejects.toThrow(/topic unavailable/);
    await expect(as(owner, 'select marketing_dneskai_topic_edit($1,$2,$3) r', [theirs, 'Nový', null])).rejects.toThrow(/topic unavailable/);
    expect((await row(theirs)).status).toBe('proposed');
  });

  it('edits the title and keyword until enrichment starts', async () => {
    const id = await seed();
    await as(owner, 'select marketing_dneskai_topic_edit($1,$2,$3) r', [id, '  Nový titulek  ', 'Claude']);
    expect(await row(id)).toMatchObject({ title_cs: 'Nový titulek', keyword: 'Claude' });
    await as(owner, 'select marketing_dneskai_topic_edit($1,$2,$3) r', [id, 'Nový titulek', '']);
    expect((await row(id)).keyword).toBeNull();
    await expect(as(owner, 'select marketing_dneskai_topic_edit($1,$2,$3) r', [id, 'Titulek', 'dvě slova'])).rejects.toThrow(/check/);
    await expect(as(owner, 'select marketing_dneskai_topic_edit($1,$2,$3) r', [id, '   ', null])).rejects.toThrow(/check/);
    const briefed = await seed(owner, project, { status: 'briefed', approved: true });
    await expect(as(owner, 'select marketing_dneskai_topic_edit($1,$2,$3) r', [briefed, 'Pozdě', null])).rejects.toThrow(/topic status/);
  });

  it('creates a manual topic from a URL or a title, once per source', async () => {
    const [byUrl] = await as<{ r: { id: string; status: string } }>(owner, 'select marketing_dneskai_topic_create($1,$2,$3,$4,$5) r', [project, 'education', null, 'https://example.test/tool', null]);
    expect(byUrl!.r.status).toBe('proposed');
    const created = (await db.query<{ source_kind: string; title_cs: string; evidence: unknown; user_id: string }>('select source_kind,title_cs,evidence,user_id from marketing_dneskai_topics where id=$1', [byUrl!.r.id])).rows[0]!;
    expect(created).toEqual({ source_kind: 'manual', title_cs: 'https://example.test/tool', evidence: { urls: ['https://example.test/tool'] }, user_id: owner });
    await expect(as(owner, 'select marketing_dneskai_topic_create($1,$2,$3,$4,$5) r', [project, 'education', 'Jiný titulek', 'https://example.test/tool', null])).rejects.toThrow(/topic exists/);
    const [byTitle] = await as<{ r: { id: string } }>(owner, 'select marketing_dneskai_topic_create($1,$2,$3,$4,$5) r', [project, 'news', 'Ruční námět', null, 'Agent']);
    expect(await row(byTitle!.r.id)).toMatchObject({ title_cs: 'Ruční námět', keyword: 'Agent', status: 'proposed' });
    await expect(as(owner, 'select marketing_dneskai_topic_create($1,$2,$3,$4,$5) r', [project, 'news', null, 'http://example.test/plain', null])).rejects.toThrow(/topic url invalid/);
    await expect(as(owner, 'select marketing_dneskai_topic_create($1,$2,$3,$4,$5) r', [project, 'news', ' ', null, null])).rejects.toThrow(/topic title invalid/);
    await expect(as(owner, 'select marketing_dneskai_topic_create($1,$2,$3,$4,$5) r', [foreign, 'news', 'Cizí', null, null])).rejects.toThrow(/topic unavailable/);
    await expect(as(owner, 'select marketing_dneskai_topic_create($1,$2,$3,$4,$5) r', [project, 'story', 'Druh', null, null])).rejects.toThrow(/check/);
  });
});
