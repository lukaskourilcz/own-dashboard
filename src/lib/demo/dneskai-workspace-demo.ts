'use client';

import { DNESKAI_DECK_CONTENT_VERSION_FOR_DEMO, demoPhotos } from './dneskai-workspace-fixtures';
import { createDneskaiWorkspaceFixture, createDneskaiCostsFixture, demoAccounts, demoFieldLimits, DEMO_PROJECT_ID } from './dneskai-workspace-fixtures';
import { DneskaiWorkspaceRequestError, fitAt, previewAt, type DneskaiEditResult, type DneskaiWorkspaceApi } from '@/lib/marketing/dneskai-workspace-client';
import type { DneskaiEditRequest } from '@/lib/marketing/dneskai-deck-editor';
import { applyDneskaiDeckEdit, DneskaiRevisionEditError } from '@/lib/marketing/dneskai-deck-edit';
import type { DneskaiWorkspacePost, DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import type { DneskaiMediaRead } from '@/lib/marketing/dneskai-media-contracts';
import { z } from 'zod';
import type { DneskaiSlide } from '@/lib/marketing/dneskai-slides';

/**
 * The deterministic stand-in for the DNESKAi workspace server in `/dev-preview` and the guest tour (#119). It keeps
 * the fixture posts in memory for the page's lifetime and answers approvals, edits, returns and skips the way the
 * server does, with the same refusal codes. Edits render through a fixture-only route using committed synthetic images. No owner data, paid provider,
 * storage or publication endpoint is used; all post changes stay in memory.
 */
let store: DneskaiWorkspaceRead | null = null;
const read = () => (store ??= createDneskaiWorkspaceFixture(new Date()));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = <T>(value: T): T => structuredClone(value);

async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // A non-secure context has no SubtleCrypto; a deterministic stand-in keeps the preview working.
  let state = 0x811c9dc5;
  return Array.from({ length: 8 }, (_, round) => { for (const byte of bytes) state = Math.imul(state ^ (byte + round), 16777619) >>> 0; return state.toString(16).padStart(8, '0'); }).join('');
}
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;

function find(id: string): DneskaiWorkspacePost {
  const post = read().posts.find((item) => item.id === id);
  if (!post) throw new DneskaiWorkspaceRequestError('revision-unavailable', 404);
  return post;
}

/** The server's edit contract, shared (`applyDneskaiDeckEdit`), with the fixture brief as the pool. */
function applyEdit(post: DneskaiWorkspacePost, request: DneskaiEditRequest): DneskaiSlide[] {
  if (!post.deck) return [];
  if (!request.deck) return clone(post.deck.slides);
  const pool = { media: post.brief?.media ?? [], primaryCandidateId: post.brief?.evidence[0]?.candidateId ?? null };
  let slides: DneskaiSlide[];
  try { slides = applyDneskaiDeckEdit(post.deck, request.deck, pool).slides; }
  catch (error) { throw new DneskaiWorkspaceRequestError(error instanceof DneskaiRevisionEditError ? error.code : 'deck-edit-invalid', 409); }
  const hashes = new Set(pool.media.map((item) => item.assetSha256));
  const own = new Set(post.deck.slides.flatMap((slide) => slide.images.map((image) => image.assetSha256)));
  if (slides.some((slide) => slide.images.some((image) => !hashes.has(image.assetSha256) && !own.has(image.assetSha256)))) throw new DneskaiWorkspaceRequestError('deck-asset-outside-brief', 409);
  return slides;
}

