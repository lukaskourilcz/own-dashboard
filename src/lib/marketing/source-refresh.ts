import 'server-only';
import { parseSourcePacket, sourceUsable, type MarketingBrand, type SourcePacket } from './contracts';
import { contentHash } from './hashes';
import { signAutomationBody } from './automation-auth';
import { MARKETING_SOURCE_MAX_AGE_MS } from './publisher';

export type SourceRefreshConfig = { url: string; secret: string };
export type SourceRefreshResult = { packets: SourcePacket[]; held: Array<{ sourceId: string; reason: string }>;
  observedAt: string; noEditionDates: string[]; nextCursor: string | null; dropped: number };
export type SourceRefreshOptions = { config?: SourceRefreshConfig; fetcher?: typeof fetch; now?: Date; signal?: AbortSignal };
export class SourceRefreshError extends Error { constructor(readonly code: string) { super(code); } }

export function sourceRefreshConfig(brand: MarketingBrand, env: Record<string, string | undefined> = process.env): SourceRefreshConfig {
  const prefix = brand === 'dneskai' ? 'MARKETING_DNESKAI' : 'MARKETING_DEVSHARK';
  const url = env[`${prefix}_SOURCE_URL`];
  const secret = env[`${prefix}_SOURCE_SECRET`];
  if (!url || !secret || secret.length < 32) throw new SourceRefreshError('source-integration-unconfigured');
  return { url, secret };
}
function endpoint(config: SourceRefreshConfig): URL {
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || config.secret.length < 32) throw new SourceRefreshError('source-integration-invalid');
  return url;
}
function canonicalDailyDate(url: string): string | null {
  const path = new URL(url).pathname;
  const date = /^\/daily\/(\d{4}-\d{2}-\d{2})\/?$/.exec(path)?.[1];
  if (!date) return null;
  if (!Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new SourceRefreshError('daily-source-date-invalid');
  return date;
}
async function request(input: SourceRefreshOptions, url: URL, options: RequestInit): Promise<unknown> {
  let response: Response;
  try { response = await (input.fetcher ?? fetch)(url.href, { ...options, redirect: 'error',
    signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) }); }
  catch { throw new SourceRefreshError('source-current-unavailable'); }
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
  const config = input.config ?? sourceRefreshConfig(input.brand);
  const base = endpoint(config);
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
    const raw = await request(input, base, { method: 'POST', body, headers: signAutomationBody(body, config.secret, now.getTime()) });
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
    const raw = await request(input, url, { headers: { Authorization: `Bearer ${config.secret}`, Accept: 'application/json' } });
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
