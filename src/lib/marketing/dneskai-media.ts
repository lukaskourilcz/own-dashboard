import 'server-only';
import { dneskaiRichEvidenceEnabled } from './dneskai-evidence-rollout';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiCandidateSchema } from './dneskai-contracts';
import { dneskaiSourceById } from './dneskai-registry';
import { safeFetch, SourceHttpError, UnsafeUrlError } from './free-feeds/security/url';
import { SOURCE_USER_AGENT } from './free-feeds/sources/adapters/util';
import { DneskaiMediaImageError, inspectDneskaiImage } from './dneskai-media-image';
import {
  DNESKAI_MEDIA_ORIGIN_KINDS, dneskaiCaptionOnly, dneskaiMediaCapabilities, dneskaiMediaCredit, extractArticleMedia, extractArticleText,
  instagramImageUrlPolicy, instagramMediaPlan, publisherImageUrlPolicy, type DneskaiImageUrlPolicy, type DneskaiMediaPlanEntry,
} from './dneskai-media-plan';
import type { LoadDneskaiMediaBytes } from './dneskai-ports';
import { DNESKAI_MEDIA_READ_VERSION, DneskaiMediaReadSchema, type DneskaiMediaCandidateView, type DneskaiMediaRead } from './dneskai-media-contracts';

/**
 * DNESKAi source media (#114): downloads the pictures of selected research candidates once, stores the
 * original bytes in the private `marketing-media` bucket under their sha256, and records origin, order,
 * size, perceptual hash and credit. Instagram CDN links expire within 24-48 hours, so the scheduler (#120)
 * calls `collectDneskaiMedia` the same night a collection run selects its topics.
 *
 * Owner decision 7 (#110): source pictures are used without a rights gate; origin and credit are always
 * stored. The only gate here is technical: format, size and the publisher's own image hosts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DneskaiMediaDatabase = SupabaseClient<any>;
export const DNESKAI_MEDIA_BUCKET = 'marketing-media';
/** Per picture. Below the bucket's 32 MiB (the studio's DNESKAI_MAX_IMAGE_BYTES), as #114 specifies. */
export const DNESKAI_MEDIA_FETCH_MAX_BYTES = 8 * 1024 * 1024;
export const DNESKAI_MEDIA_PAGE_MAX_BYTES = 3_000_000;
export const DNESKAI_MEDIA_FETCH_TIMEOUT_MS = 15_000;
/** Signed links are for the owner's preview only and never enter a revision or its hash. */
export const DNESKAI_MEDIA_PREVIEW_SECONDS = 60 * 60;
/** Reads of one picture (or of the article page) before a retryable failure becomes final. */
export const DNESKAI_MEDIA_MAX_ATTEMPTS = 3;
/** Storage deletes per request during retention. */
export const DNESKAI_MEDIA_PURGE_CHUNK = 100;
/** Per storage call: an upload has no abort signal, so it is raced against this deadline. */
export const DNESKAI_MEDIA_STORAGE_TIMEOUT_MS = 15_000;
const DEFAULT_BUDGET_MS = 50_000;
/** Upper bound of `budgetMs`: one call stays well inside the 120 s claim of the candidate it works on. */
export const DNESKAI_MEDIA_MAX_BUDGET_MS = 90_000;
/** The claim `marketing_media_begin` takes on a candidate (`interval '120 seconds'`). */
const LEASE_MS = 120_000;
/** No candidate or download starts with less budget than one fetch and a little slack. */
const BUDGET_RESERVE_MS = DNESKAI_MEDIA_FETCH_TIMEOUT_MS + 5_000;
/** The slowest a picture can be: its URL and fallback both time out, then the upload does. */
const ENTRY_WORST_MS = 2 * DNESKAI_MEDIA_FETCH_TIMEOUT_MS + DNESKAI_MEDIA_STORAGE_TIMEOUT_MS + 10_000;
/** Kept free at the end of a claim for the record and finish calls and for clock skew to the database. */
const LEASE_MARGIN_MS = 10_000;

export class DneskaiMediaError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'DneskaiMediaError'; }
}

/** The bucket seen as names inside it (`<owner>/<sha256>.<ext>`); tests replace it with memory. */
export interface DneskaiMediaObjectStore {
  /** Stores new bytes; resolves `exists` when an object with exactly these bytes is already there. */
  put(name: string, bytes: Buffer, contentType: string, metadata: Record<string, string>): Promise<'stored' | 'exists'>;
  get(name: string): Promise<Buffer | null>;
  remove(names: readonly string[]): Promise<void>;
  sign(names: readonly string[], seconds: number): Promise<Array<string | null>>;
}

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DneskaiMediaError('media-storage-timeout')), ms); });
  return Promise.race([Promise.resolve(promise), expired]).finally(() => clearTimeout(timer));
}

