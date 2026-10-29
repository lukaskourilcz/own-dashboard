import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';
import { isJobUrl } from '@/lib/jobs/availability';
import type { JobListing } from '@/lib/types';

type Listing = Pick<JobListing, 'id' | 'source' | 'title' | 'url' | 'last_seen_at'>;
const proofSchema = z.strictObject({ source: z.string().max(140), title: z.string().max(300), url: z.string().max(2048), lastSeenAt: databaseTimestamp });
const count = z.number().int().nonnegative().max(10_000);
const receiptSchema = z.strictObject({
  ownerId: z.uuid(), checkedAt: z.iso.datetime(), candidates: count,
  candidateVersion: z.string().regex(/^[a-f0-9]{64}$/),
  previouslyChecked: count, remaining: count,
  states: z.record(z.uuid(), z.enum(['open', 'closed', 'unknown'])),
  versions: z.record(z.uuid(), proofSchema),
});
export type AvailabilityReceipt = z.infer<typeof receiptSchema>;
export type AvailabilityRequest = {
  ownerId: string; signal: AbortSignal; listings: readonly Listing[];
  checkedIds?: readonly string[]; previousCheckedAt?: string; expectedVersion?: string;
};
export class CareerAvailabilityError extends Error {
  constructor() { super('Career availability unconfirmed'); }
}

/** An open result belongs to one exact displayed offer, including microseconds. */
export function availabilityVersionMatches(listing: Listing, proof: AvailabilityReceipt['versions'][string] | undefined): boolean {
  return !!proof && proofsMatch({ source: listing.source, title: listing.title, url: listing.url, lastSeenAt: listing.last_seen_at }, proof);
}
function proofsMatch(known: z.infer<typeof proofSchema>, observed: z.infer<typeof proofSchema>): boolean {
  if (known.source !== observed.source || known.title !== observed.title || known.url !== observed.url) return false;
  if (known.lastSeenAt === observed.lastSeenAt) return true;
  const version = databaseVersion(known.lastSeenAt);
  return version !== null && version === databaseVersion(observed.lastSeenAt);
}

/** One explicit bounded read. Original account and row versions are captured
 * before waiting; rejected/late work cannot supply open-listing evidence. */
export async function readCareerAvailability(input: AvailabilityRequest): Promise<AvailabilityReceipt> {
  const { ownerId, signal: parent, previousCheckedAt, expectedVersion } = input;
  const lifetime = new AbortController();
  const signal = AbortSignal.any([parent, lifetime.signal, AbortSignal.timeout(60_000)]);
  let response: Response | undefined;
  const discard = () => { if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined); };
  try {
    signal.throwIfAborted(); z.uuid().parse(ownerId);
    const start = Date.now();
    if (!Number.isFinite(start) || input.listings.length > 10_000) throw new CareerAvailabilityError();
    const listings = new Map(input.listings.map(row => [z.uuid().parse(row.id), proofSchema.parse({ source: row.source, title: row.title, url: row.url, lastSeenAt: row.last_seen_at })]));
    const checkedIds = z.array(z.uuid()).max(10_000).parse(input.checkedIds ?? []);
    const checked = new Set(checkedIds);
    if (listings.size !== input.listings.length || checked.size !== checkedIds.length || checkedIds.some(id => !listings.has(id))) throw new CareerAvailabilityError();
    if (previousCheckedAt !== undefined) z.iso.datetime().parse(previousCheckedAt);
    if (expectedVersion !== undefined) z.string().regex(/^[a-f0-9]{64}$/).parse(expectedVersion);
    const pending = fetch('/api/jobs/available', {
      method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'x-own-dashboard-owner': ownerId }, body: JSON.stringify({ checkedIds, expectedVersion }),
    }).then(value => { response = value; if (signal.aborted) discard(); return value; });
    const result = await awaitWithSignal(pending, signal); signal.throwIfAborted();
    if (!result.ok) throw new CareerAvailabilityError();
    const text = await boundedResponseText(result, 10 * 1024 * 1024, signal);
    const receipt = receiptSchema.parse(JSON.parse(text)); signal.throwIfAborted();
    const ids = Object.keys(receipt.states), versions = Object.keys(receipt.versions);
    const end = Date.now(), at = Date.parse(receipt.checkedAt);
    const invalidVersion = ids.some(id => {
      const known = listings.get(id), proof = receipt.versions[id];
      return checked.has(id) || !known || !proof || !proofsMatch(known, proof)
        || (receipt.states[id] === 'open' && !isJobUrl(proof.url));
    });
    if (receipt.ownerId !== ownerId || !Number.isFinite(end) || end < start || at < start - 120_000 || at > end + 120_000
      || (previousCheckedAt !== undefined && at < Date.parse(previousCheckedAt))
      || receipt.candidates > listings.size || receipt.previouslyChecked > checked.size
      || (expectedVersion !== undefined && (receipt.candidateVersion !== expectedVersion || receipt.previouslyChecked !== checked.size))
      || receipt.candidates !== receipt.previouslyChecked + ids.length + receipt.remaining
      || ids.length !== versions.length || versions.some(id => !Object.hasOwn(receipt.states, id))
      || invalidVersion) throw new CareerAvailabilityError();
    return receipt;
  } catch {
    if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
    throw new CareerAvailabilityError();
  } finally { lifetime.abort(); discard(); }
}
