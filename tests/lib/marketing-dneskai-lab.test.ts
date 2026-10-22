import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: vi.fn(), limited: vi.fn(async () => ({ ok: true, retryAfter: 0 })), feedback: vi.fn(async () => false) }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.client() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.limited }));
vi.mock('@/lib/marketing/owner-feedback', () => ({ recordMarketingOwnerFeedback: mocks.feedback }));
import { POST as fitRoute } from '@/app/api/marketing/dneskai/fit/route';
import { POST as previewFitRoute } from '@/app/api/dev-preview/dneskai-fit/route';
import { POST as revisionsRoute } from '@/app/api/marketing/revisions/route';
import { fitDneskaiDeck } from '@/lib/marketing/dneskai-fit';
import {
  DNESKAI_KITS, DneskaiApproveManyInputSchema, DneskaiFitResultSchema, dneskaiDeckKit, dneskaiFitSlide, dneskaiLabDeadline, dneskaiLabKits, dneskaiLabOrder,
  dneskaiLabProfileCovers, dneskaiLabQueue, type DneskaiFitRequest,
} from '@/lib/marketing/dneskai-lab';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { pragueScheduledAt } from '@/lib/marketing/clock';
import { pragueDayAfter } from '@/lib/marketing/dneskai-workspace';

// The drafts read the clock (an expired time is replaced, the time window is checked): pin it to the fixture's day.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-22T10:00:00.000Z'));

