import 'server-only';
import { request as httpsRequest } from 'node:https';
import { parseSourcePacket, sourceUsable, type MarketingBrand, type SourcePacket } from './contracts';
import { contentHash } from './hashes';
import { signAutomationBody } from './automation-auth';
import { MARKETING_SOURCE_MAX_AGE_MS } from './publisher';
import { marketingPilotConfiguration } from './pilot';
import { dneskaiCollectionPilotConfiguration } from './dneskai-pilot';
import { previewPilotRetired } from './preview-pilot';

type SourcePreviewShare = { token: string; origin: string };
export type SourceRefreshConfig = { url: string; secret: string; previewShare?: SourcePreviewShare };
export type SourceRefreshResult = { packets: SourcePacket[]; held: Array<{ sourceId: string; reason: string }>;
  observedAt: string; noEditionDates: string[]; nextCursor: string | null; dropped: number };
export type SourceRefreshOptions = { config?: SourceRefreshConfig; fetcher?: typeof fetch; now?: Date; signal?: AbortSignal; env?: Record<string, string | undefined> };
export class SourceRefreshError extends Error { constructor(readonly code: string) { super(code); } }

export function sourceRefreshConfig(brand: MarketingBrand, env: Record<string, string | undefined> = process.env): SourceRefreshConfig {
  const prefix = brand === 'dneskai' ? 'MARKETING_DNESKAI' : 'MARKETING_DEVSHARK';
  const url = env[`${prefix}_SOURCE_URL`];
  const secret = env[`${prefix}_SOURCE_SECRET`];
  if (!url || !secret || secret.length < 32) throw new SourceRefreshError('source-integration-unconfigured');
  const token = env[`${prefix}_SOURCE_PREVIEW_SHARE_TOKEN`], origin = env[`${prefix}_SOURCE_PREVIEW_ORIGIN`];
  // Outside Preview the retired share is never sent; the request is the ordinary signed one.
  if ((token === undefined && origin === undefined) || previewPilotRetired('source-preview', env)) return { url, secret };
  if (!token || !origin) throw new SourceRefreshError('source-preview-configuration-invalid');
  const config = { url, secret, previewShare: { token, origin } };
  validatePreviewShare(config.previewShare, endpoint(config), env);
  return config;
}
function endpoint(config: SourceRefreshConfig): URL {
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || config.secret.length < 32) throw new SourceRefreshError('source-integration-invalid');
  return url;
}
function validatePreviewShare(access: SourcePreviewShare, url: URL, env: Record<string, string | undefined>, collectionScope?: {owner:string;project:string}): void {
  try {
    const origin = new URL(access.origin);
    if (access.origin !== origin.origin || origin.protocol !== 'https:' || origin.port || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(origin.hostname)
      || origin.username || origin.password || url.origin !== access.origin || url.searchParams.has('_vercel_share') || url.searchParams.has('x-vercel-protection-bypass')
      || !/^[\x21-\x7e]{1,2048}$/.test(access.token)) throw new Error();
    if (env.VERCEL_ENV !== 'preview' || !(collectionScope?dneskaiCollectionPilotConfiguration(collectionScope.owner,collectionScope.project,env):marketingPilotConfiguration(env.MARKETING_OWNER_ID ?? '', env))) throw new Error();
  } catch { throw new SourceRefreshError('source-preview-configuration-invalid'); }
}
function responsePreviewCookie(response: Response, url: URL): string {
  // Consume only Vercel's one response cookie; never a caller/browser cookie jar.
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (values.length !== 1 || values[0].length > 10000) throw new SourceRefreshError('source-preview-cookie-invalid');
  const [cookie, ...attributes] = values[0].split(';').map(value => value.trim());
  if (!/^_vercel_jwt=[A-Za-z0-9._~-]{1,8192}$/.test(cookie)) throw new SourceRefreshError('source-preview-cookie-invalid');
  const flags = attributes.map(attribute => attribute.toLowerCase());
  const domain = flags.find(attribute => attribute.startsWith('domain='))?.slice(7);
  if (!flags.includes('secure') || !flags.includes('httponly') || !flags.includes('path=/') || (domain && domain !== url.hostname && domain !== `.${url.hostname}`)) throw new SourceRefreshError('source-preview-cookie-invalid');
  return cookie;
}
/** Avoid Next's fetch URL/cache metrics for the credential-bearing preflight. */
function nativeProtectedRequest(url: string, options: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest(url, { method: options.method ?? 'GET', headers: Object.fromEntries(new Headers(options.headers)), signal: options.signal ?? undefined }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('error', reject);
      response.on('data', (value: Buffer) => {
        bytes += value.length;
        if (bytes > 2_000_000) { response.destroy(); outgoing.destroy(); reject(new SourceRefreshError('source-response-too-large')); return; }
        chunks.push(value);
      });
      response.on('end', () => {
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, item);
          resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 502, headers }));
        } catch { reject(new SourceRefreshError('source-response-invalid')); }
      });
    });
    outgoing.on('error', reject);
    if (typeof options.body === 'string') outgoing.write(options.body);
    outgoing.end(); // Native HTTPS never follows a redirect or stores cookies.
  });
}
async function protectedRequest(input: SourceRefreshOptions, url: string, options: RequestInit): Promise<Response> {
  const { suppressTracing, withIsolationScope } = await import('@sentry/nextjs');
  return withIsolationScope(scope => {
    scope.clear(); scope.addEventProcessor(() => null);
    return suppressTracing(() => (input.fetcher ?? nativeProtectedRequest)(url, options));
  });
}
async function previewCookie(input: SourceRefreshOptions, url: URL, access: SourcePreviewShare, signal: AbortSignal, collectionScope?: {owner:string;project:string}): Promise<string> {
  const env = input.env ?? process.env;
  validatePreviewShare(access, url, env,collectionScope);
  const preflight = new URL(url); preflight.searchParams.set('_vercel_share', access.token);
  let response: Response;
  try { response = await protectedRequest(input, preflight.href, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal }); }
  catch { throw new SourceRefreshError('source-preview-unavailable'); }
  const location = response.headers.get('location');
  try {
    if (response.status !== 307 || response.redirected || !location || new URL(location, preflight).href !== url.href) throw new Error();
  } catch { throw new SourceRefreshError('source-preview-redirect-invalid'); }
  const cookie = responsePreviewCookie(response, url);
  validatePreviewShare(access, url, env,collectionScope); // A slow preflight cannot cross the approved pilot expiry.
  if (signal.aborted) throw new SourceRefreshError('source-preview-unavailable');
  return cookie;
}
/** Exact configured bridge only, with independent active collection-pilot authorization. Cookie remains invocation-local. */
export async function requestDneskaiCollectionPreview(url:URL,init:RequestInit,input:SourceRefreshOptions,owner:string,project:string):Promise<Response>{
 const env=input.env??process.env;
 if(!dneskaiCollectionPilotConfiguration(owner,project,env,input.now??new Date()))throw new SourceRefreshError('source-preview-configuration-invalid');
 const base=new URL(env.MARKETING_DNESKAI_SOURCE_URL??'');
 if(url.href!==`${base.origin}/admin/api/marketing-collection`)throw new SourceRefreshError('source-preview-configuration-invalid');
 const token=env.MARKETING_DNESKAI_SOURCE_PREVIEW_SHARE_TOKEN,origin=env.MARKETING_DNESKAI_SOURCE_PREVIEW_ORIGIN;
 if(!token||!origin)throw new SourceRefreshError('source-preview-configuration-invalid');
 const signal=input.signal??AbortSignal.timeout(8000),headers=new Headers(init.headers);
 headers.set('Cookie',await previewCookie(input,url,{token,origin},signal,{owner,project}));
 const response=await protectedRequest(input,url.href,{...init,headers,signal,redirect:'error',credentials:'omit',cache:'no-store'});
 if(response.redirected||(response.url&&response.url!==url.href)||response.status>=300&&response.status<400)throw new SourceRefreshError('source-current-unavailable');return response;
}
function canonicalDailyDate(url: string): string | null {
  const path = new URL(url).pathname;
  const date = /^\/daily\/(\d{4}-\d{2}-\d{2})\/?$/.exec(path)?.[1];
  if (!date) return null;
  if (!Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new SourceRefreshError('daily-source-date-invalid');
  return date;
}
async function request(input: SourceRefreshOptions, url: URL, options: RequestInit, config: SourceRefreshConfig): Promise<unknown> {
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  const headers = new Headers(options.headers);
  if (config.previewShare) headers.set('Cookie', await previewCookie(input, url, config.previewShare, signal));
  let response: Response;
  try {
    const init: RequestInit = { ...options, ...(config.previewShare ? { headers, credentials: 'omit', cache: 'no-store' } : {}), redirect: 'error', signal };
    response = config.previewShare ? await protectedRequest(input, url.href, init) : await (input.fetcher ?? fetch)(url.href, init);
  }
  catch { throw new SourceRefreshError('source-current-unavailable'); }
  if (config.previewShare && (response.redirected || (response.url && response.url !== url.href))) throw new SourceRefreshError('source-current-unavailable');
  if (response.status === 409) throw new SourceRefreshError('source-cursor-stale');
  if (response.status === 410) throw new SourceRefreshError('source-removed');
  if (!response.ok) throw new SourceRefreshError('source-current-unavailable');
  if (Number(response.headers.get('content-length')) > 2_000_000) throw new SourceRefreshError('source-response-too-large');
  try {
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 2_000_000) throw new Error();
    return JSON.parse(raw) as unknown;
  } catch { throw new SourceRefreshError('source-response-invalid'); }
}
function validatedPacket(raw: unknown, brand: MarketingBrand, now: Date): SourcePacket {
  const packet = parseSourcePacket(raw);
  if (packet.brand !== brand || contentHash(packet.content) !== packet.contentHash) throw new SourceRefreshError('source-packet-invalid');
  if ((brand === 'dneskai' && packet.kind !== 'article') || (brand === 'devshark' && !['question', 'coding-task'].includes(packet.kind))) throw new SourceRefreshError('source-kind-invalid');
  const observed = Date.parse(packet.observedAt);
  if (observed > now.getTime() + 60000 || observed < now.getTime() - MARKETING_SOURCE_MAX_AGE_MS) throw new SourceRefreshError('source-observation-stale');
  return packet;
}

