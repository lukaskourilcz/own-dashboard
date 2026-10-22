import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dneskaiEventCategory, dneskaiEventId, dneskaiFinishEvents, groupDneskaiEvents } from '@/lib/marketing/dneskai-events';
import type { DneskaiCandidate } from '@/lib/marketing/dneskai-contracts';
import { BRIEF_MIGRATIONS, createBriefsDatabase, insertCandidates, syntheticCandidate } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

// SEL-10: real migration SQL in isolated WASM Postgres, an OFFLINE clock and synthetic candidates only.
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', fence = '55555555-5555-4555-8555-555555555555';
const instant = '2026-10-20T20:30:00Z', today = '2026-10-20';
const MAJORITY = '20261022160000_dneskai_event_majority_category.sql';
const json = JSON.stringify;
const classified = (sourceId: string, id: string, category: DneskaiCandidate['category'], relevance: number, minutes = 0) =>
  syntheticCandidate(sourceId, id, 'Synthetic release of Model Nine weights for developers', { category, relevance, publishedAt: new Date(Date.parse('2026-10-20T15:00:00Z') + minutes * 60000).toISOString(),
    fetchedAt: new Date(Date.parse('2026-10-20T20:00:00Z') + minutes * 60000).toISOString() }, `Synthetic report ${id}.`);
// A GitHub release Jev called an ai-project, ahead in relevance, beside two newsroom articles it called ai-news.
const release = classified('github-ai-releases', 'release', 'ai-project', 0.95);
const verge = classified('the-verge', 'verge', 'ai-news', 0.88, 5);
const wired = classified('wired-ai', 'wired', 'ai-news', 0.87, 9);
const members = [release, verge, wired];

async function finish(db: PGlite, events: unknown) {
  const id = (await db.query<{ r: { id: string } }>('select marketing_dneskai_admit($1,$2,$3,$4) r', [owner, project, today, json([{ id: 'openai-blog', kind: 'rss', maxItems: 10 }])])).rows[0]!.r.id;
  await db.query('select marketing_dneskai_claim($1,$2,$3)', [owner, id, fence]);
  await db.query("update marketing_dneskai_stages set status='ok',cost_usd=0 where run_id=$1", [id]);
  await insertCandidates(db, owner, project, id, members);
  await db.query('select marketing_dneskai_finish($1,$2,$3,$4,null,$5)', [owner, id, fence, 'complete', json(events)]);
  return (await db.query<{ category: string; lead_candidate_id: string; event_id: string }>('select category,lead_candidate_id,event_id from marketing_dneskai_briefs where run_id=$1', [id])).rows;
}
const grouping = () => dneskaiFinishEvents(groupDneskaiEvents(members), undefined, (event) => dneskaiEventCategory(event.members, () => true));

describe('the event category by majority (SEL-10)', () => {
  it('sends the majority category with the grouping', () => {
    expect(grouping()).toEqual([{ eventId: dneskaiEventId(release.id), anchorId: release.id, memberIds: [release.id, verge.id, wired.id], category: 'ai-news' }]);
  });

  describe('on the deployed SQL, without the new migration', () => {
    let db: PGlite;
    beforeAll(async () => { db = await createBriefsDatabase([owner], [{ id: project, owner }], instant, BRIEF_MIGRATIONS); }, 60000);
    afterAll(async () => { await db?.close(); });
    it('ignores the extra key and keeps the lead report\'s category', async () => {
      expect(await finish(db, grouping())).toEqual([{ category: 'ai-project', lead_candidate_id: release.id, event_id: dneskaiEventId(release.id) }]);
    });
  });

  describe('with 20261022160000_dneskai_event_majority_category.sql', () => {
    let db: PGlite;
    beforeAll(async () => { db = await createBriefsDatabase([owner], [{ id: project, owner }], instant, [...BRIEF_MIGRATIONS, MAJORITY]); }, 60000);
    afterAll(async () => { await db?.close(); });
    it('takes the majority category and keeps the most relevant report as the lead', async () => {
      expect(await finish(db, grouping())).toEqual([{ category: 'ai-news', lead_candidate_id: release.id, event_id: dneskaiEventId(release.id) }]);
    });
    it('falls back to the lead\'s category for a category no eligible member carries, and refuses nothing new', async () => {
      await db.exec('delete from marketing_dneskai_briefs; delete from marketing_dneskai_candidates; delete from marketing_dneskai_stages; delete from marketing_dneskai_runs;');
      expect(await finish(db, grouping().map((event) => ({ ...event, category: 'marketing' })))).toEqual([{ category: 'ai-project', lead_candidate_id: release.id, event_id: dneskaiEventId(release.id) }]);
      await db.exec('delete from marketing_dneskai_briefs; delete from marketing_dneskai_candidates; delete from marketing_dneskai_stages; delete from marketing_dneskai_runs;');
      expect(await finish(db, grouping().map((event) => ({ ...event, category: 'not-a-category' })))).toEqual([{ category: 'ai-project', lead_candidate_id: release.id, event_id: dneskaiEventId(release.id) }]);
    });
    it('keeps the function service-only', async () => {
      const grants = (await db.query<{ ok: boolean }>("select has_function_privilege('authenticated','public.marketing_dneskai_finish(uuid,uuid,uuid,text,text,jsonb)','execute') as ok")).rows[0]!.ok;
      expect(grants).toBe(false);
    });
  });
});