const owner = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-22T10:00:00.000Z');
const read = () => createDneskaiWorkspaceFixture(now);
const request = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { Origin: 'https://own.example', 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const fitUrl = 'https://own.example/api/marketing/dneskai/fit';

describe('Design Lab read model', () => {
  it('builds today and tomorrow as slot-ordered queues and lists each approvable post with the hash it binds', () => {
    const fixture = read();
    const [today, tomorrow] = dneskaiLabQueue(fixture, now.getTime());
    expect(today!.date).toBe(fixture.today);
    expect(tomorrow!.date).toBe(pragueDayAfter(fixture.today, 1));
    expect(tomorrow!.posts.map((item) => item.deadline.time)).toEqual(['08:00', '12:30', '17:00']);
    expect(tomorrow!.jobs.map((item) => item.deadline?.time)).toEqual(['20:00']);
    // Post 1 and 2 are ready and in review; post 3's render was refused, so „approve the day“ leaves it out.
    expect(tomorrow!.approvable).toEqual(tomorrow!.posts.slice(0, 2).map((item) => ({ id: item.post.id, contentHash: item.post.contentHash })));
    expect(tomorrow!.posts[2]!.block).toBe('render-blocked');
    expect(tomorrow!.posts[0]!.revision.shortHash).toBe(tomorrow!.posts[0]!.post.contentHash.slice(0, 7));
    // Today's only post is the uncertain publication: nothing to approve.
    expect(today!.approvable).toEqual([]);
    expect(dneskaiLabOrder([today!, tomorrow!]).length).toBe(today!.posts.length + tomorrow!.posts.length);
  });

  it('lists five renderable kits per post; only the current kit has a cover, and no cover is ever invented for the others', () => {
    const post = read().posts[0]!;
    const kits = dneskaiLabKits(post);
    expect(kits.map((kit) => kit.id)).toEqual([...DNESKAI_KITS]);
    expect(kits.map((kit) => kit.key)).toEqual([1, 2, 3, 4, 5]);
    expect(kits[0]).toMatchObject({ id: 'editorial', current: true, renderable: true, cover: post.assets[0], fits: true });
    for (const kit of kits.slice(1)) expect(kit).toMatchObject({ current: false, renderable: true, cover: null, fits: null });
  });

  it('reads a v1 deck as the editorial kit and a deck that names its kit as that kit', () => {
    const deck = read().posts[0]!.deck!;
    expect(dneskaiDeckKit(deck)).toBe('editorial');
    expect(dneskaiDeckKit({ ...deck, kit: 'ticker' } as typeof deck)).toBe('ticker');
    expect(dneskaiDeckKit(null)).toBe('editorial');
  });

  it('counts the deadline in minutes and marks the last half hour as urgent and a passed slot as passed', () => {
    const at = pragueScheduledAt('2026-10-22', '12:30');
    expect(dneskaiLabDeadline(at, Date.parse(at) - 100 * 60_000)).toMatchObject({ time: '12:30', minutesLeft: 100, urgent: false, passed: false });
    expect(dneskaiLabDeadline(at, Date.parse(at) - 29 * 60_000)).toMatchObject({ urgent: true, passed: false });
    expect(dneskaiLabDeadline(at, Date.parse(at) + 60_000)).toMatchObject({ urgent: false, passed: true });
  });

  it('fills the profile grid with real covers of other published or scheduled posts only', () => {
    const fixture = read();
    const covers = dneskaiLabProfileCovers(fixture, fixture.posts[0]!.id);
    const allowed = fixture.posts.filter((post) => ['published', 'approved'].includes(post.status)).map((post) => post.assets[0]!.url);
    expect(covers.length).toBeGreaterThan(0);
    for (const cover of covers) expect(allowed).toContain(cover.url);
  });

  it('binds at most eight distinct posts in one „approve the day“', () => {
    const post = (n: number) => ({ id: `d0e5ca10-0000-4000-8000-${String(n).padStart(12, '0')}`, expectedHash: 'a'.repeat(64) });
    expect(DneskaiApproveManyInputSchema.safeParse({ action: 'approve-many', posts: [post(1), post(2)] }).success).toBe(true);
    expect(DneskaiApproveManyInputSchema.safeParse({ action: 'approve-many', posts: [post(1), post(1)] }).success).toBe(false);
    expect(DneskaiApproveManyInputSchema.safeParse({ action: 'approve-many', posts: Array.from({ length: 9 }, (_, n) => post(n + 1)) }).success).toBe(false);
    expect(DneskaiApproveManyInputSchema.safeParse({ action: 'approve-many', posts: [] }).success).toBe(false);
  });
});

describe('text fit before saving (studio fitter, no media, $0)', () => {
  const deck = () => read().posts[0]!.deck!;
  const fitRequest = (slides = deck().slides.map(dneskaiFitSlide)): DneskaiFitRequest => ({ kit: 'editorial', slides });

  it('says every field of a deck that renders fits, with its count and limit', async () => {
    const result = DneskaiFitResultSchema.parse(await fitDneskaiDeck(fitRequest()));
    // The preview deck is the written slides only (cover, figure, split, statement): no sources slide.
    expect(result.slides.map((slide) => slide.fits)).toEqual([true, true, true, true]);
    const cover = result.slides[0]!.fields.find((field) => field.field === 'headline')!;
    expect(cover).toMatchObject({ max: 110, overBy: 0, clipped: false, lines: null, fontSize: null, codes: [] });
    expect(cover.characters).toBe([...deck().slides[0]!.headline.trim()].length);
  });

  it('marks a headline the fitter would cut and by how many characters it is over', async () => {
    const slides = deck().slides.map(dneskaiFitSlide);
    slides[0] = { ...slides[0]!, headline: 'Proč se vyplatí verzovat prompty a ukládat ke každé změně krátkou poznámku, kdo ji udělal, kdy a proč, aby se dala vrátit zpátky' };
    const result = await fitDneskaiDeck(fitRequest(slides));
    const headline = result.slides[0]!.fields.find((field) => field.field === 'headline')!;
    expect(result.slides[0]!.fits).toBe(false);
    expect(headline.overBy).toBe(headline.characters - 110);
    expect(headline.overBy).toBeGreaterThan(0);
    expect(headline.clipped).toBe(true);
    expect(result.slides.slice(1).every((slide) => slide.fits)).toBe(true);
  });

  it('reports a character the face does not carry and text a slide type never draws', async () => {
    const slides = deck().slides.map(dneskaiFitSlide);
    slides[1] = { ...slides[1]!, headline: 'Graf ✦ ukazuje', kicker: 'NAVÍC' };
    const result = await fitDneskaiDeck(fitRequest(slides));
    const figure = result.slides[1]!;
    expect(figure.fits).toBe(false);
    expect(figure.fields.find((field) => field.field === 'headline')!.codes).toContain('unsupported-glyph');
    // A figure has no kicker layer: the problem is the slide's, because the kicker is not one of its fields.
    expect(figure.codes).toContain('text-unplaced');
  });

  it('fits the same deck in another kit, measured in that kit', async () => {
    const fitted = await fitDneskaiDeck({ ...fitRequest(), kit: 'bold' });
    expect(fitted.kit).toBe('bold');
    expect(fitted.slides.length).toBe(fitRequest().slides.length);
  });

  it('refuses a deck shape a save would refuse', async () => {
    await expect(fitDneskaiDeck(fitRequest([dneskaiFitSlide(deck().slides[0]!)]))).rejects.toMatchObject({ code: 'fit-input-invalid' });
  });
});

describe('POST /api/marketing/dneskai/fit', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.client.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: owner } } }) } }); });
  const body = () => ({ kit: 'editorial', slides: read().posts[0]!.deck!.slides.map(dneskaiFitSlide) });

  it('answers the fit for the signed-in owner, rate-limited per owner', async () => {
    const response = await fitRoute(request(fitUrl, body()));
    expect(response.status).toBe(200);
    expect(DneskaiFitResultSchema.parse(await response.json()).slides).toHaveLength(4);
    expect(mocks.limited).toHaveBeenCalledWith(owner, expect.objectContaining({ key: 'dneskai-fit' }));
  });

  it('refuses no session, a cross-origin post, a malformed body, a rate limit and an unknown kit with codes only', async () => {
    mocks.client.mockReturnValueOnce({ auth: { getUser: async () => ({ data: { user: null } }) } });
    expect((await fitRoute(request(fitUrl, body()))).status).toBe(401);
    const cross = new Request(fitUrl, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: JSON.stringify(body()) });
    expect((await fitRoute(cross)).status).toBe(403);
    expect((await fitRoute(request(fitUrl, '{"kit":'))).status).toBe(400);
    expect((await fitRoute(request(fitUrl, { ...body(), extra: true }))).status).toBe(400);
    mocks.limited.mockResolvedValueOnce({ ok: false, retryAfter: 12 });
    const limited = await fitRoute(request(fitUrl, body()));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('12');
    expect((await fitRoute(request(fitUrl, { ...body(), kit: 'clipping' }))).status).toBe(400);
    const bold = await fitRoute(request(fitUrl, { ...body(), kit: 'bold' }));
    expect(bold.status).toBe(200);
    expect((await bold.json()).kit).toBe('bold');
  });
});