/** The preview's stand-in for the renderer's gate: too-long words and too-small pictures, as the studio refuses them. */
function demoProblems(post: DneskaiWorkspacePost, slides: DneskaiSlide[]) {
  const problems: Array<{ slide: number; code: string; blocking: boolean; message: string; field: string }> = [];
  slides.forEach((slide, index) => {
    for (const { field, max } of demoFieldLimits(slide)) {
      if ((slide[field] ?? '').trim().length > max) problems.push({ slide: index, code: 'text-clipped', blocking: true, message: `The ${field} does not fit.`, field });
    }
    for (const image of slide.images) {
      const media = post.brief?.media.find((item) => item.assetSha256 === image.assetSha256);
      const fits = slide.type === 'cover-photo' || slide.type === 'single' ? media?.fullBleedCapable : media?.insetCapable;
      if (slide.type !== 'sources' && media && !fits) problems.push({ slide: index, code: 'image-low-resolution', blocking: true, message: 'The picture is too small.', field: image.slot });
    }
  });
  return problems;
}

/** The approval the server's SQL makes, with its refusals: the exact hash, a ready version still in review. */
function approveOne(id: string, expectedHash: string): string {
  const post = find(id);
  if (post.contentHash !== expectedHash) throw new DneskaiWorkspaceRequestError('revision-changed', 409);
  if (post.status !== 'review' || !post.ready) throw new DneskaiWorkspaceRequestError('revision-not-ready', 409);
  post.status = 'approved'; post.approvedAt = new Date().toISOString();
  post.publication = { id: uuid(), status: 'queued', scheduledAt: post.scheduledAt, remoteUrl: null, errorCode: null, lastCheckedAt: null, publishedAt: null };
  return post.publication.id;
}

