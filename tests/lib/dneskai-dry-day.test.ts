import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';

/**
 * One DNESKAi day end to end on the real code (epic #110, before the live pilot #123). The database is a fresh
 * install: schema.sql plus every migration in order on PGlite, reached only through the real supabase-js client
 * and an in-process PostgREST/Storage emulator. Every external provider is a local fake: publisher feeds and
 * pages, image hosts, Apify, TypeSafe Jev, the Anthropic Messages API (behind the real ChatAnthropic) and the
 * Instagram Graph API. The modules under test run unchanged: the scheduler with its real ports, collection,
 * media, events, briefs, generation, the vendored studio renderer, the revisions route (approve and deck
 * edit), publishing and reconciliation. Nothing reaches a network and nothing is paid.
 */
const shared = vi.hoisted(() => ({ fetch: null as null | ((input: string | URL | Request, init?: RequestInit) => Promise<Response>), owner: null as unknown }));
vi.mock('server-only', () => ({}));
// Production reads feeds and pictures through a pinned TLS connection to the resolved address; here the same
// safeFetch checks run (host allowlist, DNS answer, redirects, content type, size) and the bytes come from the fake network.
vi.mock('@/lib/marketing/free-feeds/security/pinned-fetch', () => ({ pinnedSourceFetch: (input: string | URL | Request, init?: RequestInit) => shared.fetch!(String(input), init) }));
vi.mock('node:dns/promises', () => ({ default: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }, lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));
// The owner's cookie session: the real supabase-js client with the owner's token, so RLS decides what it sees.
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => shared.owner }));

import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { FakeAnthropic, FakeApify, FakeGraph, FakeInternet, FakeJev, NOISE, PICTURES, STORIES, routePublishers, sha256, type Picture } from '../helpers/dneskai-dry-day-world';
import { runMarketingTick, type MarketingTickResult } from '@/lib/marketing/scheduler';
import { createMarketingSchedulerPorts } from '@/lib/marketing/scheduler-ports';
import { verifyInstagramAccount } from '@/lib/marketing/meta-account';
import { revisionContentHash } from '@/lib/marketing/hashes';
import { parseContentRevision, type ContentRevision } from '@/lib/marketing/contracts';
import { DneskaiBriefSchema, type DneskaiBrief } from '@/lib/marketing/dneskai-brief';
import { DNESKAI_RENDERER_VERSION } from '@/lib/marketing/dneskai-render';
import { POST as revisionsPOST } from '@/app/api/marketing/revisions/route';

const OWNER = '7a1c0b52-3f5e-4c11-9b8e-2d4f6a8c0e11';
const PROJECT = '4b2e9d10-8c3a-4f6e-a1b5-c7d9e0f21a34';
const SUPABASE = 'https://dryday-fixture.supabase.co';
const SERVICE_KEY = 'service-role-TEST-ONLY';
const ANON_KEY = 'anon-TEST-ONLY';
const OWNER_SESSION = 'owner-session-TEST-ONLY';
const IG_USER = '17841400000000001';
const IG_TOKEN = 'IGAAfixtureTEST-ONLY-long-lived-token-0001';
const OUT = '/tmp/claude-0/-home-user/ded5c14c-b66e-5228-83f0-9b51d30cae38/scratchpad/wave4/dry-day';
const ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, MARKETING_OWNER_ID: OWNER,
  MARKETING_DNESKAI_COLLECTION_ENABLED: 'true', MARKETING_DNESKAI_PAID_ENABLED: 'true', MARKETING_AI_CONSENT: 'true', MARKETING_DNESKAI_FEED_PROVIDER: 'native',
  MARKETING_DNESKAI_DAILY_GENERATION_USD: '1.00',
  APIFY_TOKEN: 'apify_api_TEST_ONLY', MARKETING_DNESKAI_APIFY_ACTOR_ID: 'shu8hvrXbJbY3Eb9W', MARKETING_DNESKAI_APIFY_BUILD: '0.0.517',
  TYPESAFE_API_KEY: 'typesafe-TEST-ONLY', ANTHROPIC_API_KEY: 'sk-ant-TEST-ONLY',
  MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: IG_TOKEN, MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: '2026-12-20T00:00:00.000Z',
  MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: 'instagram_business_basic,instagram_business_content_publish', MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'instagram',
  MARKETING_DNESKAI_INSTAGRAM_API_VERSION: 'v24.0', MARKETING_DNESKAI_INSTAGRAM_API_VERSION_VERIFIED_AT: '2026-10-01T00:00:00.000Z',
  MARKETING_APPROVED_ASSET_HOSTS: new URL(SUPABASE).hostname, MARKETING_PUBLISH_ENABLED: 'false', MARKETING_DNESKAI_PUBLISH_ENABLED: 'false',
  LANGSMITH_TRACING: 'false', LANGCHAIN_TRACING_V2: 'false', LANGCHAIN_TRACING: 'false', LANGCHAIN_VERBOSE: 'false', ANTHROPIC_BASE_URL: '', ANTHROPIC_API_URL: '', ANTHROPIC_AUTH_TOKEN: '',
};

