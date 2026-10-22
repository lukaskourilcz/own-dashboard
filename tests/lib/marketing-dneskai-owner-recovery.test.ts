import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { contentHash } from '@/lib/marketing/hashes';
import { buildDneskaiBrief, createDneskaiBriefStore, type DneskaiBriefsDatabase } from '@/lib/marketing/dneskai-briefs';
import { DneskaiRecoveryError, dneskaiRecoveryCapabilities, dneskaiRecoverySqlCode, releaseDneskaiBrief, releaseHeldDneskaiCandidate, reslotDneskaiBrief, retryDneskaiBrief } from '@/lib/marketing/dneskai-recovery';
import { DNESKAI_RECOVERY_OFF, dneskaiBriefActions, dneskaiHeldGroup, dneskaiHeldReleaseBlock } from '@/lib/marketing/dneskai-recovery-rules';
import { BRIEF_MIGRATIONS, createBriefsDatabase, insertCandidates, pgliteRestClient, syntheticCandidate } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

const owner = '11111111-1111-4111-8111-111111111111', other = '33333333-3333-4333-8333-333333333333';
// 10:00 in Prague on 23 October 2026.
const now = new Date('2026-10-23T08:00:00Z');
const ON = { retry: true, reslot: true, heldRelease: true, lapsedRelease: true };
let db: PGlite;
beforeAll(async () => {
  db = await createBriefsDatabase([owner, other], [], now.toISOString(), [...BRIEF_MIGRATIONS, '20261022141512_dneskai_owner_recovery.sql', '20261022141613_dneskai_release_lapsed_brief.sql']);
}, 60_000);
afterAll(async () => { await db?.close(); });

/** The owner's session client: plain reads, and RPCs as `authenticated` with the owner's JWT subject. */
function userClient(user: string) {
  const rest = pgliteRestClient(db);
  return {
    from: rest.from,
    async rpc(name: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      const values = keys.map((key) => { const value = args[key]; return value !== null && typeof value === 'object' ? JSON.stringify(value) : value; });
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec('set role authenticated');
      try { return { data: (await db.query<{ r: unknown }>(`select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(', ')}) as r`, values)).rows[0]?.r ?? null, error: null }; }
      catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }; }
      finally { await db.exec('reset role'); }
    },
  } as unknown as DneskaiBriefsDatabase;
}
const admin = () => pgliteRestClient(db) as unknown as DneskaiBriefsDatabase;
/** The real store over PGlite, with the reads PGlite's REST stand-in cannot embed replaced by empty answers. */
const store = (taken: string[] = []) => ({ ...createDneskaiBriefStore(admin()), media: async () => null, takenSlots: async () => taken, coverage: async () => [], phashes: async () => new Map(), pictureArticles: async () => [] });
const context = (capabilities = ON, taken: string[] = []) => ({ user: userClient(owner), admin: admin(), owner, capabilities, now, store: store(taken) });

async function seed(label: string, options: { status?: 'skipped' | 'ready'; code?: string; expiresAt?: string; heldAt?: string } = {}) {
  const project = randomUUID(), run = randomUUID(), brief = randomUUID(), event = contentHash(label);
  await db.query("insert into projects(id,user_id,portfolio_key) values($1,$2,'aifirst')", [project, owner]);
  await db.query("insert into marketing_dneskai_runs(id,user_id,project_id,date,target_date) values($1,$2,$3,'2026-10-21','2026-10-22')", [run, owner, project]);
  const ready = options.status === 'ready', target = ready ? '2026-10-24' : '2026-10-22';
  const item = syntheticCandidate('openai-blog', label, `Synthetic ${label}`, { status: 'selected', targetDate: target, category: 'ai-news', relevance: 0.99, reason: 'research-selection-not-fact-checked' }, undefined, undefined, '2026-10-22T18:00:00Z');
  await insertCandidates(db, owner, project, run, [item]);
  const hash = (await db.query<{ h: string }>('select marketing_private.dneskai_member_hash($1,$2,$3) h', [owner, project, [item.id]])).rows[0]!.h;
  const scheduledAt = ready ? '2026-10-24T06:00:00.000Z' : '2026-10-22T06:00:00.000Z';
  const built = buildDneskaiBrief({ eventId: event, memberHash: hash, targetDate: target, category: 'ai-news', scheduledAt, observedAt: new Date(Date.parse(options.expiresAt ?? '2026-10-23T21:00:00.000Z') - 48 * 3600000), members: [{ candidate: item, media: [] }], richEvidence: false });
  if (!('brief' in built)) throw new Error('fixture brief invalid');
  await db.query("insert into marketing_dneskai_briefs(id,user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash,status,code,brief,scheduled_at) values($1,$2,$3,$4,$5,$6,1,'ai-news',$7,$8,$9,$10,$11,$12,$13)",
    [brief, owner, project, run, event, target, [item.id], item.id, hash, options.status ?? 'skipped', options.code ?? 'brief-slot-passed', JSON.stringify(built.brief), scheduledAt]);
  const held = syntheticCandidate('the-verge', `${label}-held`, `Held ${label}`, { status: 'held', category: 'ai-news', relevance: 0.6, reason: 'collection-review-relevance' }, undefined, undefined, options.heldAt ?? '2026-10-22T18:00:00Z');
  await insertCandidates(db, owner, project, run, [held]);
  return { brief, project, item, held, built: built.brief };
}
const row = async (id: string) => (await db.query<{ status: string; code: string | null; brief: { schemaVersion: string; expiresAt: string; scheduledAt: string } }>('select status,code,brief from marketing_dneskai_briefs where id=$1', [id])).rows[0]!;
const refusal = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { if (error instanceof DneskaiRecoveryError) return error.code; throw error; } return 'no-refusal'; };

