import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDneskaiBriefStore, createDneskaiBriefsWithStore, listDneskaiBriefAssetHashes, type DneskaiBriefStore } from '@/lib/marketing/dneskai-briefs';
import { refreshDneskaiBriefPacket } from '@/lib/marketing/dneskai-brief-source';
import { dneskaiFinishEvents, groupDneskaiEvents } from '@/lib/marketing/dneskai-events';
import { dneskaiMediaCapabilities } from '@/lib/marketing/dneskai-media-plan';
import { parseSourcePacket } from '@/lib/marketing/contracts';
import { contentHash } from '@/lib/marketing/hashes';
import type { DneskaiCandidate } from '@/lib/marketing/dneskai-contracts';
import type { DneskaiMediaAssetView } from '@/lib/marketing/dneskai-media-contracts';
import { briefsRpcClient, createBriefsDatabase, insertCandidates, pgliteRestClient, setBriefsTestTime, syntheticCandidate } from './marketing-dneskai-briefs-db';
import { readDneskaiBriefs } from '@/lib/marketing/dneskai-brief-read';
import { createDneskaiCollectionStore } from '@/lib/marketing/dneskai-store';
vi.mock('server-only', () => ({}));

// One collection night end to end in isolated WASM Postgres: real migration SQL, OFFLINE clock, synthetic data.
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', fence = '55555555-5555-4555-8555-555555555555';
const instant = '2026-10-20T20:30:00Z';
// The JavaScript clock of the slot choice is the database clock: slots are chosen relative to it, never to the real time.
const clock = { now: () => new Date(instant) };
let db: PGlite; let rpc: ReturnType<typeof briefsRpcClient>; let store: DneskaiBriefStore; let runId: string;
const json = JSON.stringify;
const rows = async <T,>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;
const at = (minutes: number) => new Date(Date.parse('2026-10-20T15:00:00Z') + minutes * 60000).toISOString();
const report = (sourceId: string, id: string, title: string, category: DneskaiCandidate['category'], minutes: number, patch: Partial<DneskaiCandidate> = {}) =>
  syntheticCandidate(sourceId, id, title, { category, relevance: 0.93, publishedAt: at(minutes), fetchedAt: at(300 + minutes), ...patch }, `${title}. Synthetic report ${id}. `.repeat(20));
const lead = report('openai-blog', 'lead', 'Synthetic launch of Model Nine for developers', 'ai-news', 0);
const verge = report('the-verge', 'verge', 'Synthetic launch of Model Nine for developers', 'ai-news', 20, { relevance: 0.9 });
const tool = report('hf-blog', 'tool', 'Synthetic notebook tool for tiny datasets', 'tool', 10, { relevance: 0.88 });
const picture = 'c'.repeat(64);

/**
 * The service-role store exactly as production builds it, over a PostgREST stand-in on the same database. Only
 * the reads that use embedded relations (media links, publications) are answered by SQL here.
 */
function pgliteStore(): DneskaiBriefStore {
  const client = pgliteRestClient(db);
  const real = createDneskaiBriefStore(client as never, {
    // marketing_enqueue_job exactly as enqueueMarketingJob calls it; the identity hash mirrors marketingJobIdentityHash.
    enqueue: async (who, request) => {
      const value = request as { idempotencyKey: string; generation: { source: { observedAt: string } } };
      const { data, error } = await rpc.rpc('marketing_enqueue_job', { p_owner: who, p_key: value.idempotencyKey, p_hash: contentHash({ ...value, generation: { ...value.generation, source: { ...value.generation.source, observedAt: null } } }), p_request: request });
      if (error) throw new Error(error.message);
      return data as { jobId: string; status: string; duplicate: boolean };
    },
  });
  return {
    ...real,
    media: async (who, projectId, candidateId) => ({ candidateId, assets: (await rows<{ asset_id: string; sha256: string; position: number; origin_kind: DneskaiMediaAssetView['originKind']; origin_url: string; credit: string; width: number; height: number }>(
      'select a.id asset_id,a.sha256,l.position,l.origin_kind,l.origin_url,l.credit,a.width,a.height from marketing_media_asset_links l join marketing_media_assets a on a.id=l.asset_id where l.user_id=$1 and l.project_id=$2 and l.candidate_id=$3 order by l.position', [who, projectId, candidateId]))
      .map((row) => ({ assetId: row.asset_id, sha256: row.sha256, position: row.position, originKind: row.origin_kind, originUrl: row.origin_url, credit: row.credit, width: row.width, height: row.height, mime: 'image/jpeg', bytes: 1000, fetchedAt: instant, ...dneskaiMediaCapabilities(row), duplicateOfAssetId: null, duplicateOfSha256: null, purged: false, previewUrl: null })) }) as never,
    takenSlots: async () => [],
  };
}