let db: PGlite;
let emulator: SupabaseEmulator;
let admin: SupabaseClient;
const clock = () => new Date();
const internet = new FakeInternet(clock);
const apify = new FakeApify(clock, ENV.MARKETING_DNESKAI_APIFY_ACTOR_ID!, ENV.MARKETING_DNESKAI_APIFY_BUILD!);
const jev = new FakeJev();
const anthropic = new FakeAnthropic(/shared memory/i);
const graph = new FakeGraph(clock, internet, IG_TOKEN, IG_USER, '9900000000000001', 'dneskai');
const ticks: Array<{ at: string; result: MarketingTickResult; ms: number }> = [];
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => emulator.sql<T>(text, params);
const env = () => ({ ...process.env }) as Record<string, string | undefined>;
const count = async (text: string, params: unknown[] = [OWNER]) => (await sql<{ n: number }>(text, params))[0]!.n;

async function tick(kind: 'minute' | 'daily' = 'minute') {
  const started = performance.now();
  const result = await runMarketingTick({ owner: OWNER, env: env(), ports: createMarketingSchedulerPorts(admin as never, OWNER, env()) }, { tick: randomUUID(), kind });
  ticks.push({ at: new Date().toISOString(), result, ms: Math.round(performance.now() - started) });
  expect(result.errors).toEqual([]);
  return result;
}
const step = (result: MarketingTickResult, category: string) => result.did.find((entry) => entry.category === category);
type RevisionRow = { id: string; status: string; ready: boolean; content_hash: string; approved_hash: string | null; replaces_id: string | null; revision: ContentRevision; render_report: unknown };
const revisionRows = () => sql<RevisionRow>("select id,status,ready,content_hash,approved_hash,replaces_id,revision,render_report from public.marketing_revisions where user_id=$1 and brand='dneskai' order by revision->>'scheduledAt',created_at", [OWNER]);
type BriefRow = { id: string; status: string; rank: number; scheduled_at: string; job_id: string | null; member_ids: string[]; brief: DneskaiBrief };
const briefRows = () => sql<BriefRow>('select id,status,rank,scheduled_at::text as scheduled_at,job_id,member_ids,brief from public.marketing_dneskai_briefs where user_id=$1 order by rank', [OWNER]);
const snapshot = async () => ({
  briefs: await count('select count(*)::int n from public.marketing_dneskai_briefs where user_id=$1'),
  jobs: await count('select count(*)::int n from public.marketing_jobs where user_id=$1'),
  revisions: await count('select count(*)::int n from public.marketing_revisions where user_id=$1'),
  publications: await count('select count(*)::int n from public.marketing_publications where user_id=$1'),
  candidates: await count('select count(*)::int n from public.marketing_dneskai_candidates where user_id=$1'),
  mediaAssets: await count('select count(*)::int n from public.marketing_media_assets where user_id=$1'),
  objects: await count('select count(*)::int n from storage.objects where $1::text is not null'),
  imageDownloads: internet.count((call) => ['cdn.sanity.io', 'scontent-prg1-1.cdninstagram.com'].includes(call.host) || (call.host === 'techcrunch.com' && call.url.includes('/wp-content/'))),
  feedReads: internet.count((call) => !['api.apify.com', 'api.typesafe.ai', 'api.anthropic.com', 'graph.instagram.com', new URL(SUPABASE).hostname].includes(call.host)),
  apify: internet.count((call) => call.host === 'api.apify.com'), jev: jev.requests.length, anthropic: anthropic.requests.length,
  assetUploads: emulator.requests.filter((request) => request.method === 'POST' && request.path.startsWith('/storage/v1/object/marketing-assets/')).length,
});
async function assetBytes(url: string) {
  const response = await internet.fetch(url);
  expect(response.status).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}