describe('recovery rules', () => {
  it('groups held reasons by the first failed check', () => {
    expect(['collection-review-category-duplicate-relevance', 'collection-review-duplicate-relevance', 'collection-review-relevance', 'collection-source-date-unavailable-or-stale', 'collection-cost-unverified', 'collection-classification-uncertain', null].map(dneskaiHeldGroup))
      .toEqual(['category', 'duplicate', 'relevance', 'stale', 'cost', 'other', 'other']);
  });
  it('offers retry, reslot and release only where they apply, with a reason when a migration is missing', () => {
    const base = { scheduledAt: '2026-10-24T06:00:00.000Z', jobId: null };
    expect(dneskaiBriefActions({ ...base, status: 'ready', code: 'brief-entry-changed' }, ON, now)).toEqual([{ action: 'retry', available: true, reason: null }]);
    expect(dneskaiBriefActions({ ...base, status: 'ready', code: 'brief-entry-changed', scheduledAt: '2026-10-23T08:20:00.000Z' }, ON, now)).toEqual([{ action: 'retry', available: false, reason: 'recovery-slot-too-close' }]);
    for (const code of ['account-unavailable', 'owner-retry', 'owner-reslot', null]) expect(dneskaiBriefActions({ ...base, status: 'pending', code }, ON, now)).toEqual([]);
    expect(dneskaiBriefActions({ ...base, status: 'skipped', code: 'brief-slot-passed' }, { ...DNESKAI_RECOVERY_OFF, retry: true }, now)).toEqual([
      { action: 'reslot', available: false, reason: 'recovery-reslot-unavailable' }, { action: 'release', available: false, reason: 'recovery-release-unavailable' }]);
    expect(dneskaiBriefActions({ ...base, status: 'skipped', code: 'brief-expired' }, ON, now).map((item) => item.action)).toEqual(['release']);
    expect(dneskaiBriefActions({ ...base, status: 'skipped', code: 'collection-already-covered' }, ON, now)).toEqual([]);
    expect(dneskaiBriefActions({ ...base, status: 'skipped', code: 'brief-slot-passed', jobId: randomUUID() }, ON, now)).toEqual([]);
    expect(dneskaiBriefActions({ ...base, status: 'queued', code: null }, ON, now)).toEqual([]);
  });
  it('blocks a held report without text, without a date or outside its selection window', () => {
    const held = { status: 'held' as const, title: 'T', text: '', publishedAt: '2026-10-22T18:00:00Z', category: 'ai-news' as const };
    expect(dneskaiHeldReleaseBlock(held, now)).toBeNull();
    expect(dneskaiHeldReleaseBlock({ ...held, title: ' ' }, now)).toBe('recovery-held-empty');
    expect(dneskaiHeldReleaseBlock({ ...held, publishedAt: null }, now)).toBe('recovery-held-undated');
    expect(dneskaiHeldReleaseBlock({ ...held, publishedAt: '2026-10-20T18:00:00Z' }, now)).toBe('recovery-held-outside-window');
    expect(dneskaiHeldReleaseBlock({ ...held, publishedAt: '2026-10-20T18:00:00Z', category: 'tool' }, now)).toBeNull();
    expect(dneskaiHeldReleaseBlock({ ...held, status: 'new' }, now)).toBe('recovery-not-held');
  });
  it('enables the SQL actions only through their server switches', () => {
    expect(dneskaiRecoveryCapabilities({})).toEqual({ retry: true, reslot: false, heldRelease: false, lapsedRelease: false });
    expect(dneskaiRecoveryCapabilities({ DNESKAI_OWNER_RECOVERY_ENABLED: 'true' })).toEqual({ retry: true, reslot: true, heldRelease: true, lapsedRelease: false });
    expect(dneskaiRecoveryCapabilities({ DNESKAI_OWNER_RECOVERY_ENABLED: '1', DNESKAI_LAPSED_RELEASE_ENABLED: 'true' })).toEqual({ retry: true, reslot: false, heldRelease: false, lapsedRelease: true });
    expect(dneskaiRecoverySqlCode('duplicate key value violates unique constraint "marketing_dneskai_brief_slot"')).toBe('recovery-slot-taken');
    expect(dneskaiRecoverySqlCode('PRIVATE DETAIL')).toBe('recovery-unavailable');
  });
});

