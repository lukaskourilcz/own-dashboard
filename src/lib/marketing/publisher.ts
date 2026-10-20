import 'server-only';
import { createHash } from 'node:crypto';
import { parseContentRevision, parseSourcePacket, publishedStoryReceipt, revisionReadiness, sourceUsable, type MarketingRevisionRow, type PublicationRow, type SourcePacket, type ContentRevision } from './contracts';
import { contentHash, revisionHash } from './hashes';

export const MARKETING_SOURCE_MAX_AGE_MS = 15 * 60_000;
export type MarketingPublishAccount = { id: string; user_id: string; brand: ContentRevision['brand']; platform: ContentRevision['account']['platform'];
  remote_account_id: string; handle: string; verified_at: string | null; enabled: boolean };
export type MetaPublisherConfig = { enabled: boolean; apiVersion: string; apiVersionVerifiedAt: string;
  loginMode: 'instagram' | 'facebook' | 'threads'; accessToken: string; tokenExpiresAt: string;
  scopes: string[]; approvedAssetHosts: string[]; pollAttempts?: number; pollIntervalMs?: number; requestTimeoutMs?: number;
  /** Set by the credential resolver when no usable token exists; the publisher holds with this exact code. */
  credentialHold?: string | null; credentialSource?: 'database' | 'environment' };
/** Instagram feed image limits: JPEG, 320–1440 px wide, 4:5 to 1.91:1, at most 8 MiB. */
export const INSTAGRAM_FEED_IMAGE = { minWidth: 320, maxWidth: 1440, maxBytes: 8 * 1024 * 1024 } as const;
export const INSTAGRAM_MAX_COLLABORATORS = 3;
export const INSTAGRAM_ALT_TEXT_MAX = 1000;
export function instagramFeedGeometryValid(width: number, height: number): boolean {
  // Cross-multiplied so 1080 x 1350 (exactly 4:5) is never lost to float rounding.
  return Number.isInteger(width) && Number.isInteger(height) && width >= INSTAGRAM_FEED_IMAGE.minWidth && width <= INSTAGRAM_FEED_IMAGE.maxWidth &&
    height > 0 && width * 5 >= height * 4 && width * 100 <= height * 191;
}
const instagramFeed = (revision: ContentRevision) => revision.account.platform === 'instagram' && revision.format !== 'story';
const normalizedHandle = (value: string) => value.replace(/^@/, '').toLowerCase();
export type PublishOutcome = { status: 'held' | 'dry-run' | 'pending' | 'published' | 'failed' | 'reconciliation';
  remoteContainerId: string | null; remoteMediaId: string | null; remoteUrl: string | null; errorCode: string | null };
export type PublisherCheckpoint = PublishOutcome & { stage: 'container-create-intent' | 'container-created' | 'publish-intent' | 'outcome' };
export type PublisherState = { revisionRow: MarketingRevisionRow; account: MarketingPublishAccount; sources: SourcePacket[] };
export type PublishMarketingInput = PublisherState & { publication: PublicationRow & { user_id: string; lease_until?: string | null };
  config: MetaPublisherConfig; dryRun?: boolean; now?: Date; signal?: AbortSignal; fetcher?: typeof fetch; wait?: (ms: number) => Promise<void>;
  checkpoint: (checkpoint: PublisherCheckpoint) => Promise<void>; revalidate: () => Promise<PublisherState> };

const idValid = (value: string | null | undefined): value is string => typeof value === 'string' && /^\d{1,100}$/.test(value);
const timestampValid = (value: string | null | undefined, now: Date) => !!value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime();
const result = (status: PublishOutcome['status'], errorCode: string | null, container: string | null = null, media: string | null = null, url: string | null = null): PublishOutcome =>
  ({ status, errorCode, remoteContainerId: container, remoteMediaId: media, remoteUrl: url });