export const demoDneskaiWorkspaceApi: DneskaiWorkspaceApi = {
  preview: true,
  async loadReview() { await pause(120); return clone(read()); },
  async loadCosts() { await pause(120); return createDneskaiCostsFixture(new Date()); },
  async loadAccounts() { await pause(60); return clone(demoAccounts(new Date())); },
  async loadMedia(_projectId, candidateId): Promise<DneskaiMediaRead> {
    await pause(80);
    const media = read().posts.flatMap((post) => post.brief?.media ?? []).filter((item, index, all) => item.candidateId === candidateId && all.findIndex((other) => other.assetSha256 === item.assetSha256) === index);
    const photo = (sha: string) => Object.values(demoPhotos).find((item) => item.sha256 === sha);
    return { schemaVersion: 'dneskai-media/1', candidates: media.length ? [{
      candidateId, sourceId: 'ukazkovy-zdroj', title: 'Ukázkový článek', url: 'https://www.example.com/clanek', candidateStatus: 'selected', captionOnly: false, mediaType: null,
      collection: { status: 'complete', pageStatus: 'ok', pageError: null, attemptedAt: null, completedAt: null, skipped: [] },
      assets: media.map((item, index) => ({ assetId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, sha256: item.assetSha256, position: item.position, originKind: item.originKind,
        originUrl: 'https://www.example.com/obrazek.jpg', credit: item.credit, width: item.width, height: item.height, mime: 'image/jpeg', bytes: 1000, fetchedAt: '2026-10-20T20:00:00.000Z',
        fullBleedCapable: item.fullBleedCapable, insetCapable: item.insetCapable, duplicateOfAssetId: null, duplicateOfSha256: null, purged: false, previewUrl: photo(item.assetSha256)?.file ?? null })),
    }] : [] } as DneskaiMediaRead;
  },
  async approve(id, expectedHash) {
    await pause(300);
    approveOne(id, expectedHash);
  },
  async approveMany(posts) {
    await pause(400);
    return { results: posts.map(({ id, contentHash }) => {
      try { return { id, ok: true, publicationId: approveOne(id, contentHash), error: null }; }
      catch (error) { return { id, ok: false, publicationId: null, error: error instanceof DneskaiWorkspaceRequestError ? error.code : 'approval-unavailable' }; }
    }) };
  },
  // The real studio fit, through the fixture-only twin of the route: it reads no owner data. Production guests get 404.
  fit: (request, signal) => fitAt('/api/dev-preview/dneskai-fit', request, signal),
  // The fixture's only uncertain publication may have reached media_publish, so the preview refuses as the server would.
  async requeuePublication() { await pause(200); throw new DneskaiWorkspaceRequestError('publication-may-be-published', 409); },
  // The real in-memory render of one draft slide, after the shared edit rules, through the fixture-only twin route.
  async renderPreview(request, signal) {
    const post = find(request.id);
    const slides = applyEdit(post, { action: 'edit', id: request.id, caption: post.caption, scheduledAt: post.scheduledAt, deck: request.deck });
    return previewAt('/api/dev-preview/dneskai-preview', { deck: { ...post.deck!, slides }, slide: request.slide }, signal);
  },
  async decide(id, action, feedback) {
    await pause(200);
    const post = find(id);
    if (post.status !== 'review' && post.status !== 'returned') throw new DneskaiWorkspaceRequestError('decision-unavailable', 409);
    post.status = action; post.feedback = action === 'returned' ? feedback?.trim() || null : post.feedback;
  },
  async edit(request): Promise<DneskaiEditResult> {
    await pause(900);
    const post = find(request.id);
    if (post.status !== 'review' && post.status !== 'returned') throw new DneskaiWorkspaceRequestError('revision-unavailable', 404);
    const slides = applyEdit(post, request);
    const scheduled = Date.parse(request.scheduledAt);
    if (!(scheduled > Date.now()) || scheduled > Date.now() + 6 * 86_400_000) throw new DneskaiWorkspaceRequestError('schedule-outside-asset-window', 409);
    let problems = demoProblems(post, slides);
    let ready = problems.length === 0;
    let assets = clone(post.assets);
    if (post.deck && (request.deck || !post.ready || post.assets.length !== slides.length)) {
      const response = await fetch('/api/dev-preview/dneskai-render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...post.deck, slides }) });
      if (!response.ok) throw new DneskaiWorkspaceRequestError('render-unavailable', response.status);
      const rendered = z.object({ ready: z.boolean(), assets: z.array(z.object({ url: z.string().startsWith('data:image/jpeg;base64,'), sha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.literal(1080), height: z.literal(1350), alt: z.string() })), problems: z.array(z.object({ slide: z.number(), code: z.string(), blocking: z.boolean(), message: z.string(), field: z.string().nullable() })) }).parse(await response.json());
      ready = rendered.ready;
      problems = rendered.problems.map((problem) => ({ ...problem, field: problem.field ?? '' }));
      assets = rendered.assets;
    }
    if (!ready) assets = [];
    const account = request.accountId ? read().accounts.find((item) => item.id === request.accountId) : null;
    const next: DneskaiWorkspacePost = {
      ...clone(post), id: uuid(), replacesId: post.id, status: 'review', ready: ready && assets.length === slides.length, createdAt: new Date().toISOString(), approvedAt: null,
      caption: request.caption, scheduledAt: new Date(request.scheduledAt).toISOString(),
      account: account ? { id: account.remoteId, handle: account.handle, platform: 'instagram' } : post.account,
      deck: post.deck ? { ...post.deck, slides } : null, fields: slides.map(demoFieldLimits), assets: clone(assets),
      renderReport: { schemaVersion: 'dneskai-render-report/1', status: ready ? 'rendered' : 'refused', problems, renderKeys: [], renderedAt: new Date().toISOString() },
      contentHash: '0'.repeat(64),
    };
    next.contentHash = await hash({ version: DNESKAI_DECK_CONTENT_VERSION_FOR_DEMO, caption: next.caption, scheduledAt: next.scheduledAt, deck: next.deck, account: next.account, assets: next.assets.map(({ sha256, width, height }) => ({ sha256, width, height })) });
    post.status = 'superseded';
    read().posts.unshift(next);
    return { id: next.id, ready: next.ready, contentHash: next.contentHash, render: { status: ready ? 'rendered' : 'refused', problems } };
  },
};

/** Only the preview harness's project id has fixture posts. */
export const DEMO_DNESKAI_PROJECT_ID = DEMO_PROJECT_ID;
/** Restores the fixtures (component tests). */
export function resetDemoDneskaiWorkspace() { store = null; }