function ownerRequest(body: unknown) {
  return revisionsPOST(new Request('https://own-dashboard.example.test/api/marketing/revisions', { method: 'POST', headers: { Origin: 'https://own-dashboard.example.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}
const saved: Array<{ name: string; bytes: Buffer }> = [];

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-10-26T20:30:00.000Z');
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
  db = await createMigratedDatabase({ owner: OWNER, instant: new Date() });
  emulator = new SupabaseEmulator(db, SUPABASE, { service: SERVICE_KEY, users: { [OWNER]: OWNER_SESSION } }, clock);
  internet.route(new URL(SUPABASE).hostname, (request) => emulator.fetch(request));
  internet.route('api.apify.com', apify.handler).route('api.typesafe.ai', jev.handler).route('api.anthropic.com', anthropic.handler).route('graph.instagram.com', graph.handler);
  await routePublishers(internet);
  shared.fetch = internet.fetch;
  vi.stubGlobal('fetch', internet.fetch);
  admin = createClient(SUPABASE, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = createClient(SUPABASE, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${OWNER_SESSION}` } } });
  owner.auth.getUser = (async () => ({ data: { user: { id: OWNER } }, error: null })) as never;
  shared.owner = owner;
  mkdirSync(OUT, { recursive: true });
}, 120_000);
afterAll(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await db?.close(); });

describe('one DNESKAi day on the real modules with fake providers (#110)', () => {
  let morning: RevisionRow; let noon: RevisionRow; let edited: RevisionRow;

  it('seeds the owner, the DNESKAi project and a verified Instagram account with its stored token (#121)', async () => {
    await sql("insert into public.projects(id,user_id,name,slug,repo_full_name,portfolio_key) values($1,$2,'DNESKAi','aifirst','lukaskourilcz/aifirst','aifirst')", [PROJECT, OWNER]);
    const verified = await verifyInstagramAccount(admin as never, OWNER, 'dneskai');
    expect(verified).toMatchObject({ handle: 'dneskai', accountType: 'MEDIA_CREATOR', enabled: false, tokenStored: true });
    // Verification never enables an account and no owner action does it yet: the pilot sets it once in SQL.
    await sql('update public.marketing_accounts set enabled=true where id=$1', [verified.accountId]);
    expect(await count('select count(*)::int n from public.marketing_account_tokens where user_id=$1')).toBe(1);
  });

  it('runs the night: 22:00 Prague admission, collection, media, briefs and generation until nothing is pending', async () => {
    at('2026-10-26T20:40:00.000Z');
    expect(step(await tick(), 'collection')).toMatchObject({ status: 'noop', code: 'collection-not-due' });
    let time = Date.parse('2026-10-26T21:00:30.000Z');
    for (let index = 0; index < 48; index++) {
      at(new Date(time).toISOString());
      const result = await tick();
      if (await count("select count(*)::int n from public.marketing_revisions where user_id=$1 and brand='dneskai'") >= 2 && !result.next.pending.length) break;
      time += 5 * 60_000;
    }
    expect(internet.unknown).toEqual([]);
    const admission = ticks.find((entry) => step(entry.result, 'collection')?.detail?.admitted === true)!;
    expect(admission.at).toBe('2026-10-26T21:00:30.000Z');

    // Collection: one run for 26 October, every due source read, four paid Instagram reads and two Jev batches.
    const [run] = await sql<{ status: string; error_code: string | null; selected_count: number; cost_usd: string; date: string; target_date: string }>(
      'select status,error_code,selected_count,cost_usd::text,date::text,target_date::text from public.marketing_dneskai_runs where user_id=$1', [OWNER]);
    expect(run).toMatchObject({ status: 'complete', error_code: null, selected_count: 2, date: '2026-10-26', target_date: '2026-10-27' });
    expect([...apify.runs.values()].map((entry) => entry.profile).sort()).toEqual(['insidertech', 'meta.ai', 'mosseri', 'technology']);
    expect(jev.requests.map((request) => request.items.length)).toEqual([8, 1]);
    const jevUsd = jev.requests.reduce((sum, request) => sum + (2900 + request.items.length * 40) * 0.042 / 1e6, 0);
    expect(Number(run!.cost_usd)).toBeCloseTo(4 * 0.0081 + jevUsd, 8);
    const candidates = await sql<{ status: string; url: string; duplicate_of: string | null; reason: string | null }>(
      "select status,candidate->>'url' as url,candidate->>'duplicateOf' as duplicate_of,candidate->>'reason' as reason from public.marketing_dneskai_candidates where user_id=$1", [OWNER]);
    const byUrl = new Map(candidates.map((row) => [row.url, row]));
    expect(byUrl.get(STORIES.b.url)?.status).toBe('selected');
    expect(byUrl.get(STORIES.a1.url)?.status).toBe('selected');
    expect(byUrl.get(STORIES.a2.url)?.status).toBe('selected');
    expect([byUrl.get(STORIES.a1.url)?.duplicate_of, byUrl.get(STORIES.a2.url)?.duplicate_of].filter(Boolean)).toHaveLength(1);
    for (const noise of NOISE) expect(byUrl.get(noise.url)).toMatchObject({ status: 'rejected', reason: 'collection-editorial-out-of-scope' });
    expect(candidates).toHaveLength(3 + NOISE.length + 1);

    // Two events, two briefs with evidence and media in original order, two jobs queued and executed.
    const briefs = await briefRows();
    expect(briefs.map((row) => ({ status: row.status, rank: row.rank, slot: row.scheduled_at }))).toEqual([
      { status: 'queued', rank: 1, slot: '2026-10-27 07:00:00+00' }, { status: 'queued', rank: 2, slot: '2026-10-27 11:30:00+00' }]);
    const [translation, memory] = briefs.map((row) => DneskaiBriefSchema.parse(row.brief));
    expect(translation!.evidence.map((item) => item.url)).toEqual([STORIES.b.url]);
    expect(memory!.evidence.map((item) => item.url)).toEqual([STORIES.a1.url, STORIES.a2.url]);
    const pictureBytes = new Map((Object.values(PICTURES) as Picture[]).map((picture) => [sha256(picture.bytes!), picture.label]));
    expect(translation!.media.map((item) => [pictureBytes.get(item.assetSha256), item.position, item.credit])).toEqual([
      ['B child 1 1080x1350', 0, 'Foto: @meta.ai'], ['B child 2 1080x1350', 1, 'Foto: @meta.ai'], ['B child 3 1600x900', 2, 'Foto: @meta.ai']]);
    expect(memory!.media.map((item) => [pictureBytes.get(item.assetSha256), item.position, item.credit])).toEqual([
      ['A1 og:image 1600x900', 0, 'Obrázek: Anthropic'], ['A1 figure 1080x1350', 1, 'Obrázek: Anthropic'], ['A2 og:image 1600x900', 0, 'Obrázek: TechCrunch'], ['A2 figure 1080x1350', 1, 'Obrázek: TechCrunch']]);
    const jobs = await sql<{ id: string; status: string; error_code: string | null; template: string }>("select id,status,error_code,request->'generation'->>'templateVersion' as template from public.marketing_jobs where user_id=$1", [OWNER]);
    expect(jobs.map((job) => job.status)).toEqual(['review', 'review']);
    expect(new Set(jobs.map((job) => job.id))).toEqual(new Set(briefs.map((row) => row.job_id)));
    expect(jobs.every((job) => job.template === DNESKAI_RENDERER_VERSION)).toBe(true);
    // Both jobs were queued by the briefs step, then executed one per tick by the generation step.
    expect(ticks.filter((entry) => step(entry.result, 'briefs')?.status === 'done').map((entry) => step(entry.result, 'briefs')!.detail)).toEqual([
      { runId: expect.any(String), created: 2, jobs: 2, skipped: 0 }]);
    const generated = ticks.filter((entry) => step(entry.result, 'generation')?.status === 'done').map((entry) => step(entry.result, 'generation')!.detail);
    expect(generated.map((detail) => [detail?.claimed, detail?.jobStatus])).toEqual([[true, 'review'], [true, 'review']]);
    // The memory brief's first answer drew a bullet the body face cannot carry: the renderer's glyph gate refused it
    // and the second call got the problem as an instruction naming the slide, the field and the code point.
    expect(anthropic.requests).toHaveLength(3);
    expect(anthropic.requests.every((request) => request.model === 'claude-sonnet-5-5' && JSON.stringify(request.outputConfig).includes('json_schema'))).toBe(true);
    const retry = anthropic.requests.find((request) => request.prompt.includes('Your previous answer could not be used'))!;
    expect(retry.prompt).toMatch(/- Slide 2 \(split with picture [a-f0-9]{12}…\), body \[unsupported-glyph\]: The body uses characters the typeface cannot draw; use plain Czech letters and punctuation \(U\+2022\)\./);
    // No prompt carries a URL: code writes the source lines.
    expect(anthropic.requests.some((request) => /https?:\/\//.test(request.prompt))).toBe(false);

    // Two revisions marketing-content/2, ready, decks drawn only from their briefs' pools, real 1080x1350 JPEGs.
    const revisions = await revisionRows();
    expect(revisions).toHaveLength(2);
    [morning, noon] = revisions as [RevisionRow, RevisionRow];
    for (const [row, brief] of [[morning, translation!], [noon, memory!]] as const) {
      const revision = parseContentRevision(row.revision);
      expect(row).toMatchObject({ status: 'review', ready: true });
      expect(revision.schemaVersion).toBe('marketing-content/2');
      expect(row.content_hash).toBe(revisionContentHash(revision));
      expect(revision.sources[0]).toMatchObject({ sourceId: brief.eventId, sourceRevision: brief.memberHash });
      const pool = new Set(brief.media.map((item) => item.assetSha256));
      expect(revision.deck!.slides.flatMap((slide) => slide.images.map((image) => image.assetSha256)).every((hash) => pool.has(hash))).toBe(true);
      expect(revision.assets).toHaveLength(revision.deck!.slides.length);
      for (const [index, asset] of revision.assets.entries()) {
        const bytes = await assetBytes(asset.url);
        expect(sha256(bytes)).toBe(asset.sha256);
        const meta = await sharp(bytes).metadata();
        expect({ format: meta.format, width: meta.width, height: meta.height, asset: [asset.width, asset.height, asset.mimeType] }).toEqual({ format: 'jpeg', width: 1080, height: 1350, asset: [1080, 1350, 'image/jpeg'] });
        saved.push({ name: `${row === morning ? 'morning' : 'noon'}-${index + 1}-${revision.deck!.slides[index]!.type}.jpg`, bytes });
      }
    }

    // Cost: both calls reserved under the 1.00 USD ceiling, and what they cost is what the jobs recorded.
    const [{ spent }] = await sql<{ spent: string }>('select public.marketing_dneskai_generation_spent($1)::text as spent', [OWNER]);
    const recorded = await sql<{ usd: string }>("select result->'usage'->>'estimatedCostUsd' as usd from public.marketing_jobs where user_id=$1", [OWNER]);
    expect(Number(spent)).toBeCloseTo(recorded.reduce((sum, row) => sum + Number(row.usd), 0), 6);
    expect(Number(spent)).toBeGreaterThan(0);
    expect(Number(spent)).toBeLessThan(1);
    expect(await sql('select reserved_usd::text,calls from marketing_private.dneskai_generation_spend where user_id=$1 order by calls', [OWNER])).toEqual([{ reserved_usd: '0.2500', calls: 1 }, { reserved_usd: '0.2500', calls: 2 }]);
    // Every tick is recorded once with what it did.
    const recordedTicks = await sql<{ kind: string; did: unknown[]; finished_at: string | null }>('select kind,did,finished_at::text from public.marketing_ticks where user_id=$1', [OWNER]);
    expect(recordedTicks).toHaveLength(ticks.length);
    expect(recordedTicks.every((row) => row.kind === 'minute' && Array.isArray(row.did) && row.did.length === 7 && row.finished_at)).toBe(true);
  }, 600_000);

  it('a second pass of ticks and the daily duties change nothing: no new briefs, jobs, renders or downloads', async () => {
    const before = await snapshot();
    let time = Date.parse(ticks.at(-1)!.at) + 5 * 60_000;
    for (let index = 0; index < 6; index++) {
      at(new Date(time).toISOString());
      const result = await tick();
      expect(result.did.filter((entry) => entry.status === 'done')).toEqual([]);
      time += 5 * 60_000;
    }
    at('2026-10-27T01:18:00.000Z');
    const daily = await tick('daily');
    expect(daily.did.map((entry) => [entry.category, entry.status])).toEqual([['renewal', 'noop'], ['purge', 'noop'], ['retention', 'noop']]);
    expect(await snapshot()).toEqual(before);
  }, 300_000);

  it('the owner approves the morning post with its hash and edits the noon post through POST /api/marketing/revisions', async () => {
    at('2026-10-27T05:30:00.000Z');
    const approved = await ownerRequest({ action: 'approve', id: morning.id, expectedHash: morning.content_hash });
    expect(approved.status).toBe(200);
    const { publicationId } = await approved.json() as { publicationId: string };
    expect(await sql('select status,scheduled_at::text from public.marketing_publications where id=$1', [publicationId])).toEqual([{ status: 'queued', scheduled_at: '2026-10-27 07:00:00+00' }]);

    const before = await snapshot();
    const deck = noon.revision.deck!;
    const spare = (await briefRows())[1]!.brief.media.find((item) => !deck.slides.some((slide) => slide.images.some((image) => image.assetSha256 === item.assetSha256)))!;
    expect(spare.credit).toBe(deck.slides[2]!.credit);
    // The pilot's owner edit (#123 step 4): one slide's text, one picture swapped, a focal point moved and a new time.
    const response = await ownerRequest({
      action: 'edit', id: noon.id, caption: noon.revision.caption, scheduledAt: '2026-10-27T11:40:00.000Z',
      deck: { slides: [
        { from: 0, images: [{ slot: 'image-1', assetSha256: deck.slides[0]!.images[0]!.assetSha256, crop: { focal: { x: 0.3, y: 0.45 } } }] },
        { from: 1, headline: 'Paměť projektu teď vidí a upravuje celý tým' },
        { from: 2, images: [{ slot: 'image-1', assetSha256: spare.assetSha256 }] },
        { from: 3 }, { from: 4 },
      ] },
    });
    const body = await response.json() as { id: string; ready: boolean; contentHash: string; render: { status: string; problems: unknown[] } };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ready: true, render: { status: 'rendered' } });
    // The new focal point draws less of the 1600 x 900 cover: an advisory, never a hold.
    expect(body.render.problems).toEqual([expect.objectContaining({ slide: 0, code: 'image-upscaled', blocking: false })]);
    const rows = await revisionRows();
    edited = rows.find((row) => row.id === body.id)!;
    expect(edited).toMatchObject({ replaces_id: noon.id, status: 'review', ready: true, content_hash: body.contentHash });
    expect(edited.revision.scheduledAt).toBe('2026-10-27T11:40:00.000Z');
    expect(rows.find((row) => row.id === noon.id)!.status).toBe('superseded');
    expect(body.contentHash).not.toBe(noon.content_hash);
    // Only the three changed slides were rendered; the statement and the sources slide came from the render cache.
    const after = await snapshot();
    expect(after.assetUploads - before.assetUploads).toBe(3);
    expect(edited.revision.assets.map((asset, index) => asset.sha256 === noon.revision.assets[index]!.sha256)).toEqual([false, false, false, true, true]);
    expect(after.imageDownloads).toBe(before.imageDownloads);
    for (const [index, asset] of edited.revision.assets.entries()) {
      const bytes = await assetBytes(asset.url);
      expect(sha256(bytes)).toBe(asset.sha256);
      saved.push({ name: `noon-edited-${index + 1}-${edited.revision.deck!.slides[index]!.type}.jpg`, bytes });
    }

    const stale = await ownerRequest({ action: 'approve', id: noon.id, expectedHash: noon.content_hash });
    expect(stale.status).toBe(409);
    const fresh = await ownerRequest({ action: 'approve', id: edited.id, expectedHash: edited.content_hash });
    expect(fresh.status).toBe(200);
    expect(await sql("select scheduled_at::text from public.marketing_publications where user_id=$1 and status='queued' order by scheduled_at", [OWNER])).toEqual([
      { scheduled_at: '2026-10-27 07:00:00+00' }, { scheduled_at: '2026-10-27 11:40:00+00' }]);
  }, 300_000);

  it('publishes at the slot: a dry run while the switches are off, then live through the Graph API', async () => {
    at('2026-10-27T07:00:30.000Z');
    const dry = await tick();
    // A plain dry run keeps the enablement switches as gates (#121), so with both off it reports the hold, writes nothing and sends nothing.
    expect(step(dry, 'publishing')).toMatchObject({ status: 'done', detail: { dryRun: true, outcomes: 1, held: 1, dryRuns: 0, published: 0 } });
    expect(graph.containers.size).toBe(0);
    expect(await count("select count(*)::int n from public.marketing_publications where user_id=$1 and status='queued'")).toBe(2);

    vi.stubEnv('MARKETING_PUBLISH_ENABLED', 'true'); vi.stubEnv('MARKETING_DNESKAI_PUBLISH_ENABLED', 'true');
    at('2026-10-27T07:01:30.000Z');
    const live = await tick();
    expect(step(live, 'publishing')).toMatchObject({ status: 'done', detail: { dryRun: false, outcomes: 1, published: 1 } });
    const [published] = await sql<{ status: string; remote_media_id: string; remote_url: string; error_code: string | null }>(
      "select p.status,p.remote_media_id,p.remote_url,p.error_code from public.marketing_publications p where p.revision_id=$1", [morning.id]);
    expect(published).toMatchObject({ status: 'published', error_code: null, remote_media_id: graph.media[0]!.id, remote_url: graph.media[0]!.permalink });
    expect(graph.fetchedImages).toHaveLength(5);
    expect(graph.fetchedImages.every((image) => image.format === 'jpeg' && image.width === 1080 && image.height === 1350)).toBe(true);
    // The bytes Meta fetched are the approved ones: the approval binds content_hash, which binds every asset sha256.
    const [approvedRow] = await sql<{ approved_hash: string; content_hash: string; status: string }>('select approved_hash,content_hash,status from public.marketing_revisions where id=$1', [morning.id]);
    expect(approvedRow).toEqual({ approved_hash: morning.content_hash, content_hash: morning.content_hash, status: 'published' });
    expect(graph.fetchedImages.map((image) => image.sha256)).toEqual(morning.revision.assets.map((asset) => asset.sha256));
    const carousel = [...graph.containers.values()].find((container) => container.children)!;
    expect(carousel.children).toHaveLength(5);
    expect(carousel.caption).toBe(morning.revision.caption);
    expect([...graph.containers.values()].filter((container) => container.alt).map((container) => container.alt)).toEqual(morning.revision.assets.map((asset) => asset.alt));
  }, 300_000);

  it('a publish whose media_publish times out ends in reconciliation and is matched from the media list, never published twice', async () => {
    graph.hangNextPublish = true;
    at('2026-10-27T11:40:30.000Z');
    const result = await tick();
    expect(step(result, 'publishing')).toMatchObject({ status: 'done', detail: { dryRun: false, outcomes: 1, reconciliation: 1 } });
    const publishCalls = () => internet.calls.filter((call) => call.host === 'graph.instagram.com' && call.method === 'POST' && call.url.endsWith('/media_publish'));
    expect(publishCalls()).toHaveLength(2);
    const container = [...graph.hangOnPublish][0]!;
    let [row] = await sql<{ status: string; remote_media_id: string | null; remote_url: string | null; error_code: string | null; remote_container_id: string }>(
      'select status,remote_media_id,remote_url,error_code,remote_container_id from public.marketing_publications where revision_id=$1', [edited.id]);
    if (row!.status !== 'published') {
      // The reconciliation category reads it again on a later tick, GET requests only.
      at('2026-10-27T12:15:30.000Z');
      await tick();
      [row] = await sql('select status,remote_media_id,remote_url,error_code,remote_container_id from public.marketing_publications where revision_id=$1', [edited.id]);
    }
    const remote = graph.media.find((item) => graph.containers.get(container)?.mediaId === item.id)!;
    expect(row).toMatchObject({ status: 'published', remote_container_id: container, remote_media_id: remote.id, remote_url: remote.permalink, error_code: null });
    expect(publishCalls()).toHaveLength(2);
    expect(publishCalls().filter((call) => new URLSearchParams(call.body).get('creation_id') === container)).toHaveLength(1);
    expect(internet.unknown).toEqual([]);
  }, 300_000);

  it('the next night, a follow-up report that reuses a published picture is a repeat: its brief is skipped and nothing is generated', async () => {
    const before = await snapshot();
    let time = Date.parse('2026-10-27T21:00:30.000Z');
    for (let index = 0; index < 24; index++) {
      at(new Date(time).toISOString());
      const result = await tick();
      const [run] = await sql<{ status: string }>("select status from public.marketing_dneskai_runs where user_id=$1 and date='2026-10-27'", [OWNER]);
      if (run && run.status !== 'running' && !result.next.pending.length) break;
      time += 5 * 60_000;
    }
    expect(internet.unknown).toEqual([]);
    const [run] = await sql<{ status: string; selected_count: number }>("select status,selected_count from public.marketing_dneskai_runs where user_id=$1 and date='2026-10-27'", [OWNER]);
    expect(run!.selected_count).toBe(1);
    expect([...apify.runs.values()].map((entry) => entry.profile).slice(4).sort()).toEqual(['activeprogrammer', 'meta.ai', 'mosseri', 'tiffintech']);
    const [followUp] = await sql<{ status: string; reason: string | null; duplicate_of: string | null }>(
      "select status,candidate->>'reason' as reason,candidate->>'duplicateOf' as duplicate_of from public.marketing_dneskai_candidates where user_id=$1 and candidate->>'url'=$2", [OWNER, STORIES.a3.url]);
    expect(followUp).toMatchObject({ status: 'duplicate', reason: 'collection-already-covered' });
    const briefs = await sql<{ status: string; code: string | null; job_id: string | null }>("select status,code,job_id from public.marketing_dneskai_briefs where user_id=$1 and target_date='2026-10-28'", [OWNER]);
    expect(briefs).toEqual([{ status: 'skipped', code: 'collection-already-covered', job_id: null }]);
    const after = await snapshot();
    expect({ jobs: after.jobs, revisions: after.revisions, anthropic: after.anthropic, assetUploads: after.assetUploads, mediaAssets: after.mediaAssets })
      .toEqual({ jobs: before.jobs, revisions: before.revisions, anthropic: before.anthropic, assetUploads: before.assetUploads, mediaAssets: before.mediaAssets });
  }, 300_000);

  it('refreshes the stored Instagram token once fewer than ten days remain, and the next Graph call uses the new token (#121)', async () => {
    at('2026-12-12T08:00:00.000Z');
    const before = await sql<{ refreshed_at: string }>('select refreshed_at::text from public.marketing_account_tokens where user_id=$1', [OWNER]);
    const result = await tick();
    expect(step(result, 'token')).toMatchObject({ status: 'done' });
    expect(Date.parse(String(step(result, 'token')!.detail!.expiresAt))).toBe(Date.parse('2027-02-10T08:00:00Z'));
    expect(graph.refreshes).toBe(1);
    const after = await sql<{ refreshed_at: string; expires_at: string }>('select refreshed_at::text,expires_at::text from public.marketing_account_tokens where user_id=$1', [OWNER]);
    expect(after).toEqual([{ refreshed_at: '2026-12-12 08:00:00+00', expires_at: '2027-02-10 08:00:00+00' }]);
    expect(after[0]!.refreshed_at).not.toBe(before[0]!.refreshed_at);
    // The bootstrap value in the environment is now stale; the stored token is the one Meta accepts.
    expect(await verifyInstagramAccount(admin as never, OWNER, 'dneskai')).toMatchObject({ handle: 'dneskai', enabled: true });
    at('2026-12-12T08:05:00.000Z');
    expect(step(await tick(), 'token')).toMatchObject({ status: 'noop' });
    expect(graph.refreshes).toBe(1);
  }, 120_000);

  it('saves the rendered slides and a contact sheet for visual review', async () => {
    for (const file of saved) writeFileSync(`${OUT}/${file.name}`, file.bytes);
    const rows = [saved.filter((file) => file.name.startsWith('morning-')), saved.filter((file) => file.name.startsWith('noon-') && !file.name.startsWith('noon-edited')), saved.filter((file) => file.name.startsWith('noon-edited'))];
    const width = 324, height = 405, gap = 12;
    const tiles = await Promise.all(rows.flatMap((row, y) => row.map(async (file, x) => ({ input: await sharp(file.bytes).resize(width, height).toBuffer(), left: gap + x * (width + gap), top: gap + y * (height + gap) }))));
    const sheet = await sharp({ create: { width: gap + 5 * (width + gap), height: gap + rows.length * (height + gap), channels: 3, background: '#d9d9d9' } }).composite(tiles).jpeg({ quality: 90 }).toBuffer();
    writeFileSync(`${OUT}/contact-sheet.jpg`, sheet);
    writeFileSync(`${OUT}/ticks.json`, JSON.stringify(ticks.map((entry) => ({ at: entry.at, ms: entry.ms, did: entry.result.did.map((item) => ({ category: item.category, status: item.status, code: item.code, detail: item.detail })) })), null, 1));
    expect(saved).toHaveLength(15);
  });
});