describe('POST /api/dev-preview/dneskai-fit', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  const url = 'https://own.example/api/dev-preview/dneskai-fit';
  const body = () => ({ kit: 'editorial', slides: read().posts[1]!.deck!.slides.map(dneskaiFitSlide) });

  it('exists only outside production or in an explicit NEXT_E2E build', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_E2E', '');
    expect((await previewFitRoute(request(url, body()))).status).toBe(404);
    vi.stubEnv('NEXT_E2E', '1');
    const response = await previewFitRoute(request(url, body()));
    expect(response.status).toBe(200);
    expect(DneskaiFitResultSchema.parse(await response.json()).slides[0]!.fits).toBe(true);
  });
});

describe('POST /api/marketing/revisions approve-many', () => {
  const ids = ['44444444-4444-4444-8444-444444444441', '44444444-4444-4444-8444-444444444442', '44444444-4444-4444-8444-444444444443'];
  const publication = '88888888-8888-4888-8888-888888888888';
  function db(refuse: Record<string, string>) {
    const rpc = vi.fn(async (_name: string, args: { p_revision_id: string }) => refuse[args.p_revision_id] ? { data: null, error: { message: refuse[args.p_revision_id] } } : { data: publication, error: null });
    const from = () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { revision: { traceId: null }, content_hash: 'c'.repeat(64) }, error: null }) }; return query; };
    return { auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, from, rpc };
  }
  beforeEach(() => { vi.clearAllMocks(); });

  it('approves each post only against its own hash and reports a refusal per post without blocking the others', async () => {
    const client = db({ [ids[1]!]: 'revision changed' });
    mocks.client.mockReturnValue(client);
    const posts = ids.map((id, n) => ({ id, expectedHash: String(n).repeat(64) }));
    const response = await revisionsRoute(request('https://own.example/api/marketing/revisions', { action: 'approve-many', posts }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [
      { id: ids[0], ok: true, publicationId: publication, error: null },
      { id: ids[1], ok: false, publicationId: null, error: 'revision-changed' },
      { id: ids[2], ok: true, publicationId: publication, error: null },
    ] });
    expect(client.rpc.mock.calls.map(([name, args]) => [name, args])).toEqual(posts.map((post) => ['marketing_approve_revision', { p_revision_id: post.id, p_expected_hash: post.expectedHash }]));
    expect(mocks.feedback).toHaveBeenCalledTimes(2);
  });

  it('refuses a batch without hashes or with a repeated post', async () => {
    mocks.client.mockReturnValue(db({}));
    expect((await revisionsRoute(request('https://own.example/api/marketing/revisions', { action: 'approve-many', posts: [{ id: ids[0] }] }))).status).toBe(400);
    expect((await revisionsRoute(request('https://own.example/api/marketing/revisions', { action: 'approve-many', posts: [{ id: ids[0], expectedHash: 'a'.repeat(64) }, { id: ids[0], expectedHash: 'a'.repeat(64) }] }))).status).toBe(400);
  });
});