export function supabaseMediaObjectStore(db: DneskaiMediaDatabase): DneskaiMediaObjectStore {
  const files = () => db.storage.from(DNESKAI_MEDIA_BUCKET);
  let privateBucket: Promise<boolean> | undefined;
  const bucketIsPrivate = () => privateBucket ??= withTimeout(db.storage.getBucket(DNESKAI_MEDIA_BUCKET), DNESKAI_MEDIA_STORAGE_TIMEOUT_MS).then(({ data, error }) => !error && !!data && !data.public, () => false);
  const get = async (name: string) => {
    const { data, error } = await files().download(name, {}, { signal: AbortSignal.timeout(DNESKAI_MEDIA_STORAGE_TIMEOUT_MS) });
    return error || !data ? null : Buffer.from(await data.arrayBuffer());
  };
  return {
    async put(name, bytes, contentType, metadata) {
      if (!await bucketIsPrivate()) { privateBucket = undefined; throw new DneskaiMediaError('media-private-bucket-required'); }
      // Never overwrite: an object already under this name is accepted only after its bytes are verified.
      // An upload that outlives its deadline may still land; the next pass finds it and verifies it.
      const { error } = await withTimeout(files().upload(name, bytes, { upsert: false, contentType, cacheControl: '3600', metadata }), DNESKAI_MEDIA_STORAGE_TIMEOUT_MS);
      if (!error) return 'stored';
      const existing = await get(name);
      if (existing && sha256Of(existing) === sha256Of(bytes)) return 'exists';
      throw new DneskaiMediaError('media-storage-failed');
    },
    get,
    // No deadline here: a delete that timed out locally may still happen, and an unmarked row without
    // bytes is worse than a slow retention pass.
    async remove(names) {
      for (let index = 0; index < names.length; index += 100) {
        const { error } = await files().remove(names.slice(index, index + 100) as string[]);
        if (error) throw new DneskaiMediaError('media-purge-storage-failed');
      }
    },
    async sign(names, seconds) {
      if (!names.length) return [];
      const { data, error } = await files().createSignedUrls(names as string[], seconds);
      if (error || !data) return names.map(() => null);
      const byPath = new Map(data.map((row) => [row.path, !row.error && row.signedUrl?.startsWith('https://') ? row.signedUrl : null]));
      return names.map((name) => byPath.get(name) ?? null);
    },
  };
}