export function publicationGate(state: PublisherState, config: MetaPublisherConfig, now: Date): string | null {
  const { revisionRow: row, account } = state;
  let revision: ContentRevision;
  try { revision = parseContentRevision(row.revision); } catch { return 'invalid-revision'; }
  const hash = revisionHash(revision);
  if (!['approved', 'publishing'].includes(row.status) || !timestampValid(row.approved_at, now) || row.approved_hash !== hash || row.content_hash !== hash) return 'exact-approval-required';
  if (!row.ready || revisionReadiness(revision).length) return 'final-assets-required';
  if (account.user_id !== row.user_id || account.remote_account_id !== revision.account.id || account.brand !== revision.brand || account.platform !== revision.account.platform ||
      account.handle.replace(/^@/, '').toLowerCase() !== revision.account.handle.replace(/^@/, '').toLowerCase()) return 'account-binding-mismatch';
  if (!account.enabled || !timestampValid(account.verified_at, now) || !idValid(account.remote_account_id)) return 'account-unverified-or-disabled';
  if (!config.enabled) return 'publishing-disabled';
  if (!/^v\d+\.\d+$/.test(config.apiVersion) || !timestampValid(config.apiVersionVerifiedAt, now)) return 'api-version-unverified';
  if (config.credentialHold) return config.credentialHold;
  if (!config.accessToken) return 'access-token-missing';
  if (!Number.isFinite(Date.parse(config.tokenExpiresAt))) return 'access-token-expiry-unverified';
  if (Date.parse(config.tokenExpiresAt) <= now.getTime()) return 'access-token-expired';
  if ((account.platform === 'threads') !== (config.loginMode === 'threads')) return 'login-mode-mismatch';
  const required = account.platform === 'threads' ? ['threads_basic', 'threads_content_publish'] : config.loginMode === 'instagram'
    ? ['instagram_business_basic', 'instagram_business_content_publish'] : ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'];
  if (required.some(scope => !config.scopes.includes(scope))) return 'publishing-scopes-unverified';
  for (const ref of revision.sources) {
    const source = state.sources.find(packet => packet.sourceId === ref.sourceId && packet.brand === revision.brand);
    if (!source) return 'source-unavailable';
    try { parseSourcePacket(source); } catch { return 'source-invalid'; }
    if (contentHash(source.content) !== source.contentHash || source.sourceRevision !== ref.sourceRevision || source.contentHash !== ref.contentHash || !sourceUsable(source, now)) return 'source-changed-or-retired';
    const observed = Date.parse(source.observedAt);
    if (observed > now.getTime() + 60_000 || now.getTime() - observed > MARKETING_SOURCE_MAX_AGE_MS) return 'source-recheck-required';
  }
  if (Date.parse(revision.scheduledAt) > now.getTime()) return 'scheduled-time-not-due';
  if (Date.parse(revision.scheduledAt) < now.getTime() - 15 * 60_000) return 'publish-window-expired';
  if (revision.assets.some(asset => !asset.alt.trim())) return 'asset-alt-required';
  if (revision.account.platform === 'threads' && !['thread', 'post', 'carousel', 'reel'].includes(revision.format)) return 'unsupported-format';
  if (revision.account.platform === 'instagram' && !['post', 'carousel', 'reel', 'story'].includes(revision.format)) return 'unsupported-format';
  if (revision.format === 'carousel' && (revision.assets.length < 2 || revision.assets.length > 10)) return 'unsupported-carousel-size';
  if (revision.format === 'post' && revision.account.platform === 'instagram' && (revision.assets.length !== 1 || revision.assets[0]!.mimeType !== 'image/jpeg')) return 'unsupported-post-assets';
  if (revision.format === 'reel' && (revision.assets.length !== 1 || revision.assets[0]!.mimeType !== 'video/mp4')) return 'unsupported-reel-assets';
  if (revision.assets.some(asset => asset.alt.length > INSTAGRAM_ALT_TEXT_MAX)) return 'asset-alt-too-long';
  if (instagramFeed(revision)) {
    // Declared geometry is checked here; the downloaded bytes are decoded and checked again before any container exists.
    if (revision.assets.some(asset => asset.mimeType === 'image/jpeg' && !instagramFeedGeometryValid(asset.width, asset.height))) return 'asset-geometry-unsupported';
    if ((revision.caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0) > 30) return 'caption-hashtag-limit';
    if ((revision.caption.match(/(?<![\w.@])@[A-Za-z0-9._]{1,30}/g)?.length ?? 0) > 20) return 'caption-mention-limit';
  }
  const collaborators = revision.collaborators ?? [];
  if (collaborators.length) {
    if (!instagramFeed(revision) || !['post', 'carousel', 'reel'].includes(revision.format)) return 'collaborators-unsupported';
    const names = collaborators.map(normalizedHandle);
    if (names.length > INSTAGRAM_MAX_COLLABORATORS || new Set(names).size !== names.length || names.includes(normalizedHandle(account.handle))) return 'collaborators-invalid';
  }
  return null;
}

