import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  client: vi.fn(), limited: vi.fn(async () => ({ ok: true, retryAfter: 0 })), admin: vi.fn(), loadMedia: vi.fn(), list: vi.fn(), pool: vi.fn(), render: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.client() }));
// The admin client is a trap: the preview may load media through the wiring but never touch storage or tables.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => new Proxy({}, { get: (_target, key) => { mocks.admin(key); throw new Error(`admin.${String(key)} used`); } }) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.limited }));
vi.mock('@/lib/marketing/dneskai-wiring', () => ({
  getDneskaiMediaLoader: () => mocks.loadMedia, getBriefAssetHashLister: () => mocks.list, getBriefPoolLoader: () => mocks.pool, getRenderDneskaiDeck: () => mocks.render(),
}));
import { POST as previewRoute } from '@/app/api/marketing/dneskai/preview/route';
import { POST as fixturePreviewRoute } from '@/app/api/dev-preview/dneskai-preview/route';
import { clearDneskaiPreviewCache, DNESKAI_PREVIEW_IMAGE, previewDneskaiSlide } from '@/lib/marketing/dneskai-render';
import { DneskaiPreviewResultSchema } from '@/lib/marketing/dneskai-lab';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { demoDneskaiWorkspaceApi, resetDemoDneskaiWorkspace } from '@/lib/demo/dneskai-workspace-demo';
import { createDeckDraft, dneskaiEditRequest, insertablePictures, insertSlide, setSlideText } from '@/lib/marketing/dneskai-deck-editor';
import { parseContentRevision } from '@/lib/marketing/contracts';
import assets from '@/lib/demo/dneskai-preview-assets.json';
import type { DneskaiDeck } from '@/lib/marketing/dneskai-slides';
import { deckRevision } from './marketing-dneskai-revision-fixture';

// The drafts read the clock (an expired time is replaced, the time window is checked): pin it to the fixture's day.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));

const owner = '11111111-1111-4111-8111-111111111111';
const revisionId = '55555555-5555-4555-8555-555555555555';
const photos = new Map(Object.values(assets.photos).map((photo) => [photo.sha256, photo]));
const fixtureBytes = async (sha256: string) => {
  const photo = photos.get(sha256);
  if (!photo) throw new Error('media-asset-unavailable');
  return readFileSync(path.join(process.cwd(), 'public', photo.originalFile));
};
const post = () => createDneskaiWorkspaceFixture(new Date('2026-10-24T09:00:00Z')).posts[0]!;
const fixtureDeck = (): DneskaiDeck => structuredClone(post().deck!);
const request = (url: string, body: unknown, origin = 'https://own.example') => new Request(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const previewUrl = 'https://own.example/api/marketing/dneskai/preview';
const revisionRow = () => ({ revision: parseContentRevision({ ...deckRevision(), deck: fixtureDeck() }) });
function session(row: unknown = revisionRow(), user: { id: string } | null = { id: owner }) {
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), retry: vi.fn(() => query), abortSignal: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data: row, error: null })) };
  const from = vi.fn(() => query);
  mocks.client.mockReturnValue({ auth: { getUser: async () => ({ data: { user } }) }, from });
  return { from, query };
}

beforeEach(() => {
  vi.clearAllMocks(); clearDneskaiPreviewCache();
  mocks.loadMedia.mockImplementation(fixtureBytes);
  mocks.list.mockImplementation(async () => [...photos.keys()]);
  mocks.pool.mockImplementation(async () => ({ media: post().brief!.media, primaryCandidateId: post().brief!.evidence[0]!.candidateId }));
});
afterEach(() => { vi.unstubAllEnvs(); resetDemoDneskaiWorkspace(); });

describe('render-only slide preview (REN-01)', () => {
  it('renders one draft slide in memory as a downscaled WebP and serves a repeat from memory', async () => {
    const load = vi.fn(fixtureBytes);
    const first = await previewDneskaiSlide(fixtureDeck(), 1, load);
    expect(first).toMatchObject({ status: 'rendered', problems: [], cached: false });
    const meta = await sharp(first.image!).metadata();
    expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'webp', width: DNESKAI_PREVIEW_IMAGE.width, height: DNESKAI_PREVIEW_IMAGE.height });
    const again = await previewDneskaiSlide(fixtureDeck(), 1, load);
    expect(again.cached).toBe(true);
    expect(again.image!.equals(first.image!)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  }, 30_000);
  it('refuses with the save gate: cut text, a missing picture, and an abort is worker-timeout', async () => {
    const long = fixtureDeck();
    long.slides[0]!.headline = 'Proč se vyplatí verzovat prompty a ukládat ke každé změně krátkou poznámku, kdo ji udělal, kdy a proč, aby se dala vrátit';
    const cut = await previewDneskaiSlide(long, 0, fixtureBytes);
    expect(cut.status).toBe('refused');
    expect(cut.image).toBeNull();
    expect(cut.problems.some((problem) => problem.code === 'text-clipped' && problem.blocking)).toBe(true);
    const missing = await previewDneskaiSlide(fixtureDeck(), 0, async () => { throw new Error('gone'); });
    expect(missing).toMatchObject({ status: 'refused', image: null, problems: [{ code: 'media-asset-unavailable', blocking: true }] });
    await expect(previewDneskaiSlide(fixtureDeck(), 0, fixtureBytes, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'worker-timeout' });
    await expect(previewDneskaiSlide(fixtureDeck(), 9, fixtureBytes)).rejects.toMatchObject({ code: 'render-input-invalid' });
  }, 30_000);
});