async function rpc<T>(db: DneskaiMediaDatabase, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  // A lost claim concerns one candidate only; anything else means the database is not answering.
  if (error) throw new DneskaiMediaError(/media fence unavailable/.test(error.message ?? '') ? 'media-lease-lost' : 'media-store-unavailable');
  return data as T;
}
const objectName = (owner: string, storagePath: string) => {
  const prefix = `${DNESKAI_MEDIA_BUCKET}/${owner}/`;
  if (!storagePath.startsWith(prefix) || !/^[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(storagePath.slice(prefix.length))) throw new DneskaiMediaError('media-asset-unavailable');
  return storagePath.slice(DNESKAI_MEDIA_BUCKET.length + 1);
};

const LookupSchema = z.object({ id: z.uuid(), sha256: z.string(), storagePath: z.string(), mime: z.string(), bytes: z.number(), purgedAt: z.string().nullable() }).nullable();
async function lookupAsset(db: DneskaiMediaDatabase, owner: string, sha256: string) {
  return LookupSchema.parse(await rpc(db, 'marketing_media_lookup', { p_owner: owner, p_sha256: sha256 }));
}

/** LoadDneskaiMediaBytes (dneskai-ports.ts): the exact stored bytes of one asset, verified against its sha256. */
export function createDneskaiMediaLoader(db: DneskaiMediaDatabase, owner: string, options: { store?: DneskaiMediaObjectStore } = {}): LoadDneskaiMediaBytes {
  z.uuid().parse(owner);
  const store = options.store ?? supabaseMediaObjectStore(db);
  return async (sha256) => {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new DneskaiMediaError('media-asset-unavailable');
    let asset: z.infer<typeof LookupSchema>;
    try { asset = await lookupAsset(db, owner, sha256); } catch { throw new DneskaiMediaError('media-asset-unavailable'); }
    if (!asset || asset.sha256 !== sha256 || asset.purgedAt) throw new DneskaiMediaError('media-asset-unavailable');
    const bytes = await store.get(objectName(owner, asset.storagePath)).catch(() => null);
    if (!bytes) throw new DneskaiMediaError('media-asset-unavailable');
    if (sha256Of(bytes) !== sha256) throw new DneskaiMediaError('media-asset-hash-mismatch');
    return bytes;
  };
}

export interface DneskaiMediaDependencies {
  /** Injected transport for tests; production uses the pinned-TLS fetch inside `safeFetch`. */
  fetchImpl?: typeof fetch;
  resolveImpl?: (hostname: string) => Promise<string[]>;
  store?: DneskaiMediaObjectStore;
  signal?: AbortSignal;
  /** Milliseconds clock for the time budget. */
  now?: () => number;
  /**
   * Work stops starting new downloads once less than one fetch timeout of this budget is left. Capped at
   * DNESKAI_MEDIA_MAX_BUDGET_MS; a download also never starts unless it can finish inside the claim.
   */
  budgetMs?: number;
  concurrency?: number;
}

/** `count` and `hosts` appear only on the plan-level (-1) media-host-not-publisher record. */
type Skip = { position: number; code: string; retryable: boolean; attempts: number; count?: number; hosts?: string[] };
/** Refused hosts kept on the plan-level record, most refusals first. */
export const DNESKAI_MEDIA_REFUSED_HOSTS_LIMIT = 5;
/**
 * Pictures the publisher policy refused while the plan was built never enter the plan. One position -1 record
 * keeps how many there were and their hosts, so the allowlist can grow from evidence (M-08).
 */
export function dneskaiRefusedHostsSkip(refused: ReadonlyMap<string, number>): Skip | null {
  if (!refused.size) return null;
  const hosts = [...refused.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, DNESKAI_MEDIA_REFUSED_HOSTS_LIMIT).map(([host]) => host);
  return { position: -1, code: 'media-host-not-publisher', retryable: false, attempts: 1, count: [...refused.values()].reduce((sum, value) => sum + value, 0), hosts };
}
export type DneskaiMediaOutcome = {
  candidateId: string;
  status: 'complete' | 'partial' | 'failed' | 'empty' | 'pending' | 'not-selected' | 'busy';
  assets: number;
  downloaded: number;
  reused: number;
  skipped: Array<{ position: number; code: string }>;
};

/** Outcomes that are not failures: the picture is chrome, too small, a duplicate or off the publisher's hosts. */
const EXCLUSIONS = new Set(['media-excluded-format', 'media-excluded-small', 'media-duplicate-bytes', 'media-host-not-publisher']);

class FetchFailure extends Error { constructor(readonly code: string, readonly retryable: boolean) { super(code); } }
function classifyFetchError(error: unknown, signal: AbortSignal): FetchFailure {
  if (error instanceof FetchFailure) return error;
  if (error instanceof SourceHttpError) {
    const status = [400, 401, 403, 404, 410, 429, 500, 502, 503, 504].includes(error.status) ? String(error.status) : 'error';
    return new FetchFailure(`media-http-${status}`, error.status === 429 || error.status >= 500);
  }
  if (error instanceof UnsafeUrlError) {
    if (error.message.startsWith('Unexpected content type')) return new FetchFailure('media-excluded-format', false);
    if (/too large/i.test(error.message)) return new FetchFailure('media-too-large', false);
    if (/allowlisted|redirect/i.test(error.message)) return new FetchFailure('media-redirect-refused', false);
    return new FetchFailure('media-host-unsafe', false);
  }
  if (signal.aborted || (error instanceof Error && /timed out|abort/i.test(`${error.name} ${error.message}`))) return new FetchFailure('media-timeout', true);
  return new FetchFailure('media-fetch-failed', true);
}

const IMAGE_CONTENT_TYPES = ['image/jpg', 'application/octet-stream', 'binary/octet-stream'];
async function fetchBytes(url: string, allowImage: DneskaiImageUrlPolicy, deps: DneskaiMediaDependencies, signal: AbortSignal) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  if (!allowImage(parsed)) throw new FetchFailure('media-host-not-publisher', false);
  try {
    const response = await safeFetch(url, {
      allowHosts: [host], urlPolicy: allowImage, method: 'GET', maxBytes: DNESKAI_MEDIA_FETCH_MAX_BYTES, maxRedirects: 2, timeoutMs: DNESKAI_MEDIA_FETCH_TIMEOUT_MS,
      headers: { Accept: 'image/jpeg, image/png, image/webp;q=0.9, */*;q=0.1', 'user-agent': SOURCE_USER_AGENT },
      extraContentTypes: IMAGE_CONTENT_TYPES, signal, fetchImpl: deps.fetchImpl, resolveImpl: deps.resolveImpl,
    });
    return response.body;
  } catch (error) { throw classifyFetchError(error, signal); }
}

async function fetchArticle(url: string, deps: DneskaiMediaDependencies, signal: AbortSignal) {
  const host = new URL(url).hostname;
  const sibling = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  try {
    const response = await safeFetch(url, {
      allowHosts: [host, sibling], method: 'GET', maxBytes: DNESKAI_MEDIA_PAGE_MAX_BYTES, maxRedirects: 3, timeoutMs: DNESKAI_MEDIA_FETCH_TIMEOUT_MS,
      headers: { Accept: 'text/html, application/xhtml+xml;q=0.9', 'user-agent': SOURCE_USER_AGENT },
      extraContentTypes: ['application/xhtml+xml'], signal, fetchImpl: deps.fetchImpl, resolveImpl: deps.resolveImpl,
    });
    return { url: response.url, html: new TextDecoder().decode(response.body) };
  } catch (error) {
    const failure = classifyFetchError(error, signal);
    throw new FetchFailure(failure.code.replace(/^media-/, 'media-page-'), failure.retryable);
  }
}