/** An unavailable live read throws; a stored source head is never a refresh fallback. */
export async function refreshMarketingSources(input: SourceRefreshOptions & { brand: MarketingBrand; sourceIds?: string[];
  previousPackets?: SourcePacket[]; date?: string; cursor?: string }): Promise<SourceRefreshResult> {
  const deadline = AbortSignal.timeout(50000);
  input = { ...input, signal: input.signal ? AbortSignal.any([input.signal, deadline]) : deadline };
  const now = input.now ?? new Date();
  const config = input.config ?? sourceRefreshConfig(input.brand, input.env);
  const base = endpoint(config);
  if (config.previewShare) validatePreviewShare(config.previewShare, base, input.env ?? process.env);
  if (input.sourceIds && (!input.sourceIds.length || input.sourceIds.length > 20 || input.sourceIds.some(id => !id || id.length > 200))) throw new SourceRefreshError('source-query-invalid');
  const result: SourceRefreshResult = { packets: [], held: [], observedAt: now.toISOString(), noEditionDates: [], nextCursor: null, dropped: 0 };
  const append = (value: unknown, expectedId?: string) => {
    try {
      const packet = validatedPacket(value, input.brand, now);
      if (expectedId && packet.sourceId !== expectedId) { result.held.push({ sourceId: expectedId, reason: 'source-identity-changed' }); return; }
      result.packets.push(packet);
      if (!sourceUsable(packet, now)) result.held.push({ sourceId: packet.sourceId, reason: packet.eligible ? 'source-expired' : 'source-ineligible' });
    } catch { result.dropped++; if (expectedId) result.held.push({ sourceId: expectedId, reason: 'source-packet-invalid' }); }
  };
  if (input.brand === 'dneskai') {
    if (base.pathname !== '/admin/api/marketing-source' || base.search) throw new SourceRefreshError('source-integration-invalid');
    const body = JSON.stringify({ action: 'sources', ...(input.sourceIds ? { sourceIds: input.sourceIds } : {}) });
    const raw = await request(input, base, { method: 'POST', body, headers: signAutomationBody(body, config.secret, now.getTime()) }, config);
    if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw) || raw.schemaVersion !== 'marketing-source-query/1' || !('sources' in raw) || !Array.isArray(raw.sources) || raw.sources.length > 20 || !('brand' in raw) || raw.brand !== 'dneskai') throw new SourceRefreshError('source-response-invalid');
    const seen = new Set<string>();
    for (const row of raw.sources) {
      if (!row || typeof row !== 'object' || typeof row.sourceId !== 'string') { result.dropped++; continue; }
      if (input.sourceIds && !input.sourceIds.includes(row.sourceId)) { result.dropped++; continue; }
      seen.add(row.sourceId);
      if (!row.packet) { result.held.push({ sourceId: row.sourceId, reason: 'article-not-approved-or-unavailable' }); continue; }
      if (row.status !== 'approved' && row.packet.eligible !== false) { result.held.push({ sourceId: row.sourceId, reason: 'article-not-approved-or-unavailable' }); continue; }
      append(row.packet, row.sourceId);
    }
    for (const id of input.sourceIds ?? []) if (!seen.has(id)) result.held.push({ sourceId: id, reason: 'source-unavailable' });
    if ('noEditionDates' in raw && Array.isArray(raw.noEditionDates)) result.noEditionDates = raw.noEditionDates.filter((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)).slice(0, 20);
    return result;
  }
  const query = async (sourceId?: string) => {
    const url = new URL(base); url.searchParams.set('resource', 'marketing-source'); url.searchParams.set('limit', '20');
    url.searchParams.delete('sourceId'); url.searchParams.delete('daily'); url.searchParams.delete('cursor');
    const previous = input.previousPackets?.find(packet => packet.sourceId === sourceId);
    const daily = previous ? canonicalDailyDate(previous.canonicalUrl) : sourceId ? undefined : input.date;
    if (daily) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(daily) || !Number.isFinite(Date.parse(`${daily}T00:00:00Z`)) || new Date(`${daily}T00:00:00Z`).toISOString().slice(0, 10) !== daily) throw new SourceRefreshError('daily-source-date-invalid');
      url.searchParams.set('daily', daily);
    } else if (sourceId) url.searchParams.set('sourceId', sourceId);
    else if (input.cursor) url.searchParams.set('cursor', input.cursor);
    const raw = await request(input, url, { headers: { Authorization: `Bearer ${config.secret}`, Accept: 'application/json' } }, config);
    if (!raw || typeof raw !== 'object' || !('packets' in raw) || !Array.isArray(raw.packets) || raw.packets.length > 20) throw new SourceRefreshError('source-response-invalid');
    if (sourceId && raw.packets.length !== 1) { result.held.push({ sourceId, reason: 'source-unavailable' }); return; }
    for (const packet of raw.packets) append(packet, sourceId);
    if ('nextCursor' in raw && typeof raw.nextCursor === 'string' && raw.nextCursor.length <= 1000) result.nextCursor = raw.nextCursor;
  };
  if (input.sourceIds) {
    const ids = [...new Set(input.sourceIds)];
    for (let offset = 0; offset < ids.length; offset += 4) await Promise.all(ids.slice(offset, offset + 4).map(query));
  }
  else await query();
  return result;
}

export async function refreshSource(source: SourcePacket, signal: AbortSignal, options: SourceRefreshOptions = {}): Promise<SourcePacket> {
  const refreshed = await refreshMarketingSources({ ...options, signal, brand: source.brand, sourceIds: [source.sourceId], previousPackets: [source] });
  const packet = refreshed.packets.find(packet => packet.sourceId === source.sourceId);
  if (!packet || refreshed.dropped) throw new SourceRefreshError('source-recheck-unavailable');
  return packet;
}