describe('POST /api/marketing/dneskai/preview', () => {
  const body = (deck: unknown = { slides: fixtureDeck().slides.map((_, from) => ({ from })) }, slide = 0) => ({ id: revisionId, deck, slide });
  it('answers an owner with a draft-marked preview of the edited deck, with no storage write and no revision', async () => {
    const { from, query } = session();
    const edit = { slides: [{ from: 0, headline: 'Krátký titulek náhledu' }, ...fixtureDeck().slides.slice(1).map((_, index) => ({ from: index + 1 }))] };
    const response = await previewRoute(request(previewUrl, body(edit)));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const result = DneskaiPreviewResultSchema.parse(await response.json());
    expect(result).toMatchObject({ schemaVersion: 'dneskai-preview/1', draft: true, slide: 0, status: 'rendered' });
    expect(result.image).toMatch(/^data:image\/webp;base64,/);
    expect(Object.keys(result)).not.toContain('contentHash');
    // Read once through the owner's session, scoped to the owner; nothing else is touched.
    expect(from).toHaveBeenCalledTimes(1);
    expect(query.select).toHaveBeenCalledWith('revision');
    expect(query.eq).toHaveBeenCalledWith('user_id', owner);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.limited).toHaveBeenCalledWith(owner, expect.objectContaining({ key: 'dneskai-preview' }));
    expect(mocks.pool).not.toHaveBeenCalled();
  }, 30_000);
  it('checks an inserted slide with the save rules and the pool', async () => {
    session();
    const value = post();
    const draft = createDeckDraft(value);
    const picture = insertablePictures(value, draft, 'figure')[0]!;
    const inserted = insertSlide(value, draft, 1, 'figure', picture);
    const written = setSlideText(setSlideText(inserted.draft, inserted.index, 'headline', 'Nový slide'), inserted.index, 'alt', 'Popis');
    const edit = dneskaiEditRequest(value, written).deck!;
    const response = await previewRoute(request(previewUrl, body(edit, inserted.index)));
    expect(response.status).toBe(200);
    expect(mocks.pool).toHaveBeenCalledTimes(1);
    const refused = await previewRoute(request(previewUrl, body({ slides: [{ from: 0, type: 'statement' }, { from: 1 }] })));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'deck-edit-move-not-allowed' });
  }, 30_000);
  it('refuses strangers, other owners, floods, malformed bodies and slides the draft does not have', async () => {
    session(revisionRow(), null);
    expect((await previewRoute(request(previewUrl, body()))).status).toBe(401);
    session(null);
    expect((await previewRoute(request(previewUrl, body()))).status).toBe(404);
    session();
    expect((await previewRoute(request(previewUrl, body(), 'https://evil.example'))).status).toBe(403);
    expect((await previewRoute(request(previewUrl, '{"id":'))).status).toBe(400);
    expect((await previewRoute(request(previewUrl, { ...body(), extra: true }))).status).toBe(400);
    expect((await previewRoute(request(previewUrl, body(undefined, 9)))).status).toBe(400);
    mocks.limited.mockResolvedValueOnce({ ok: false, retryAfter: 7 });
    const limited = await previewRoute(request(previewUrl, body()));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('7');
    mocks.list.mockImplementationOnce(async () => []);
    expect(await (await previewRoute(request(previewUrl, body()))).json()).toEqual({ error: 'deck-asset-outside-brief' });
  });
});

describe('the /dev-preview twin and the harness', () => {
  const url = 'https://own.example/api/dev-preview/dneskai-preview';
  it('is unavailable in production and renders fixture photographs only', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_E2E', '');
    expect((await fixturePreviewRoute(request(url, { deck: fixtureDeck(), slide: 0 }))).status).toBe(404);
    vi.stubEnv('NEXT_E2E', '1');
    const outside = fixtureDeck(); outside.slides[0]!.images[0]!.assetSha256 = '0'.repeat(64);
    expect((await fixturePreviewRoute(request(url, { deck: outside, slide: 0 }))).status).toBe(409);
    const response = await fixturePreviewRoute(request(url, { deck: fixtureDeck(), slide: 0 }));
    expect(DneskaiPreviewResultSchema.parse(await response.json())).toMatchObject({ draft: true, status: 'rendered' });
  }, 30_000);
  it('applies the shared edit rules in the harness before rendering', async () => {
    const value = post();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => fixturePreviewRoute(new Request(url, { method: 'POST', headers: { Origin: 'https://own.example', 'Content-Type': 'application/json' }, body: init.body as string })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await demoDneskaiWorkspaceApi.renderPreview({ id: value.id, deck: { slides: [{ from: 0, variant: 'ink' }, { from: 1 }] }, slide: 0 }).catch((error) => error);
    expect(result).toMatchObject({ code: 'deck-edit-variant-invalid' });
    const ok = await demoDneskaiWorkspaceApi.renderPreview({ id: value.id, deck: { slides: value.deck!.slides.map((_, from) => ({ from })) }, slide: 3 });
    expect(ok).toMatchObject({ draft: true, slide: 3, status: 'rendered' });
    vi.unstubAllGlobals();
  }, 30_000);
});