const BeginSchema = z.object({
  claimed: z.boolean(), reason: z.string().optional(), candidate: z.unknown().optional(),
  state: z.object({
    status: z.enum(['pending', 'complete', 'partial', 'failed', 'empty']),
    plan: z.array(z.object({ position: z.number().int(), url: z.string(), kind: z.enum(DNESKAI_MEDIA_ORIGIN_KINDS), fallbackUrl: z.string().optional(), sourceAltText: z.string().max(1000).optional() })).nullable(),
    skipped: z.array(z.object({ position: z.number().int(), code: z.string(), retryable: z.boolean(), attempts: z.number().int(), count: z.number().int().optional(), hosts: z.array(z.string()).max(DNESKAI_MEDIA_REFUSED_HOSTS_LIMIT).optional() })),
    page_attempts: z.number().int(), asset_count: z.number().int(),
  }).optional(),
  links: z.array(z.object({ position: z.number().int(), assetId: z.uuid(), sha256: z.string() })).optional(),
});

const CandidateIdsSchema = z.array(z.string().min(1).max(200)).min(1).max(8).refine((ids) => new Set(ids).size === ids.length);

/**
 * Downloads and stores the pictures of selected candidates. Resumable and idempotent: a finished candidate
 * is never fetched again, a pass that runs out of budget leaves `complete: false` and the next call
 * continues with the positions still open, and the same bytes are stored once per owner.
 */
export async function collectDneskaiMedia(db: DneskaiMediaDatabase, owner: string, project: string, candidateIds: readonly string[], deps: DneskaiMediaDependencies = {}) {
  z.uuid().parse(owner); z.uuid().parse(project);
  const ids = CandidateIdsSchema.parse(candidateIds);
  const store = deps.store ?? supabaseMediaObjectStore(db);
  const now = deps.now ?? Date.now;
  const requested = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const budget = Number.isNaN(requested) ? DEFAULT_BUDGET_MS : Math.max(0, Math.min(requested, DNESKAI_MEDIA_MAX_BUDGET_MS));
  const deadline = now() + budget;
  const signal = deps.signal ?? new AbortController().signal;
  const outcomes: DneskaiMediaOutcome[] = [];
  let complete = true;
  for (const candidateId of ids) {
    if (signal.aborted || deadline - now() < BUDGET_RESERVE_MS) { complete = false; break; }
    let outcome: DneskaiMediaOutcome;
    try {
      outcome = await collectCandidate(db, owner, project, candidateId, { ...deps, store, signal, now }, () => deadline - now());
    } catch (error) {
      if (!(error instanceof DneskaiMediaError) || error.code !== 'media-lease-lost') throw error;
      // The claim ran out before the pass finished; the row stays pending and the next call resumes it.
      outcome = { candidateId, status: 'pending', assets: 0, downloaded: 0, reused: 0, skipped: [{ position: -1, code: 'media-lease-lost' }] };
    }
    if (outcome.status === 'pending' || outcome.status === 'busy') complete = false;
    outcomes.push(outcome);
  }
  return { complete, candidates: outcomes };
}

