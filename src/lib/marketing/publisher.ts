import 'server-only';
import { createHash } from 'node:crypto';
import { parseContentRevision, parseSourcePacket, revisionReadiness, sourceUsable, type MarketingRevisionRow, type PublicationRow, type SourcePacket, type ContentRevision } from './contracts';
import { contentHash, revisionHash } from './hashes';

export const MARKETING_SOURCE_MAX_AGE_MS = 15 * 60_000;
export type MarketingPublishAccount = { id: string; user_id: string; brand: ContentRevision['brand']; platform: ContentRevision['account']['platform'];
  remote_account_id: string; handle: string; verified_at: string | null; enabled: boolean };
export type MetaPublisherConfig = { enabled: boolean; apiVersion: string; apiVersionVerifiedAt: string;
  loginMode: 'instagram' | 'facebook' | 'threads'; accessToken: string; tokenExpiresAt: string;
  scopes: string[]; approvedAssetHosts: string[]; pollAttempts?: number; pollIntervalMs?: number; requestTimeoutMs?: number };
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
  if (!config.accessToken || !Number.isFinite(Date.parse(config.tokenExpiresAt)) || Date.parse(config.tokenExpiresAt) <= now.getTime()) return 'credentials-expired-or-missing';
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
  let profile: Record<string, unknown>;
  try { profile = await graph(input, input.account.remote_account_id, 'GET', { fields: story ? 'id,username,account_type' : 'id,username' }); }
  catch (error) { if (story) return 'story-business-account-unverified'; throw error; }
  if (profile.id !== input.account.remote_account_id || typeof profile.username !== 'string' || profile.username.toLowerCase() !== input.account.handle.replace(/^@/, '').toLowerCase()) return 'remote-account-mismatch';
  // Story publishing is restricted to Business accounts. Scopes or a stored
  // professional-account check alone cannot establish this current capability.
  if (story && (typeof profile.account_type !== 'string' || profile.account_type.toUpperCase() !== 'BUSINESS')) return 'story-business-account-unverified';
  return null;
}
async function verifyAssets(input: PublishMarketingInput): Promise<void> {
  const story = input.revisionRow.revision.format === 'story';
  for (const asset of input.revisionRow.revision.assets) {
    input.signal?.throwIfAborted();
    const url = new URL(asset.url);
    if (url.protocol !== 'https:' || url.username || url.password || !input.config.approvedAssetHosts.includes(url.hostname)) throw new MetaFailure('asset-host-unapproved');
    let response: Response;
    try { response = await (input.fetcher ?? fetch)(url.href, { redirect: 'error', signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }); }
    catch { throw new MetaFailure('asset-unreachable'); }
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== asset.mimeType || !response.body) throw new MetaFailure('asset-mime-or-response-invalid');
    const maxBytes = story ? 8_000_000 : asset.mimeType === 'image/jpeg' ? 10_000_000 : 200_000_000;
    if (Number(response.headers.get('content-length')) > maxBytes) throw new MetaFailure('asset-too-large');
    const hash = createHash('sha256'); let bytes = 0; const reader = response.body.getReader();
    const imageChunks: Uint8Array[] = [];
    try { while (true) { input.signal?.throwIfAborted(); const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new MetaFailure('asset-too-large'); } hash.update(part.value); if (story) imageChunks.push(part.value); } }
    catch (error) { if (error instanceof MetaFailure) throw error; throw new MetaFailure('asset-unreachable'); }
    if (hash.digest('hex') !== asset.sha256) throw new MetaFailure('asset-hash-mismatch');
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

/** This path never POSTs: PUBLISHED without a media ID remains a reconciliation for the operator. */
export async function reconcileMarketingPublication(input: PublishMarketingInput): Promise<PublishOutcome> {
  if (input.publication.user_id !== input.revisionRow.user_id || input.account.user_id !== input.revisionRow.user_id || input.publication.revision_id !== input.revisionRow.id || input.publication.platform !== input.account.platform ||
      input.account.brand !== input.revisionRow.revision.brand || input.account.remote_account_id !== input.revisionRow.revision.account.id || (input.account.platform === 'threads') !== (input.config.loginMode === 'threads')) return result('held', 'publication-binding-mismatch');
  if (!/^v\d+\.\d+$/.test(input.config.apiVersion) || !timestampValid(input.config.apiVersionVerifiedAt, input.now ?? new Date()) || !input.config.accessToken || !Number.isFinite(Date.parse(input.config.tokenExpiresAt)) || Date.parse(input.config.tokenExpiresAt) <= (input.now ?? new Date()).getTime()) return result('held', 'reconciliation-credentials-unavailable', input.publication.remote_container_id);
  const { remote_container_id: container, remote_media_id: media } = input.publication;
  if (idValid(media)) {
    const url = await mediaUrl(input, media);
    return result(url ? 'published' : 'reconciliation', url ? null : 'remote-permalink-unavailable', container, media, url);
  }
  if (!idValid(container)) return result('reconciliation', 'container-identity-unavailable', container);
  try { const status = await containerStatus(input, container);
    return result('reconciliation', status === 'PUBLISHED' ? 'remote-published-media-id-required' : `remote-container-${status.toLowerCase()}`, container);
  } catch { return result('reconciliation', 'remote-status-unavailable', container); }
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
    if (!limit || typeof limit.quota_usage !== 'number' || !Number.isInteger(limit.quota_usage) || limit.quota_usage < 0 || typeof total !== 'number' || !Number.isInteger(total) || total <= limit.quota_usage) return result('held', 'publishing-quota-unavailable-or-exhausted', container);
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
      if (revision.format === 'story') {
        Object.assign(fields, { media_type: 'STORIES', image_url: revision.assets[0]!.url });
      } else if (revision.format === 'carousel') {
        const children: string[] = [];
        for (const asset of revision.assets) children.push(await create({ ...(asset.mimeType === 'video/mp4' ? { media_type: 'VIDEO' } : threads ? { media_type: 'IMAGE' } : {}),
          [asset.mimeType === 'video/mp4' ? 'video_url' : 'image_url']: asset.url, is_carousel_item: 'true', alt_text: asset.alt }));
        Object.assign(fields, { media_type: 'CAROUSEL', children: children.join(',') });
      } else if (revision.assets[0]) {
        const asset = revision.assets[0]; fields[asset.mimeType === 'video/mp4' ? 'video_url' : 'image_url'] = asset.url;
        if (asset.mimeType === 'video/mp4') fields.media_type = threads ? 'VIDEO' : 'REELS';
        else if (threads) fields.media_type = 'IMAGE';
        fields.alt_text = asset.alt;
      } else fields.media_type = 'TEXT';
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
    if (status !== 'FINISHED') return result('reconciliation', status === 'PUBLISHED' ? 'remote-published-media-id-required' : 'container-unpublishable', container);
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
    if (!idValid(published.id as string)) throw new MetaFailure('published-media-identity-unavailable');
    media = published.id as string;
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