beforeAll(async () => {
  db = await createBriefsDatabase([owner], [{ id: project, owner }], instant);
  // The job admission reads now() (a brief's source expires 48 hours after it was observed), so it is pinned as well.
  await db.exec("create or replace function pg_catalog.now() returns timestamptz language sql stable as $$ select current_setting('marketing.test_time')::timestamptz $$");
  rpc = briefsRpcClient(db); store = pgliteStore();
  runId = (await rows<{ r: { id: string } }>('select marketing_dneskai_admit($1,$2,$3,$4) r', [owner, project, '2026-10-20', json([{ id: 'openai-blog', kind: 'rss', maxItems: 10 }])]))[0]!.r.id;
  await db.query('select marketing_dneskai_claim($1,$2,$3)', [owner, runId, fence]);
  await db.query("update marketing_dneskai_stages set status='ok',cost_usd=0 where run_id=$1", [runId]);
  await insertCandidates(db, owner, project, runId, [lead, verge, tool]);
  await db.query('select marketing_dneskai_finish($1,$2,$3,$4,null,$5)', [owner, runId, fence, 'complete', json(dneskaiFinishEvents(groupDneskaiEvents([lead, verge, tool])))]);
}, 60000);
afterAll(async () => { await db?.close(); });

describe('one collection becomes briefs and guarded jobs without any Quorum call (#115)', () => {
  it('waits for media, then builds briefs that wait for a verified account without creating a job', async () => {
    const input = { owner, project, runId };
    expect(await createDneskaiBriefsWithStore(store, input, clock)).toEqual({ created: [], skipped: [], pending: true });
    // The media collector (#114) finished: the lead has one stored picture, the others none.
    const [asset] = await rows<{ id: string }>("insert into marketing_media_assets(user_id,project_id,sha256,candidate_id,source_id,external_id,origin_url,origin_kind,position,width,height,mime,bytes,storage_path,credit) values($1,$2,$3,$4,'openai-blog','lead','https://images.example.test/lead.jpg','og-image',0,1600,900,'image/jpeg',1000,$5,'Obrázek: OpenAI') returning id",
      [owner, project, picture, lead.id, `marketing-media/${owner}/${picture}.jpg`]);
    await db.query("insert into marketing_media_asset_links(user_id,project_id,candidate_id,asset_id,origin_url,origin_kind,position,credit) values($1,$2,$3,$4,'https://images.example.test/lead.jpg','og-image',0,'Obrázek: OpenAI')", [owner, project, lead.id, asset!.id]);
    for (const [id, status] of [[lead.id, 'complete'], [verge.id, 'empty'], [tool.id, 'empty']]) await db.query('insert into marketing_media_collections(user_id,project_id,candidate_id,status,asset_count) values($1,$2,$3,$4,$5)', [owner, project, id, status, status === 'complete' ? 1 : 0]);
    const result = await createDneskaiBriefsWithStore(store, input, clock);
    // Built, but still waiting for the account: the scheduler must call again.
    expect(result.pending).toBe(true);
    expect(result.created.map((item) => item.jobId)).toEqual([null, null]);
    const briefs = await store.briefs(owner, project, runId);
    expect(briefs.map((row) => [row.rank, row.status, row.code, row.scheduled_at])).toEqual([[1, 'pending', 'account-unavailable', '2026-10-21T06:00:00+00:00'], [2, 'pending', 'account-unavailable', '2026-10-21T10:30:00+00:00']]);
    // The owner's read: events with their reports, primary first, and the brief state.
    const read = await readDneskaiBriefs(pgliteRestClient(db) as never, owner, project, '2026-10-21');
    expect(read.events.map((event) => [event.status, event.brief?.rank, event.brief?.status, event.brief?.code, event.members.map((member) => [member.candidateId, member.role])])).toEqual([
      ['selected', 1, 'pending', 'account-unavailable', [[lead.id, 'primary'], [verge.id, 'supporting']]], ['selected', 2, 'pending', 'account-unavailable', [[tool.id, 'primary']]]]);
    expect(read.events[0]!.brief).toMatchObject({ scheduledAt: '2026-10-21T06:00:00.000Z', mediaCount: 1, evidenceCount: 2, suggestedFormat: 'carousel' });
    expect(briefs[0]!.brief).toMatchObject({ schemaVersion: 'dneskai-brief/1', evidence: [{ candidateId: lead.id }, { candidateId: verge.id }], media: [{ assetSha256: picture, candidateId: lead.id, credit: 'Obrázek: OpenAI' }], suggestedFormat: 'carousel' });
    expect(await rows('select * from marketing_jobs')).toEqual([]);
  });

  it('admits each brief through the DNESKAi daily campaign, one calendar entry and marketing_enqueue_job', async () => {
    await db.query("insert into marketing_accounts(user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,'dneskai','instagram','17840000000000000','dneskai',now(),false)", [owner]);
    const result = await createDneskaiBriefsWithStore(store, { owner, project, runId }, clock);
    expect(result.skipped).toEqual([]);
    expect(result.created).toHaveLength(2);
    const jobs = await rows<{ id: string; status: string; request: { calendarEntryId: string; generation: { source: unknown; scheduledAt: string } } }>('select id,status,request from marketing_jobs order by created_at');
    expect(jobs.map((job) => job.status)).toEqual(['queued', 'queued']);
    expect(result.created.map((item) => item.jobId).sort()).toEqual(jobs.map((job) => job.id).sort());
    const packet = parseSourcePacket(jobs[0]!.request.generation.source);
    expect(packet).toMatchObject({ kind: 'brief', brand: 'dneskai', canonicalUrl: lead.url });
    const campaigns = await rows<{ name: string; status: string; brand: string }>('select name,status,brand from marketing_campaigns');
    expect(campaigns).toEqual([{ name: 'DNESKAi daily', status: 'active', brand: 'dneskai' }]);
    const entries = await rows<{ kind: string; platform: string; local_time: string; date: string; status: string }>('select kind,platform,local_time,date::text,status from marketing_calendar_entries order by local_time');
    expect(entries).toEqual([{ kind: 'carousel', platform: 'instagram', local_time: '08:00', date: '2026-10-21', status: 'planned' }, { kind: 'carousel', platform: 'instagram', local_time: '12:30', date: '2026-10-21', status: 'planned' }]);
    for (const job of jobs) expect((await rows<{ ok: boolean }>('select marketing_calendar_job_current($1,$2) ok', [owner, json(job.request)]))[0]!.ok).toBe(true);
    expect((await store.briefs(owner, project, runId)).map((row) => row.status)).toEqual(['queued', 'queued']);
    // Idempotent: nothing new on a second call.
    expect(await createDneskaiBriefsWithStore(store, { owner, project, runId }, clock)).toEqual({ created: [], skipped: [], pending: false });
    expect(await rows('select id from marketing_jobs')).toHaveLength(2);
  });

  it('records the existing job of a brief that missed it, even after its entry left planned', async () => {
    const [brief] = await store.briefs(owner, project, runId);
    const jobs = await rows<{ id: string }>('select id from marketing_jobs order by id');
    // marketing_dneskai_brief_queued failed after marketing_enqueue_job succeeded; the entry moved on since.
    await db.query("update marketing_dneskai_briefs set status='ready',job_id=null where id=$1", [brief!.id]);
    await db.query("update marketing_calendar_entries set status='drafted' where id=$1", [brief!.calendar_entry_id]);
    expect(await createDneskaiBriefsWithStore(store, { owner, project, runId }, clock)).toEqual({ created: [{ briefId: brief!.id, eventId: brief!.event_id, jobId: brief!.job_id }], skipped: [], pending: false });
    expect(await rows<{ id: string }>('select id from marketing_jobs order by id')).toEqual(jobs);
    expect((await store.briefs(owner, project, runId))[0]).toMatchObject({ status: 'queued', job_id: brief!.job_id, code: null });
    await db.query("update marketing_calendar_entries set status='planned' where id=$1", [brief!.calendar_entry_id]);
  });

  it('re-reads a brief from the store and makes it ineligible when a member changes', async () => {
    const job = (await rows<{ request: { generation: { source: unknown } } }>("select request from marketing_jobs where request->'generation'->'source'->>'canonicalUrl'=$1", [lead.url]))[0]!;
    const packet = parseSourcePacket(job.request.generation.source);
    const now = new Date('2026-10-20T21:00:00Z');
    expect(await refreshDneskaiBriefPacket(rpc as never, owner, packet, now)).toEqual({ packet: { ...packet, observedAt: now.toISOString() } });
    await db.query("update marketing_dneskai_candidates set status='rejected' where id=$1", [verge.id]);
    expect(await refreshDneskaiBriefPacket(rpc as never, owner, packet, now)).toMatchObject({ packet: { eligible: false, eligibilityReason: 'brief-members-changed' } });
    expect(await refreshDneskaiBriefPacket(rpc as never, '99999999-9999-4999-8999-999999999999', packet, now)).toEqual({ held: 'source-unavailable' });
    await db.query("update marketing_dneskai_candidates set status='selected' where id=$1", [verge.id]);
  });

  it('offers an edit the brief’s pictures plus the deck’s own, never another brief’s', async () => {
    const packet = parseSourcePacket((await rows<{ request: { generation: { source: unknown } } }>("select request from marketing_jobs where request->'generation'->'source'->>'canonicalUrl'=$1", [lead.url]))[0]!.request.generation.source);
    const from = (table: string) => {
      const filters: Array<[string, string, unknown]> = [];
      const chain = { select: () => chain, eq: (column: string, value: unknown) => { filters.push(['=', column, value]); return chain; }, neq: (column: string, value: unknown) => { filters.push(['<>', column, value]); return chain; },
        limit: async () => ({ data: await rows(`select brief from ${table} where ${filters.map(([op, column], index) => `${column}${op}$${index + 1}`).join(' and ')}`, filters.map(([, , value]) => value)), error: null }) };
      return chain;
    };
    const own = 'd'.repeat(64);
    const deck = { slides: [{ images: [{ slot: 'image-1', assetSha256: own }] }] };
    expect(await listDneskaiBriefAssetHashes({ from } as never, owner, { sources: [{ sourceId: packet.sourceId, sourceRevision: packet.sourceRevision, contentHash: packet.contentHash }], deck } as never)).toEqual([picture, own]);
    expect(await listDneskaiBriefAssetHashes({ from } as never, owner, { sources: [{ sourceId: packet.sourceId, sourceRevision: 'e'.repeat(64), contentHash: packet.contentHash }], deck } as never)).toEqual([own]);
  });

  it('reads recent prepared revisions as coverage: their source and evidence URLs and the pictures their decks draw', async () => {
    const [brief] = await store.briefs(owner, project, runId);
    const source = (await rows<{ source_revision: string; content_hash: string }>('select source_revision,content_hash from marketing_sources where source_id=$1', [brief!.event_id]))[0]!;
    const revision = { sources: [{ sourceId: brief!.event_id, sourceRevision: source.source_revision, contentHash: source.content_hash }], deck: { slides: [{ images: [{ slot: 'image-1', assetSha256: picture }] }, { images: [] }] } };
    await db.query("insert into marketing_revisions(id,user_id,brand,revision,content_hash,ready,status) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$1,'dneskai',$2,$3,true,'published')", [owner, json(revision), 'e'.repeat(64)]);
    await db.query("insert into marketing_revisions(id,user_id,brand,revision,content_hash,ready,status) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$1,'dneskai',$2,$3,true,'superseded')", [owner, json({ ...revision, deck: { slides: [{ images: [{ slot: 'image-1', assetSha256: 'f'.repeat(64) }] }] } }), 'd'.repeat(64)]);
    const coverage = await store.coverage(owner, project, new Date('2026-10-07T00:00:00Z'), '00000000-0000-4000-8000-000000000000');
    const fromRevision = coverage.find((item) => item.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(fromRevision).toMatchObject({ duplicateOf: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assetSha256s: [picture] });
    expect(fromRevision!.urls).toEqual(expect.arrayContaining([lead.url, verge.url]));
    expect(coverage.some((item) => item.id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(false);
    // This run's own briefs are not coverage of themselves; another run's queued briefs are.
    expect(coverage.filter((item) => item.duplicateOf === lead.id)).toHaveLength(1);
    expect((await store.coverage(owner, project, new Date('2026-10-07T00:00:00Z'), runId)).filter((item) => item.duplicateOf === lead.id)).toHaveLength(0);
    // The articles that carry a picture, for the site-wide card rule: the event's own reports are left out.
    expect(await store.pictureArticles(owner, project, [picture], [])).toEqual([{ sha256: picture, url: lead.url }]);
    expect(await store.pictureArticles(owner, project, [picture], [lead.id, verge.id])).toEqual([]);
    await db.query('delete from marketing_revisions');
  });

  it('never takes over another active DNESKAi campaign, refuses a taken slot and closes a repeat as a duplicate', async () => {
    await setBriefsTestTime(db, instant);
    const [brief] = await store.briefs(owner, project, runId);
    await db.query("update marketing_campaigns set status='archived'");
    await db.query("insert into marketing_campaigns(user_id,brand,name,starts_on,ends_on,source_snapshot,source_hash,status) values($1,'dneskai','Imported plan','2026-10-01','2026-12-31','{}',$2,'active')", [owner, 'f'.repeat(64)]);
    await db.query("update marketing_dneskai_briefs set status='ready',job_id=null,calendar_entry_id=null where id=$1", [brief!.id]);
    const source = (await rows<{ id: string }>("select id from marketing_sources where source_id=$1", [brief!.event_id]))[0]!.id;
    expect(await rpc.rpc('marketing_dneskai_admit_brief', { p_owner: owner, p_brief: brief!.id, p_source: source })).toMatchObject({ error: { message: expect.stringContaining('brief campaign conflict') } });
    const [, second] = await store.briefs(owner, project, runId);
    expect(await rpc.rpc('marketing_dneskai_prepare_brief', { p_owner: owner, p_brief: brief!.id, p_value: { ...(brief!.brief as object), scheduledAt: second!.scheduled_at }, p_scheduled_at: second!.scheduled_at, p_status: 'ready', p_code: null }))
      .toMatchObject({ error: { message: expect.stringMatching(/marketing_dneskai_brief_slot|brief invalid/) } });
    expect((await rpc.rpc('marketing_dneskai_skip_brief', { p_owner: owner, p_brief: brief!.id, p_code: 'collection-already-covered', p_duplicate_of: 'revision-test-only' })).error).toBeNull();
    const members = await rows<{ status: string; candidate: DneskaiCandidate }>('select status,candidate from marketing_dneskai_candidates where id=any($1)', [brief!.member_ids]);
    expect(members.every((row) => row.status === 'duplicate' && row.candidate.reason === 'collection-already-covered' && row.candidate.duplicateOf === 'revision-test-only')).toBe(true);
  });

  it('gives Jev the approved and published DNESKAi posts as history, although they carry no project', async () => {
    const other = '99999999-9999-4999-8999-999999999999';
    await db.query('insert into auth.users values($1)', [other]);
    const posts = [['01', owner, 'dneskai', 'published'], ['02', owner, 'dneskai', 'approved'], ['03', owner, 'dneskai', 'publishing'], ['04', owner, 'dneskai', 'review'],
      ['05', owner, 'devshark', 'published'], ['06', other, 'dneskai', 'published']] as const;
    for (const [n, user, brand, status] of posts) {
      await db.query('insert into marketing_revisions(id,user_id,brand,revision,content_hash,ready,status) values($1,$2,$3,$4,$5,true,$6)',
        [`aaaaaaaa-0000-4000-8000-0000000000${n}`, user, brand, json({ title: `Synthetic post ${n}`, caption: `Synthetic caption ${n}.` }), contentHash(n), status]);
    }
    // marketing_save_revision writes no project on a DNESKAi revision.
    expect(await rows('select id from marketing_revisions where project_id is not null')).toEqual([]);
    const history = await createDneskaiCollectionStore(pgliteRestClient(db) as never).history(owner, project);
    const posted = history.filter((item) => item.id.startsWith('aaaaaaaa-0000-'));
    expect(posted.map((item) => item.id).sort()).toEqual(['01', '02', '03'].map((n) => `aaaaaaaa-0000-4000-8000-0000000000${n}`));
    expect(posted.find((item) => item.id.endsWith('01'))).toEqual({ id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Synthetic post 01', text: 'Synthetic caption 01.' });
    // The selected reports of the project are still history too.
    expect(history.map((item) => item.id)).toContain(tool.id);
    await db.query('delete from marketing_revisions');
  });
});