async function collectCandidate(db: DneskaiMediaDatabase, owner: string, project: string, candidateId: string, deps: DneskaiMediaDependencies & { store: DneskaiMediaObjectStore; signal: AbortSignal; now: () => number }, remaining: () => number): Promise<DneskaiMediaOutcome> {
  const fence = randomUUID();
  const base = { candidateId, assets: 0, downloaded: 0, reused: 0, skipped: [] as DneskaiMediaOutcome['skipped'] };
  // Taken before the claim is asked for, so this end is never later than the database's own lease end.
  const leaseEnds = deps.now() + LEASE_MS;
  const leaseLeft = () => leaseEnds - deps.now();
  const begun = BeginSchema.parse(await rpc(db, 'marketing_media_begin', { p_owner: owner, p_project: project, p_candidate: candidateId, p_fence: fence }));
  if (!begun.claimed) {
    if (begun.reason === 'collection-finished' && begun.state) return { ...base, status: begun.state.status, assets: begun.state.asset_count, skipped: begun.state.skipped.map(({ position, code }) => ({ position, code })) };
    return { ...base, status: begun.reason === 'collection-busy' ? 'busy' : 'not-selected' };
  }
  const state = begun.state!;
  const finish = async (status: DneskaiMediaOutcome['status'], skipped: Skip[]) => {
    const row = z.object({ asset_count: z.number().int() }).parse(await rpc(db, 'marketing_media_finish', { p_owner: owner, p_project: project, p_candidate: candidateId, p_fence: fence, p_status: status, p_skipped: skipped }));
    return row.asset_count;
  };
  const parsed = DneskaiCandidateSchema.safeParse(begun.candidate);
  const source = parsed.success ? dneskaiSourceById(parsed.data.sourceId) : undefined;
  if (!parsed.success || !source) {
    if (!state.plan) await rpc(db, 'marketing_media_set_plan', { p_owner: owner, p_project: project, p_candidate: candidateId, p_fence: fence, p_plan: [], p_page_status: 'not-applicable', p_page_error: null });
    const skipped = [{ position: -1, code: parsed.success ? 'media-source-unknown' : 'media-candidate-invalid', retryable: false, attempts: 1 }];
    await finish('failed', skipped);
    return { ...base, status: 'failed', skipped: skipped.map(({ position, code }) => ({ position, code })) };
  }
  const candidate = parsed.data;
  const instagram = source.kind === 'instagram';
  const allowImage = instagram ? instagramImageUrlPolicy : publisherImageUrlPolicy(source, candidate.url);
  let plan = state.plan as DneskaiMediaPlanEntry[] | null;
  const refusedHosts = new Map<string, number>();
  if (!plan) {
    if (instagram) {
      plan = instagramMediaPlan(candidate);
      await rpc(db, 'marketing_media_set_plan', { p_owner: owner, p_project: project, p_candidate: candidateId, p_fence: fence, p_plan: plan, p_page_status: 'not-applicable', p_page_error: null });
    } else {
      // The article page is read once; its pictures and their order are then fixed for every later pass.
      try {
        const page = await fetchArticle(candidate.url, deps, deps.signal);
        plan = extractArticleMedia(page.html, page.url, { allowImage, feedImages: candidate.mediaUrls, refusedHosts });
        if (dneskaiRichEvidenceEnabled()) await rpc(db,'marketing_media_set_evidence',{p_owner:owner,p_project:project,p_candidate:candidateId,p_fence:fence,p_article_text:extractArticleText(page.html)});
        await rpc(db, 'marketing_media_set_plan', { p_owner: owner, p_project: project, p_candidate: candidateId, p_fence: fence, p_plan: plan, p_page_status: 'ok', p_page_error: null });
      } catch (error) {
        if (error instanceof DneskaiMediaError) throw error;
        const failure = error instanceof FetchFailure ? error : new FetchFailure('media-page-fetch-failed', true);
        if (failure.retryable && state.page_attempts + 1 < DNESKAI_MEDIA_MAX_ATTEMPTS) {
          await rpc(db, 'marketing_media_set_plan', { p_owner: owner, p_project: project, p_candidate: candidateId, p_fence: fence, p_plan: null, p_page_status: 'failed', p_page_error: failure.code });
          await finish('pending', state.skipped);
          return { ...base, status: 'pending', skipped: [{ position: -1, code: failure.code }] };
        }
        // No readable page: the feed's own image is all the publisher offered.
        refusedHosts.clear();
        plan = extractArticleMedia('', candidate.url, { allowImage, feedImages: candidate.mediaUrls, refusedHosts });
        await rpc(db, 'marketing_media_set_plan', { p_owner: owner, p_project: project, p_candidate: candidateId, p_fence: fence, p_plan: plan, p_page_status: 'failed', p_page_error: failure.code });
      }
    }
  }

  // Each picture is credited from its own signals: the plan's URL and caption, and the credit fields of its file.
  const creditFor = (entry: DneskaiMediaPlanEntry, prepared: PreparedEntry) => dneskaiMediaCredit(source, candidate, undefined,
    { url: prepared.originUrl, sourceAltText: entry.sourceAltText, embeddedCredits: prepared.image.embeddedCredits });
  const linked = new Set((begun.links ?? []).map((link) => link.position));
  const skips = new Map<number, Skip>(state.skipped.map((skip) => [skip.position, skip]));
  const refusedSkip = dneskaiRefusedHostsSkip(refusedHosts);
  if (refusedSkip) skips.set(refusedSkip.position, refusedSkip);
  const open = (entry: DneskaiMediaPlanEntry) => {
    if (linked.has(entry.position)) return false;
    const skip = skips.get(entry.position);
    return !skip || (skip.retryable && skip.attempts < DNESKAI_MEDIA_MAX_ATTEMPTS);
  };
  // Downloads run in parallel; recording follows plan order, so the same bytes at two positions are
  // always linked at the first one.
  const counters = { downloaded: 0, reused: 0 };
  let stopped = false;
  const limit = limiter(Math.max(1, Math.min(deps.concurrency ?? 2, 4)));
  const tasks = plan.filter(open).map((entry) => ({ entry, prepared: limit(async () => {
    if (deps.signal.aborted || remaining() < BUDGET_RESERVE_MS || leaseLeft() < ENTRY_WORST_MS + LEASE_MARGIN_MS) return null;
    try { return await prepareEntry(owner, entry, allowImage, deps, db); }
    catch (error) { return error instanceof FetchFailure ? error : new FetchFailure(error instanceof DneskaiMediaError ? error.code : 'media-fetch-failed', true); }
  }) }));
  for (const { entry, prepared } of tasks) {
    const result = await prepared;
    if (result === null) { stopped = true; continue; }
    const attempts = (skips.get(entry.position)?.attempts ?? 0) + 1;
    if (result instanceof FetchFailure) { skips.set(entry.position, { position: entry.position, code: result.code, retryable: result.retryable, attempts }); continue; }
    counters.downloaded += 1;
    if (result.reused) counters.reused += 1;
    try {
      const linkedPosition = await recordEntry(db, owner, project, candidateId, fence, entry, creditFor(entry, result), result);
      if (linkedPosition === entry.position) { linked.add(entry.position); skips.delete(entry.position); }
      else skips.set(entry.position, { position: entry.position, code: 'media-duplicate-bytes', retryable: false, attempts });
    } catch (error) {
      const failure = error instanceof FetchFailure ? error : new FetchFailure('media-record-failed', true);
      skips.set(entry.position, { position: entry.position, code: failure.code, retryable: failure.retryable, attempts });
    }
  }

  const skipped = [...skips.values()].filter((skip) => !linked.has(skip.position)).sort((left, right) => left.position - right.position);
  const workLeft = stopped || plan.some(open);
  const failures = skipped.some((skip) => !EXCLUSIONS.has(skip.code));
  const status: DneskaiMediaOutcome['status'] = workLeft ? 'pending' : linked.size ? (failures ? 'partial' : 'complete') : (failures ? 'failed' : 'empty');
  const assets = await finish(status, skipped);
  return { candidateId, status, assets, downloaded: counters.downloaded, reused: counters.reused, skipped: skipped.map(({ position, code }) => ({ position, code })) };
}

function limiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return <T>(task: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    const start = () => { active += 1; task().then(resolve, reject).finally(() => { active -= 1; waiting.shift()?.(); }); };
    if (active < concurrency) start(); else waiting.push(start);
  });
}

type PreparedEntry = { originUrl: string; image: Awaited<ReturnType<typeof inspectDneskaiImage>>; uploaded: boolean; reused: boolean };
/** Fetches, inspects and (when new) uploads one picture. The row is written only after the object exists. */
async function prepareEntry(owner: string, entry: DneskaiMediaPlanEntry, allowImage: DneskaiImageUrlPolicy, deps: DneskaiMediaDependencies & { store: DneskaiMediaObjectStore; signal: AbortSignal }, db: DneskaiMediaDatabase): Promise<PreparedEntry> {
  let originUrl = entry.url, bytes: Uint8Array;
  try { bytes = await fetchBytes(entry.url, allowImage, deps, deps.signal); }
  catch (error) {
    // A full-size rendition that is missing, refused or too large falls back to the publisher's own URL.
    if (!entry.fallbackUrl) throw error;
    originUrl = entry.fallbackUrl;
    bytes = await fetchBytes(entry.fallbackUrl, allowImage, deps, deps.signal);
  }
  let image: PreparedEntry['image'];
  try { image = await inspectDneskaiImage(bytes); }
  catch (error) {
    const code = error instanceof DneskaiMediaImageError ? error.code : 'media-undecodable';
    // A decoder that did not load says nothing about the picture: a later pass tries it again.
    throw new FetchFailure(code, code === 'media-decoder-unavailable');
  }
  let existing: z.infer<typeof LookupSchema>;
  try { existing = await lookupAsset(db, owner, image.sha256); } catch { throw new FetchFailure('media-record-failed', true); }
  if (existing && !existing.purgedAt) return { originUrl, image, uploaded: false, reused: true };
  let put: 'stored' | 'exists';
  try { put = await deps.store.put(`${owner}/${image.sha256}.${image.ext}`, Buffer.from(bytes), image.mime, { ownerId: owner, sha256: image.sha256 }); }
  catch { throw new FetchFailure('media-storage-failed', true); }
  return { originUrl, image, uploaded: true, reused: put === 'exists' };
}

async function recordEntry(db: DneskaiMediaDatabase, owner: string, project: string, candidateId: string, fence: string, entry: DneskaiMediaPlanEntry, credit: string, prepared: PreparedEntry) {
  const { image, originUrl, uploaded } = prepared;
  try {
    const recorded = z.object({ assetId: z.uuid(), linkedPosition: z.number().int().nullable() }).parse(await rpc(db, 'marketing_media_record_asset', {
      p_owner: owner, p_project: project, p_candidate: candidateId, p_fence: fence,
      p_asset: { sha256: image.sha256, position: entry.position, originUrl, originKind: entry.kind, width: image.width, height: image.height, mime: image.mime, bytes: image.bytes, phash: image.phash, credit, uploaded },
    }));
    return recorded.linkedPosition;
  } catch {
    // The bytes are stored; recording them on a later pass is idempotent.
    throw new FetchFailure('media-record-failed', true);
  }
}