function graphBase(config: MetaPublisherConfig): string {
  const host = config.loginMode === 'threads' ? 'graph.threads.net' : config.loginMode === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
  return `https://${host}/${config.apiVersion}`;
}
class MetaFailure extends Error { constructor(readonly code: string) { super(code); } }
class CheckpointFailure extends Error {}
async function pollWait(input: PublishMarketingInput, ms: number): Promise<void> {
  input.signal?.throwIfAborted();
  if (!input.signal) return (input.wait ?? (delay => new Promise(resolve => setTimeout(resolve, delay))))(ms);
  const signal = input.signal;
  let abort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      if (input.wait) input.wait(ms).then(resolve, reject);
      else timer = setTimeout(resolve, ms);
    });
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    if (timer) clearTimeout(timer);
  }
}
async function graph(input: PublishMarketingInput, node: string, method: 'GET' | 'POST', fields: Record<string, string>) {
  input.signal?.throwIfAborted();
  const url = new URL(`${graphBase(input.config)}/${node}`);
  const requestTimeout = AbortSignal.timeout(Math.min(15000, Math.max(1000, input.config.requestTimeoutMs ?? 10000)));
  const options: RequestInit = { method, redirect: 'error', signal: input.signal ? AbortSignal.any([input.signal, requestTimeout]) : requestTimeout,
    headers: { Authorization: `Bearer ${input.config.accessToken}` } };
  if (method === 'GET') Object.entries(fields).forEach(([key, value]) => url.searchParams.set(key, value));
  else { options.body = new URLSearchParams(fields); options.headers = { ...options.headers, 'Content-Type': 'application/x-www-form-urlencoded' }; }
  let response: Response;
  try { response = await (input.fetcher ?? fetch)(url.href, options); } catch { throw new MetaFailure('meta-request-uncertain'); }
  if (!response.ok) throw new MetaFailure(`meta-http-${response.status}`);
  try {
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'error' in raw) throw new MetaFailure('meta-invalid-response');
    return raw as Record<string, unknown>;
  } catch { throw new MetaFailure('meta-invalid-response'); }
}
async function verifyRemoteAccount(input: PublishMarketingInput): Promise<string | null> {
  const story = input.revisionRow.revision.format === 'story';
  // Instagram Login distinguishes the professional account ID (`user_id`,
  // used by every publishing edge) from the app-scoped `id`; compare the former.
  const instagramLogin = input.config.loginMode === 'instagram';
  const fields = [instagramLogin ? 'id,user_id,username' : 'id,username', ...(story ? ['account_type'] : [])].join(',');
  let profile: Record<string, unknown>;
  try { profile = await graph(input, input.account.remote_account_id, 'GET', { fields }); }
  catch (error) { if (story) return 'story-business-account-unverified'; throw error; }
  const identity = instagramLogin && typeof profile.user_id === 'string' ? profile.user_id : profile.id;
  if (identity !== input.account.remote_account_id || typeof profile.username !== 'string' || profile.username.toLowerCase() !== normalizedHandle(input.account.handle)) return 'remote-account-mismatch';
  // Story publishing is restricted to Business accounts. Scopes or a stored
  // professional-account check alone cannot establish this current capability.
  if (story && (typeof profile.account_type !== 'string' || profile.account_type.toUpperCase() !== 'BUSINESS')) return 'story-business-account-unverified';
  return null;
}
async function verifyAssets(input: PublishMarketingInput): Promise<void> {
  const revision = input.revisionRow.revision;
  const story = revision.format === 'story';
  for (const asset of revision.assets) {
    input.signal?.throwIfAborted();
    const feedImage = instagramFeed(revision) && asset.mimeType === 'image/jpeg';
    const url = new URL(asset.url);
    if (url.protocol !== 'https:' || url.username || url.password || !input.config.approvedAssetHosts.includes(url.hostname)) throw new MetaFailure('asset-host-unapproved');
    let response: Response;
    try { response = await (input.fetcher ?? fetch)(url.href, { redirect: 'error', signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }); }
    catch { throw new MetaFailure('asset-unreachable'); }
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== asset.mimeType || !response.body) throw new MetaFailure('asset-mime-or-response-invalid');
    const maxBytes = story ? 8_000_000 : feedImage ? INSTAGRAM_FEED_IMAGE.maxBytes : asset.mimeType === 'image/jpeg' ? 10_000_000 : 200_000_000;
    if (Number(response.headers.get('content-length')) > maxBytes) throw new MetaFailure('asset-too-large');
    const hash = createHash('sha256'); let bytes = 0; const reader = response.body.getReader();
    const imageChunks: Uint8Array[] = [];
    try { while (true) { input.signal?.throwIfAborted(); const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new MetaFailure('asset-too-large'); } hash.update(part.value); if (story || feedImage) imageChunks.push(part.value); } }
    catch (error) { if (error instanceof MetaFailure) throw error; throw new MetaFailure('asset-unreachable'); }
    if (hash.digest('hex') !== asset.sha256) throw new MetaFailure('asset-hash-mismatch');
    if (feedImage) {
      // Meta fetches the URL itself; check the approved bytes it will receive, not the declared metadata.
      let metadata: { format?: string; width?: number; height?: number; orientation?: number; space?: string };
      let decodeImage: (() => Promise<unknown>) | undefined;
      try { const { default: sharp } = await import('sharp');
        const image = sharp(Buffer.concat(imageChunks), { failOn: 'error', limitInputPixels: 8000 * 8000 });
        metadata = await image.metadata(); decodeImage = () => image.stats();
      } catch { throw new MetaFailure('asset-image-invalid'); }
      if (metadata.format !== 'jpeg') throw new MetaFailure('asset-format-unsupported');
      if (!metadata.width || !metadata.height || !instagramFeedGeometryValid(metadata.width, metadata.height) || (metadata.orientation !== undefined && metadata.orientation !== 1)) throw new MetaFailure('asset-dimensions-unsupported');
      if (metadata.width !== asset.width || metadata.height !== asset.height) throw new MetaFailure('asset-dimensions-mismatch');
      if (metadata.space !== 'srgb') throw new MetaFailure('asset-color-space-unsupported');
      try { await decodeImage(); } catch { throw new MetaFailure('asset-image-invalid'); }
    }
    if (story) {
      // Check the downloaded approved bytes, not caller-supplied dimensions.
      let metadata: { format?: string; width?: number; height?: number; orientation?: number };
      let decodeImage: (() => Promise<unknown>) | undefined;
      try { const { default: sharp } = await import('sharp');
        const image = sharp(Buffer.concat(imageChunks), { failOn: 'error', limitInputPixels: 1080 * 1920 });
        metadata = await image.metadata(); decodeImage = () => image.stats();
      }
      catch { throw new MetaFailure('story-image-invalid'); }
      if (metadata.format !== 'jpeg') throw new MetaFailure('story-image-format-invalid');
      if (metadata.width !== 1080 || metadata.height !== 1920 || (metadata.orientation !== undefined && metadata.orientation !== 1)) throw new MetaFailure('story-image-dimensions-invalid');
      try { if (!decodeImage) throw new Error(); await decodeImage(); }
      catch { throw new MetaFailure('story-image-invalid'); }
    }
  }
}
async function containerStatus(input: PublishMarketingInput, container: string): Promise<string> {
  const threads = input.account.platform === 'threads';
  const data = await graph(input, container, 'GET', { fields: threads ? 'id,status' : 'id,status_code' });
  if (data.id !== container) throw new MetaFailure('container-identity-mismatch');
  const status = data[threads ? 'status' : 'status_code'];
  if (typeof status !== 'string' || !['FINISHED', 'IN_PROGRESS', 'PUBLISHED', 'ERROR', 'EXPIRED'].includes(status)) throw new MetaFailure('container-status-unavailable');
  return status;
}
async function mediaUrl(input: PublishMarketingInput, media: string): Promise<string | null> {
  try { const data = await graph(input, media, 'GET', { fields: 'id,permalink' });
    if (data.id !== media || typeof data.permalink !== 'string') return null;
    const url = new URL(data.permalink);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
/** Only the owned account's active Story edge can confirm a recorded media ID
 * without a stored publish acknowledgement. No URL, timestamp or image match
 * is used to guess an ID after an ambiguous publish request. */
async function verifyRecordedStory(input: PublishMarketingInput, media: string): Promise<boolean> {
  if (!/^[1-9]\d{0,99}$/.test(media) || await verifyRemoteAccount(input)) return false;
  let after: string | undefined;
  const cursors = new Set<string>();
  for (let page = 0; page < 2; page++) {
    const data = await graph(input, `${input.account.remote_account_id}/stories`, 'GET', { fields: 'id', limit: '100', ...(after ? { after } : {}) });
    if (!Array.isArray(data.data) || data.data.length > 100 || data.data.some(item => !item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || !/^[1-9]\d{0,99}$/.test(item.id))) return false;
    if (data.data.some(item => item.id === media)) return true;
    const paging = data.paging as { cursors?: { after?: unknown }; next?: unknown } | undefined;
    if (!paging?.next) return false;
    const cursor = paging.cursors?.after;
    if (typeof cursor !== 'string' || !cursor || cursor.length > 2048 || cursors.has(cursor)) return false;
    cursors.add(cursor); after = cursor;
  }
  return false;
}

/** How far before the scheduled slot the account's media list is read after an ambiguous publish. */
export const RECONCILE_LOOKBACK_MS = 5 * 60_000;
/** A publish intent is accepted at most 15 minutes after the slot; the extra 5 minutes cover the request deadline. */
export const RECONCILE_LOOKAHEAD_MS = 20 * 60_000;
const RECONCILE_CAPTION_PREFIX = 100;
const RECONCILE_PAGE_SIZE = 50;
const normalizedCaption = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const metaInstant = (value: unknown) => typeof value === 'string' ? Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : Number.NaN;
const expectedMediaType = (format: ContentRevision['format']) => format === 'carousel' ? 'CAROUSEL_ALBUM' : format === 'post' ? 'IMAGE' : format === 'reel' ? 'VIDEO' : null;
type MediaMatch = { kind: 'match'; id: string; permalink: string | null } | { kind: 'none' | 'ambiguous' | 'incomplete' | 'unavailable' };
/**
 * After an ambiguous `media_publish`, the owned account's own media list is
 * the only evidence used to recover the media ID: the same media type, a
 * timestamp inside the slot window and the approved caption as a prefix.
 * Exactly one match is required. This is a read; it never publishes.
 */
async function findPublishedFeedMedia(input: PublishMarketingInput): Promise<MediaMatch> {
  const revision = input.revisionRow.revision;
  const type = expectedMediaType(revision.format); const scheduled = Date.parse(revision.scheduledAt);
  if (!type || !Number.isFinite(scheduled)) return { kind: 'unavailable' };
  const prefix = normalizedCaption(revision.caption).slice(0, RECONCILE_CAPTION_PREFIX);
  const from = scheduled - RECONCILE_LOOKBACK_MS; const until = Math.min(scheduled + RECONCILE_LOOKAHEAD_MS, (input.now ?? new Date()).getTime() + 60_000);
  let data: Record<string, unknown>;
  try { data = await graph(input, `${input.account.remote_account_id}/media`, 'GET', { fields: 'id,caption,timestamp,permalink,media_type', since: String(Math.floor(from / 1000)), limit: String(RECONCILE_PAGE_SIZE) }); }
  catch { return { kind: 'unavailable' }; }
  if (!Array.isArray(data.data) || data.data.length > RECONCILE_PAGE_SIZE) return { kind: 'unavailable' };
  const items = data.data.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
  if (items.length !== data.data.length) return { kind: 'unavailable' };
  const matches = items.filter(item => typeof item.id === 'string' && idValid(item.id) && item.media_type === type && typeof item.caption === 'string' &&
    normalizedCaption(item.caption).startsWith(prefix) && metaInstant(item.timestamp) >= from && metaInstant(item.timestamp) <= until);
  if (matches.length > 1) return { kind: 'ambiguous' };
  const paging = data.paging as { next?: unknown } | undefined;
  if (!matches.length) return { kind: items.length === RECONCILE_PAGE_SIZE && paging?.next ? 'incomplete' : 'none' };
  const match = matches[0]!; let permalink: string | null = null;
  try { const url = typeof match.permalink === 'string' ? new URL(match.permalink) : null; permalink = url && url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { permalink = null; }
  return { kind: 'match', id: match.id as string, permalink };
}

/** This path never POSTs. A feed post whose publish was ambiguous is matched against the account's own media list. */
export async function reconcileMarketingPublication(input: PublishMarketingInput): Promise<PublishOutcome> {
  if (input.publication.user_id !== input.revisionRow.user_id || input.account.user_id !== input.revisionRow.user_id || input.publication.revision_id !== input.revisionRow.id || input.publication.platform !== input.account.platform ||
      input.account.brand !== input.revisionRow.revision.brand || input.account.remote_account_id !== input.revisionRow.revision.account.id || (input.account.platform === 'threads') !== (input.config.loginMode === 'threads')) return result('held', 'publication-binding-mismatch');
  const story = input.revisionRow.revision.format === 'story' && input.account.platform === 'instagram';
  if (story && revisionHash(input.revisionRow.revision) !== input.revisionRow.content_hash) return result('held', 'revision-identity-mismatch');
  // A persisted numeric publish acknowledgement is historical evidence even
  // after the Story expires or credentials change. It never causes a POST.
  if (publishedStoryReceipt(input.revisionRow.revision, input.publication)) return result('published', null, input.publication.remote_container_id, input.publication.remote_media_id, input.publication.remote_url);
  if (input.config.credentialHold || !/^v\d+\.\d+$/.test(input.config.apiVersion) || !timestampValid(input.config.apiVersionVerifiedAt, input.now ?? new Date()) || !input.config.accessToken || !Number.isFinite(Date.parse(input.config.tokenExpiresAt)) || Date.parse(input.config.tokenExpiresAt) <= (input.now ?? new Date()).getTime()) return result('held', 'reconciliation-credentials-unavailable', input.publication.remote_container_id);
  const { remote_container_id: container, remote_media_id: media } = input.publication;
  if (idValid(media)) {
    if (story) {
      try { return await verifyRecordedStory(input, media) ? result('published', null, container, media) : result('reconciliation', 'remote-story-unverified', container, media); }
      catch { return result('reconciliation', 'remote-story-unverified', container, media); }
    }
    const url = await mediaUrl(input, media);
    return result(url ? 'published' : 'reconciliation', url ? null : 'remote-permalink-unavailable', container, media, url);
  }
  if (!idValid(container)) return result('reconciliation', 'container-identity-unavailable', container);
  let status: string | null = null;
  try { status = await containerStatus(input, container); } catch { status = null; }
  // FINISHED, IN_PROGRESS, ERROR and EXPIRED all say this container was not
  // published, so a similar post in the list cannot be ours.
  if (instagramFeed(input.revisionRow.revision) && (status === 'PUBLISHED' || status === null)) {
    const found = await findPublishedFeedMedia(input);
    if (found.kind === 'match') {
      const url = found.permalink ?? await mediaUrl(input, found.id);
      return result(url ? 'published' : 'reconciliation', url ? null : 'remote-permalink-unavailable', container, found.id, url);
    }
    if (found.kind === 'ambiguous') return result('reconciliation', 'remote-media-match-ambiguous', container);
    if (found.kind === 'incomplete') return result('reconciliation', 'remote-media-list-incomplete', container);
  }
  if (status === null) return result('reconciliation', 'remote-status-unavailable', container);
  return result('reconciliation', status === 'PUBLISHED' ? 'remote-published-media-id-required' : `remote-container-${status.toLowerCase()}`, container);
}

export async function publishMarketingRevision(input: PublishMarketingInput): Promise<PublishOutcome> {
  const deadline = AbortSignal.timeout(50000);
  input = { ...input, signal: input.signal ? AbortSignal.any([input.signal, deadline]) : deadline };
  const clock = () => input.now ?? new Date();
  const previous = input.publication;
  if (previous.user_id !== input.revisionRow.user_id || previous.revision_id !== input.revisionRow.id || previous.platform !== input.account.platform) return result('held', 'publication-binding-mismatch');
  if (previous.status === 'published' || previous.remote_media_id || previous.status === 'reconciliation' || previous.error_code === 'publish-intent' || previous.remote_container_id?.startsWith('intent:')) return reconcileMarketingPublication(input);
  const gate = publicationGate(input, input.config, clock());
  if (gate) return result('held', gate, previous.remote_container_id);
  if (input.dryRun !== false) return result('dry-run', null, previous.remote_container_id);
  if (previous.status !== 'claimed' || !previous.lease_until || !Number.isFinite(Date.parse(previous.lease_until)) || Date.parse(previous.lease_until) <= clock().getTime()) return result('held', 'publication-claim-required');
  const revision = input.revisionRow.revision;
  let container = previous.remote_container_id;
  let media = previous.remote_media_id;
  let remoteUrl = previous.remote_url;
  let sideEffectStarted = false;
  const save = async (stage: PublisherCheckpoint['stage'], outcome: PublishOutcome) => {
    try { await input.checkpoint({ stage, ...outcome }); } catch { throw new CheckpointFailure(); }
  };
  try {
    const accountGate = await verifyRemoteAccount(input);
    if (accountGate) return result('held', accountGate, container);
    await verifyAssets(input);
    const threads = input.account.platform === 'threads';
    const quota = await graph(input, `${input.account.remote_account_id}/${threads ? 'threads_publishing_limit' : 'content_publishing_limit'}`, 'GET', { fields: 'quota_usage,config' });
    const limit = Array.isArray(quota.data) ? quota.data[0] as Record<string, unknown> | undefined : quota;
    const quotaConfig = limit?.config;
    const total = quotaConfig && typeof quotaConfig === 'object' && 'quota_total' in quotaConfig ? quotaConfig.quota_total : null;
    // The provider's quota_total is authoritative (the reference documents 50
    // per 24 hours, the guide 100); no number is assumed when it is absent.
    if (!limit || typeof limit.quota_usage !== 'number' || !Number.isInteger(limit.quota_usage) || limit.quota_usage < 0 || typeof total !== 'number' || !Number.isInteger(total) || total <= 0) return result('held', 'publishing-quota-unavailable', container);
    if (limit.quota_usage >= total) return result('held', 'publishing-quota-exhausted', container);
    const createPath = `${input.account.remote_account_id}/${threads ? 'threads' : 'media'}`;
    const create = async (params: Record<string, string>) => {
      const data = await graph(input, createPath, 'POST', params);
      if (!idValid(data.id as string)) throw new MetaFailure('container-identity-unavailable'); return data.id as string;
    };
    if (!container) {
      container = `intent:${revisionHash(revision)}`;
      await save('container-create-intent', result('pending', 'container-create-intent', container));
      sideEffectStarted = true;
      // Story text is rendered in the JPEG. The stored caption is internal
      // review copy; it is never sent as a public Story caption or alt_text.
      const fields: Record<string, string> = revision.format === 'story' ? {} : { [threads ? 'text' : 'caption']: revision.caption };
      // Instagram accepts alt_text on image containers only; Threads takes it for images and videos.
      const altText = (asset: ContentRevision['assets'][number]): Record<string, string> => threads || asset.mimeType === 'image/jpeg' ? { alt_text: asset.alt } : {};
      if (revision.format === 'story') {
        Object.assign(fields, { media_type: 'STORIES', image_url: revision.assets[0]!.url });
      } else if (revision.format === 'carousel') {
        const children: string[] = [];
        for (const asset of revision.assets) children.push(await create({ ...(asset.mimeType === 'video/mp4' ? { media_type: 'VIDEO' } : threads ? { media_type: 'IMAGE' } : {}),
          [asset.mimeType === 'video/mp4' ? 'video_url' : 'image_url']: asset.url, is_carousel_item: 'true', ...altText(asset) }));
        Object.assign(fields, { media_type: 'CAROUSEL', children: children.join(',') });
      } else if (revision.assets[0]) {
        // An Instagram single image is the default container type: image_url without media_type or children.
        const asset = revision.assets[0]; fields[asset.mimeType === 'video/mp4' ? 'video_url' : 'image_url'] = asset.url;
        if (asset.mimeType === 'video/mp4') fields.media_type = threads ? 'VIDEO' : 'REELS';
        else if (threads) fields.media_type = 'IMAGE';
        Object.assign(fields, altText(asset));
      } else fields.media_type = 'TEXT';
      // Co-authors go on the post itself, never on carousel children, and only when the revision records them.
      if (instagramFeed(revision) && revision.collaborators?.length) fields.collaborators = JSON.stringify(revision.collaborators);
      // auto_publish_text is omitted: container creation cannot approve or publish a thread.
      container = await create(fields);
      await save('container-created', result('pending', 'container-pending', container));
    }
    if (!idValid(container)) throw new MetaFailure('container-identity-unavailable');
    const attempts = Math.max(1, Math.min(3, input.config.pollAttempts ?? 3));
    let status = 'IN_PROGRESS';
    for (let attempt = 0; attempt < attempts; attempt++) {
      status = await containerStatus(input, container);
      if (status !== 'IN_PROGRESS') break;
      if (attempt + 1 < attempts) await pollWait(input, Math.max(0, Math.min(1000, input.config.pollIntervalMs ?? 1000)));
    }
    if (status === 'IN_PROGRESS') return result('pending', 'container-pending', container);
    if (status === 'ERROR' || status === 'EXPIRED') {
      // No media_publish was ever sent for this container on this path, so a
      // failed container is a definite failure rather than an ambiguity.
      const outcome = result('failed', `container-${status.toLowerCase()}`, container);
      await save('outcome', outcome);
      return outcome;
    }
    if (status !== 'FINISHED') return result('reconciliation', 'remote-published-media-id-required', container);
    const fresh = await input.revalidate();
    const refreshedGate = publicationGate(fresh, input.config, clock());
    if (refreshedGate || revisionHash(fresh.revisionRow.revision) !== revisionHash(revision) || fresh.account.remote_account_id !== input.account.remote_account_id) return result('held', refreshedGate ?? 'approval-changed-before-publish', container);
    if (revision.format === 'story') {
      const storyAccountGate = await verifyRemoteAccount({ ...input, ...fresh });
      if (storyAccountGate) return result('held', storyAccountGate, container);
    }
    input.signal?.throwIfAborted();
    await save('publish-intent', result('pending', 'publish-intent', container));
    sideEffectStarted = true;
    const published = await graph(input, `${input.account.remote_account_id}/${threads ? 'threads_publish' : 'media_publish'}`, 'POST', { creation_id: container });
    if (!idValid(published.id as string) || (revision.format === 'story' && !/^[1-9]\d{0,99}$/.test(published.id as string))) throw new MetaFailure('published-media-identity-unavailable');
    media = published.id as string;
    if (revision.format === 'story') {
      const outcome = result('published', null, container, media);
      await save('outcome', outcome);
      return outcome;
    }
    // A deadline during the following read must leave the known remote media durable.
    await save('outcome', result('reconciliation', 'remote-permalink-unavailable', container, media));
    remoteUrl = await mediaUrl(input, media);
    const outcome = result(remoteUrl ? 'published' : 'reconciliation', remoteUrl ? null : 'remote-permalink-unavailable', container, media, remoteUrl);
    if (!remoteUrl) return outcome;
    await save('outcome', outcome);
    return outcome;
  } catch (error) {
    if (error instanceof CheckpointFailure) return result(sideEffectStarted ? 'reconciliation' : 'held', 'checkpoint-fence-lost', sideEffectStarted ? container : previous.remote_container_id, media, remoteUrl);
    const outcome = result(sideEffectStarted || previous.remote_container_id ? 'reconciliation' : 'failed', error instanceof MetaFailure ? error.code : input.signal?.aborted ? 'publication-deadline-exceeded' : 'checkpoint-or-revalidation-failed', container, media, remoteUrl);
    try { await save('outcome', outcome); } catch { /* The initial durable intent still prevents a replay after a receipt write fails. */ }
    return outcome;
  }
}
