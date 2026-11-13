import 'server-only';
import { parseSourcePacket, sourceUsable, type MarketingBrand, type SourcePacket } from './contracts';
import { contentHash } from './hashes';
import { MARKETING_SOURCE_MAX_AGE_MS } from './publisher';
import { createAdminClient } from '@/lib/supabase/admin';
import { DneskaiBriefSourceError, refreshDneskaiBriefPacket, type DneskaiBriefDatabase } from './dneskai-brief-source';
import { DEVSHARK_DRAFT_SOURCE_PREFIX, discoverDevsharkDraftPackets, refreshDevsharkDraftPacket } from './devshark-source';

export type SourceRefreshResult = { packets: SourcePacket[]; held: Array<{ sourceId: string; reason: string }>;
  observedAt: string; noEditionDates: string[]; nextCursor: string | null; dropped: number };
/**
 * `owner` (and optionally `db`) scope a DNESKAi brief refresh (#115): a brief is re-read from the owner's
 * `marketing_dneskai_briefs`, never from the Quorum bridge. Without an owner a brief source is held.
 */
export type SourceRefreshOptions = { now?: Date; signal?: AbortSignal; owner?: string; db?: DneskaiBriefDatabase };
export class SourceRefreshError extends Error { constructor(readonly code: string) { super(code); } }

function validatedPacket(raw: unknown, brand: MarketingBrand, now: Date, local = false): SourcePacket {
  const packet = parseSourcePacket(raw);
  if (packet.brand !== brand || contentHash(packet.content) !== packet.contentHash) throw new SourceRefreshError('source-packet-invalid');
  // Every source is local now: a DNESKAi brief from the brief store, a devShark concept from the concept store.
  if ((brand === 'dneskai' && packet.kind !== (local ? 'brief' : 'article')) || (brand === 'devshark' && !['question', 'coding-task'].includes(packet.kind))) throw new SourceRefreshError('source-kind-invalid');
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
  if (input.sourceIds && (!input.sourceIds.length || input.sourceIds.length > 20 || input.sourceIds.some(id => !id || id.length > 200))) throw new SourceRefreshError('source-query-invalid');
  const result: SourceRefreshResult = { packets: [], held: [], observedAt: now.toISOString(), noEditionDates: [], nextCursor: null, dropped: 0 };
  const append = (value: unknown, expectedId?: string, local = false) => {
    try {
      const packet = validatedPacket(value, input.brand, now, local);
      if (expectedId && packet.sourceId !== expectedId) { result.held.push({ sourceId: expectedId, reason: 'source-identity-changed' }); return; }
      result.packets.push(packet);
      if (!sourceUsable(packet, now)) result.held.push({ sourceId: packet.sourceId, reason: packet.eligible ? 'source-expired' : 'source-ineligible' });
    } catch { result.dropped++; if (expectedId) result.held.push({ sourceId: expectedId, reason: 'source-packet-invalid' }); }
  };
  // DNESKAi briefs (#115) are refreshed from the owner's own brief store.
  const briefs = input.brand === 'dneskai' ? [...new Set(input.sourceIds ?? [])].flatMap(id => {
    const previous = input.previousPackets?.find(packet => packet.sourceId === id);
    return previous?.kind === 'brief' ? [previous] : [];
  }) : [];
  for (const previous of briefs) {
    if (!input.owner) { result.dropped++; result.held.push({ sourceId: previous.sourceId, reason: 'brief-owner-required' }); continue; }
    let refreshed;
    try { refreshed = await refreshDneskaiBriefPacket(input.db ?? createAdminClient(), input.owner, previous, now); }
    catch (error) { throw new SourceRefreshError(error instanceof DneskaiBriefSourceError ? error.code : 'source-current-unavailable'); }
    if ('held' in refreshed) { result.held.push({ sourceId: previous.sourceId, reason: refreshed.held }); continue; }
    append(refreshed.packet, previous.sourceId, true);
  }
  // devShark concepts (7 November 2026) are refreshed from the owner's own concept store, like DNESKAi briefs.
  const concepts = input.brand === 'devshark' ? [...new Set(input.sourceIds ?? [])].filter(id => id.startsWith(DEVSHARK_DRAFT_SOURCE_PREFIX)) : [];
  for (const id of concepts) {
    if (!input.owner) { result.dropped++; result.held.push({ sourceId: id, reason: 'concept-owner-required' }); continue; }
    let refreshed;
    // The orchestrator passes its full service client; the brief path only types the rpc it uses.
    try { refreshed = await refreshDevsharkDraftPacket((input.db ?? createAdminClient()) as unknown as Parameters<typeof refreshDevsharkDraftPacket>[0], input.owner, id, now); }
    catch { throw new SourceRefreshError('source-current-unavailable'); }
    if ('held' in refreshed) { result.held.push({ sourceId: id, reason: refreshed.held }); continue; }
    append(refreshed.packet, id);
  }
  const otherIds = input.sourceIds?.filter(id => !briefs.some(packet => packet.sourceId === id) && !concepts.includes(id));
  if (otherIds && !otherIds.length) return result;
  if (input.brand === 'dneskai') {
    // DNESKAi sources are the owner's own briefs (#115), re-read from the brief store above. Quorum's signed source
    // bridge was removed on 9 November 2026 (Quorum is not needed), so a non-brief id is held rather than fetched; in
    // practice every DNESKAi source is a brief, so nothing reaches here.
    for (const id of otherIds ?? []) result.held.push({ sourceId: id, reason: 'source-unavailable' });
    return result;
  }
  // devShark discovery runs locally (13 November 2026): the owner's eligible concepts are the sources. The Quorum
  // bridge and its n8n instance are gone, so a non-concept id is held and nothing leaves the process.
  for (const id of otherIds ?? []) result.held.push({ sourceId: id, reason: 'source-unavailable' });
  if (otherIds) return result;
  // Concepts have no daily editions; a dated discovery reports the date as having none.
  if (input.date) { result.noEditionDates.push(input.date); return result; }
  if (!input.owner) throw new SourceRefreshError('concept-owner-required');
  let discovered;
  try { discovered = await discoverDevsharkDraftPackets((input.db ?? createAdminClient()) as unknown as Parameters<typeof discoverDevsharkDraftPackets>[0], input.owner, now); }
  catch { throw new SourceRefreshError('source-current-unavailable'); }
  result.dropped += discovered.invalid;
  for (const packet of discovered.packets) append(packet);
  return result;
}

export async function refreshSource(source: SourcePacket, signal: AbortSignal, options: SourceRefreshOptions = {}): Promise<SourcePacket> {
  const refreshed = await refreshMarketingSources({ ...options, signal, brand: source.brand, sourceIds: [source.sourceId], previousPackets: [source] });
  const packet = refreshed.packets.find(packet => packet.sourceId === source.sourceId);
  if (!packet || refreshed.dropped) throw new SourceRefreshError('source-recheck-unavailable');
  return packet;
}