/**
 * The selected candidates (for today or a later Prague day) whose media are not collected yet or still
 * pending, at most eight: the scheduler (#120) passes them to `collectDneskaiMedia` until the list is empty.
 */
export async function pendingDneskaiMediaCandidates(db: DneskaiMediaDatabase, owner: string, project: string): Promise<string[]> {
  z.uuid().parse(owner); z.uuid().parse(project);
  return z.array(z.string().min(1).max(200)).max(8).parse(await rpc(db, 'marketing_media_pending_candidates', { p_owner: owner, p_project: project }));
}

/**
 * Retention: deletes the stored bytes of assets older than `olderThanDays` that no revision deck draws
 * (`revision.deck.slides[].images[].assetSha256`) and no candidate linked within the window, and marks
 * them purged. Rows, origin and credit stay. The scheduler (#120) calls it daily, not during collection.
 */
export async function purgeUnusedDneskaiMedia(db: DneskaiMediaDatabase, owner: string, olderThanDays = 30, options: { store?: DneskaiMediaObjectStore; limit?: number } = {}) {
  z.uuid().parse(owner);
  if (!Number.isInteger(olderThanDays) || olderThanDays < 1 || olderThanDays > 365) throw new DneskaiMediaError('media-purge-invalid');
  const store = options.store ?? supabaseMediaObjectStore(db);
  const claimed = z.array(z.object({ id: z.uuid(), storagePath: z.string() })).parse(await rpc(db, 'marketing_media_claim_purge', { p_owner: owner, p_older_than_days: olderThanDays, p_limit: options.limit ?? 200 }));
  let purged = 0;
  for (let index = 0; index < claimed.length; index += DNESKAI_MEDIA_PURGE_CHUNK) {
    const chunk = claimed.slice(index, index + DNESKAI_MEDIA_PURGE_CHUNK);
    try {
      await store.remove(chunk.map((row) => objectName(owner, row.storagePath)));
      purged += chunk.length;
    } catch {
      // Only rows whose deletion did not happen lose the mark: an earlier chunk's bytes are gone, and an
      // unmarked row without bytes would be reused without a fresh upload. The next daily pass retries.
      await rpc(db, 'marketing_media_unmark_purge', { p_owner: owner, p_ids: claimed.slice(index).map((row) => row.id) });
      return { purged, errorCode: 'media-purge-storage-failed' as const };
    }
  }
  return { purged, errorCode: null };
}

const LinkRowSchema = z.object({
  candidate_id: z.string(), position: z.number().int(), origin_url: z.string(), origin_kind: z.enum(DNESKAI_MEDIA_ORIGIN_KINDS), credit: z.string(),
  asset: z.object({ id: z.uuid(), sha256: z.string(), width: z.number().int(), height: z.number().int(), mime: z.enum(['image/jpeg', 'image/png', 'image/webp']), bytes: z.number().int(), storage_path: z.string(), fetched_at: z.string(), phash: z.string().nullable().optional(), duplicate_of_asset_id: z.uuid().nullable(), purged_at: z.string().nullable() }),
});
const CollectionRowSchema = z.object({
  candidate_id: z.string(), status: z.enum(['pending', 'complete', 'partial', 'failed', 'empty']), page_status: z.enum(['not-applicable', 'pending', 'ok', 'failed']), page_error: z.string().nullable(),
  article_text: z.string().max(4000).default(''), plan:z.array(z.object({position:z.number().int(),sourceAltText:z.string().max(1000).optional()})).nullable().optional(),
  attempted_at: z.string().nullable(), completed_at: z.string().nullable(), skipped: z.array(z.object({ position: z.number().int(), code: z.string() }).loose()),
});

/**
 * The owner's view of collected media: per candidate, its pictures in original order with credit, size,
 * capability flags and duplicate marker, plus the collection state, so a missing picture is visible.
 * Reads through the caller's client, so a session client sees only the owner's rows (RLS).
 */