describe('reslot', () => {
  it('rebuilds a lapsed brief for the next free slot today with the same members and expiry, waiting for the account', async () => {
    const f = await seed('reslot-flow');
    expect(await reslotDneskaiBrief(context(), f.brief)).toMatchObject({ status: 'pending', code: 'account-unavailable', targetDate: '2026-10-23' });
    const stored = await row(f.brief);
    expect(stored).toMatchObject({ status: 'pending', code: 'account-unavailable', brief: { schemaVersion: 'dneskai-brief/1', scheduledAt: '2026-10-23T10:30:00.000Z', expiresAt: f.built.expiresAt } });
  });
  it('skips a taken slot and never picks a slot after the brief expires', async () => {
    const f = await seed('reslot-taken');
    await reslotDneskaiBrief(context(ON, ['2026-10-23T10:30:00.000Z']), f.brief);
    expect((await row(f.brief)).brief.scheduledAt).toBe('2026-10-23T15:00:00.000Z');
    const early = await seed('reslot-expiring', { expiresAt: '2026-10-23T10:00:00.000Z' });
    expect(await refusal(reslotDneskaiBrief(context(), early.brief))).toBe('recovery-no-free-slot');
    expect((await row(early.brief)).status).toBe('skipped');
  });
  it('calls no new SQL while the owner-recovery switch is off, and refuses another owner', async () => {
    const f = await seed('reslot-off');
    expect(await refusal(reslotDneskaiBrief(context({ ...ON, reslot: false }), f.brief))).toBe('recovery-reslot-unavailable');
    expect(await refusal(reslotDneskaiBrief({ ...context(), owner: other, user: userClient(other) }, f.brief))).toBe('recovery-brief-unavailable');
    expect((await row(f.brief)).status).toBe('skipped');
  });
});

describe('retry', () => {
  it('reopens a ready brief whose admission failed as pending owner-retry, only with a verified account', async () => {
    const f = await seed('retry-flow', { status: 'ready', code: 'brief-entry-changed' });
    expect(await refusal(retryDneskaiBrief(context(), f.brief))).toBe('account-unavailable');
    await db.query("insert into marketing_accounts(user_id,brand,platform,remote_account_id,handle,verified_at) values($1,'dneskai','instagram','synthetic-1','dneskai',now())", [owner]);
    try {
      expect(await retryDneskaiBrief(context(), f.brief)).toEqual({ id: f.brief, status: 'pending', code: 'owner-retry' });
      expect(await row(f.brief)).toMatchObject({ status: 'pending', code: 'owner-retry' });
      expect(await refusal(retryDneskaiBrief(context(), f.brief))).toBe('recovery-not-retryable');
    } finally { await db.query('delete from marketing_accounts where user_id=$1', [owner]); }
  });
  it('does not retry the account requirement itself', async () => {
    const f = await seed('retry-account', { status: 'ready', code: 'account-unavailable' });
    expect(await refusal(retryDneskaiBrief(context(), f.brief))).toBe('recovery-not-retryable');
  });
});

describe('release', () => {
  it('releases a lapsed brief’s reports only behind its switch', async () => {
    const f = await seed('release-flow');
    expect(await refusal(releaseDneskaiBrief(context({ ...ON, lapsedRelease: false }), f.brief))).toBe('recovery-release-unavailable');
    expect(await releaseDneskaiBrief(context(), f.brief)).toEqual({ id: f.brief, released: 1 });
    expect(await refusal(releaseDneskaiBrief(context(), f.brief))).toBe('recovery-nothing-to-release');
  });
  it('returns a held report to review only behind its switch and inside its window', async () => {
    const f = await seed('held-flow');
    expect(await refusal(releaseHeldDneskaiCandidate(context({ ...ON, heldRelease: false }), f.project, f.held.id))).toBe('recovery-held-release-unavailable');
    expect(await releaseHeldDneskaiCandidate(context(), f.project, f.held.id)).toEqual({ id: f.held.id, status: 'new' });
    expect(await refusal(releaseHeldDneskaiCandidate(context(), f.project, f.held.id))).toBe('recovery-not-held');
    const old = await seed('held-old', { heldAt: '2026-10-20T08:00:00Z' });
    expect(await refusal(releaseHeldDneskaiCandidate(context(), old.project, old.held.id))).toBe('recovery-held-outside-window');
    expect(await refusal(releaseHeldDneskaiCandidate({ ...context(), owner: other, user: userClient(other) }, f.project, f.held.id))).toBe('recovery-candidate-unavailable');
  });
});
