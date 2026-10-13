import 'server-only';
import { BrandSchema, parseSourcePacket, sourceUsable, type MarketingBrand, type SourcePacket } from './contracts';
import { contentHash } from './hashes';
import { MARKETING_PLANNING_SOURCE_KINDS, pragueMarketingDate } from './weekly-planning';

/** Candidate selection only; producer freshness and exact revision/approval gates remain mandatory. */
export function planningSourceCandidates(values: readonly SourcePacket[], brand: MarketingBrand, now: Date): SourcePacket[] {
  BrandSchema.parse(brand); pragueMarketingDate(now);
  if (values.length > 1000) throw new Error('marketing-source-list-too-large');
  const ids = new Set<string>();
  return values.map(parseSourcePacket).filter(packet => {
    if (packet.brand !== brand) return false;
    if (ids.has(packet.sourceId)) throw new Error('duplicate-planning-source');
    ids.add(packet.sourceId);
    return MARKETING_PLANNING_SOURCE_KINDS[brand].some(kind => kind === packet.kind)
      && sourceUsable(packet, now) && Date.parse(packet.observedAt) <= now.getTime() + 60000 && contentHash(packet.content) === packet.contentHash;
  });
}