export async function readDneskaiMedia(db: DneskaiMediaDatabase, owner: string, project: string, options: { candidateId?: string; sign?: boolean; store?: DneskaiMediaObjectStore } = {}): Promise<DneskaiMediaRead> {
  z.uuid().parse(owner); z.uuid().parse(project);
  const query = db.from('marketing_dneskai_candidates').select('id,status,candidate').eq('user_id', owner).eq('project_id', project);
  const { data: candidateRows, error } = await (options.candidateId ? query.eq('id', options.candidateId) : query.eq('status', 'selected').order('updated_at', { ascending: false }).limit(8));
  if (error) throw new DneskaiMediaError('media-read-unavailable');
  const candidates = (candidateRows ?? []).flatMap((row) => { const parsed = DneskaiCandidateSchema.safeParse(row.candidate); return parsed.success && parsed.data.id === row.id ? [parsed.data] : []; });
  if (!candidates.length) return { schemaVersion: DNESKAI_MEDIA_READ_VERSION, candidates: [] };
  const ids = candidates.map((candidate) => candidate.id);
  const [collections, links] = await Promise.all([
    db.from('marketing_media_collections').select(`candidate_id,status,page_status,page_error,attempted_at,completed_at,skipped,plan${dneskaiRichEvidenceEnabled() ? ',article_text' : ''}`).eq('user_id', owner).eq('project_id', project).in('candidate_id', ids),
    db.from('marketing_media_asset_links').select('candidate_id,position,origin_url,origin_kind,credit,asset:marketing_media_assets(id,sha256,width,height,mime,bytes,storage_path,fetched_at,phash,duplicate_of_asset_id,purged_at)')
      .eq('user_id', owner).eq('project_id', project).in('candidate_id', ids).order('position', { ascending: true }).limit(100),
  ]);
  if (collections.error || links.error) throw new DneskaiMediaError('media-read-unavailable');
  const linkRows = z.array(LinkRowSchema).parse(links.data ?? []);
  const collectionRows = new Map(z.array(CollectionRowSchema).parse(collections.data ?? []).map((row) => [row.candidate_id, row]));
  const shaById = new Map(linkRows.map((row) => [row.asset.id, row.asset.sha256]));
  const missing = [...new Set(linkRows.flatMap((row) => row.asset.duplicate_of_asset_id && !shaById.has(row.asset.duplicate_of_asset_id) ? [row.asset.duplicate_of_asset_id] : []))];
  if (missing.length) {
    const canonical = await db.from('marketing_media_assets').select('id,sha256').eq('user_id', owner).in('id', missing);
    if (canonical.error) throw new DneskaiMediaError('media-read-unavailable');
    for (const row of z.array(z.object({ id: z.uuid(), sha256: z.string() })).parse(canonical.data ?? [])) shaById.set(row.id, row.sha256);
  }
  const live = linkRows.filter((row) => !row.asset.purged_at);
  const names = live.map((row) => objectName(owner, row.asset.storage_path));
  const urls = options.sign ? await (options.store ?? supabaseMediaObjectStore(db)).sign(names, DNESKAI_MEDIA_PREVIEW_SECONDS).catch(() => names.map(() => null)) : [];
  const previews = new Map(live.map((row, index) => [`${row.candidate_id}:${row.asset.id}`, urls[index] ?? null]));
  return DneskaiMediaReadSchema.parse({
    schemaVersion: DNESKAI_MEDIA_READ_VERSION,
    candidates: candidates.map((candidate): DneskaiMediaCandidateView => {
      const collection = collectionRows.get(candidate.id);
      return {
        candidateId: candidate.id, sourceId: candidate.sourceId, title: candidate.title, url: candidate.url, candidateStatus: candidate.status,
        ...(dneskaiRichEvidenceEnabled() && collection?.article_text?{articleText:collection.article_text}:{}),
        captionOnly: dneskaiCaptionOnly(candidate), mediaType: candidate.instagram?.mediaType ?? null,
        collection: collection ? { status: collection.status, pageStatus: collection.page_status, pageError: collection.page_error, attemptedAt: collection.attempted_at, completedAt: collection.completed_at, skipped: collection.skipped.map(({ position, code }) => ({ position, code })) } : null,
        assets: linkRows.filter((row) => row.candidate_id === candidate.id).sort((left, right) => left.position - right.position).map((row) => ({
          ...(dneskaiRichEvidenceEnabled() && collection?.plan?.find(p=>p.position===row.position)?.sourceAltText?{sourceAltText:collection.plan.find(p=>p.position===row.position)!.sourceAltText}:{}),
          assetId: row.asset.id, sha256: row.asset.sha256, position: row.position, originKind: row.origin_kind, originUrl: row.origin_url, credit: row.credit,
          width: row.asset.width, height: row.asset.height, mime: row.asset.mime, bytes: row.asset.bytes, fetchedAt: row.asset.fetched_at,
          ...dneskaiMediaCapabilities(row.asset),
          phash: row.asset.phash && /^[a-f0-9]{16}$/.test(row.asset.phash) ? row.asset.phash : null,
          duplicateOfAssetId: row.asset.duplicate_of_asset_id, duplicateOfSha256: row.asset.duplicate_of_asset_id ? shaById.get(row.asset.duplicate_of_asset_id) ?? null : null,
          purged: row.asset.purged_at !== null, previewUrl: previews.get(`${row.candidate_id}:${row.asset.id}`) ?? null,
        })),
      };
    }),
  });
}
