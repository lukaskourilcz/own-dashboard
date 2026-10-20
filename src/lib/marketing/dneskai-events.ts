import { createHash } from 'node:crypto';
import type { DneskaiCandidate } from './dneskai-contracts';

/**
 * DNESKAi events (#115): reports of one news event, grouped without any paid call. Two candidates belong to
 * one event when Jev marked one a duplicate of the other, when they point at the same primary URL after
 * canonicalization, or when their headlines share at least 60 % of their meaningful tokens (Jaccard over
 * Czech and English stop-word-free tokens). Pure: no network, storage or clock.
 */
export const DNESKAI_EVENT_VERSION = 'dneskai-event/1';
export const DNESKAI_EVENT_MEMBERS_VERSION = 'dneskai-event-members/1';
/** Headline token Jaccard at or above this joins two reports (issue #115). */
export const DNESKAI_EVENT_TITLE_JACCARD = 0.6;
/** A headline match also needs this many shared tokens, so two one-word titles never merge on their own. */
export const DNESKAI_EVENT_MIN_SHARED_TOKENS = 2;
/** Reports further apart than this are separate events unless Jev linked them. */
export const DNESKAI_EVENT_WINDOW_HOURS = 72;
/** Selected members per event: one media collector call (`pendingDneskaiMediaCandidates` returns eight). */
export const DNESKAI_EVENT_MAX_MEMBERS = 8;

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** The event identity: sha256 of its earliest collected member, so a late supporting report does not rename it. */
export function dneskaiEventId(anchorCandidateId: string): string {
  return sha256(`${DNESKAI_EVENT_VERSION}\n${anchorCandidateId}`);
}

/**
 * sha256 over the sorted member ids and their content hashes. It changes whenever a member is added,
 * removed or re-collected, and `marketing_dneskai_finish` computes the same value in SQL.
 */
export function dneskaiEventMemberHash(members: ReadonlyArray<{ id: string; contentHash: string }>): string {
  const lines = members.map((member) => `${member.id}:${member.contentHash}`).sort();
  return sha256(`${DNESKAI_EVENT_MEMBERS_VERSION}\n${lines.join('\n')}`);
}

// Function words only: names, products and numbers carry the event.
const STOP_WORDS = new Set([
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'may', 'more', 'most', 'new', 'now', 'of', 'on', 'or', 'our',
  'out', 'over', 'says', 'she', 'so', 'than', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'up', 'us', 'via', 'was', 'we', 'were',
  'what', 'when', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your', 'about', 'after', 'all', 'also', 'any', 'here', 'there',
  'these', 'those', 'than', 'then', 'not', 'no', 'yes', 'some', 'one', 'get', 'gets', 'got', 'make', 'makes', 'made', 'now', 'today',
  // Czech (diacritics folded)
  'a', 'aby', 'ale', 'ani', 'asi', 'az', 'bez', 'bude', 'budou', 'by', 'byl', 'byla', 'bylo', 'byly', 'byt', 'co', 'do', 'ho', 'i', 'jak',
  'jako', 'je', 'jeho', 'jej', 'jeji', 'jen', 'jeste', 'ji', 'jsem', 'jsme', 'jsou', 'jste', 'k', 'kam', 'kde', 'kdo', 'kdyz', 'ke', 'ktera',
  'ktere', 'kteri', 'ktery', 'ma', 'maji', 'me', 'mezi', 'mi', 'mu', 'muze', 'na', 'nad', 'nam', 'nas', 'nebo', 'neni', 'nez', 'nic', 'o',
  'od', 'po', 'pod', 'pokud', 'pri', 'pro', 'proc', 'proto', 'protoze', 'se', 'si', 'snad', 'so', 'sve', 'svuj', 'ta', 'tak', 'take', 'taky',
  'te', 'ten', 'tento', 'teto', 'tim', 'to', 'tohle', 'toho', 'tom', 'tomto', 'tu', 'tuto', 'ty', 'u', 'uz', 'v', 've', 'vsak', 'z', 'za',
  'ze', 'zde', 'nove', 'novy', 'nova', 'dnes', 'jiz',
]);

/** Meaningful lower-case tokens of a headline, diacritics folded; versions such as `0.5.1` or `gpt-4o` stay whole. */
export function dneskaiTitleTokens(value: string): Set<string> {
  const folded = value.normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase('en');
  const tokens = folded.match(/[\p{L}\p{N}]+(?:[.\-+][\p{L}\p{N}]+)*/gu) ?? [];
  return new Set(tokens.map((token) => token.replace(/'s$/, '')).filter((token) => !STOP_WORDS.has(token) && (token.length > 1 || /\d/.test(token))));
}

/** The comparable headline: the title (Instagram uses the caption as its title) up to its first line, 200 characters. */
export function dneskaiEventHeadline(candidate: Pick<DneskaiCandidate, 'title' | 'text'>): string {
  const source = candidate.title.trim() || candidate.text.trim();
  return (source.split(/\r?\n/, 1)[0] ?? '').slice(0, 200);
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): { score: number; shared: number } {
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  const union = left.size + right.size - shared;
  return { score: union ? shared / union : 0, shared };
}

const disjoint = (a: readonly string[], b: readonly string[]) => a.length > 0 && b.length > 0 && !a.some((token) => b.includes(token));
/**
 * Different version or number tokens mean different events, however similar the rest reads: `0.12.6` and
 * `0.12.7` are two releases even when both headlines also mention „Gemma 3“.
 */
function numbersConflict(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  const numbers = (tokens: ReadonlySet<string>) => [...tokens].filter((token) => /\d/.test(token));
  const versions = (tokens: ReadonlySet<string>) => [...tokens].filter((token) => /^v?\d+(?:\.\d+)+[a-z0-9-]*$|^v\d+$/.test(token));
  return disjoint(versions(left), versions(right)) || disjoint(numbers(left), numbers(right));
}

/** True when two headlines describe the same event by the #115 token rule. */
export function dneskaiHeadlinesMatch(left: string, right: string): boolean {
  const a = dneskaiTitleTokens(left), b = dneskaiTitleTokens(right);
  if (numbersConflict(a, b)) return false;
  const { score, shared } = jaccard(a, b);
  return shared >= DNESKAI_EVENT_MIN_SHARED_TOKENS && score >= DNESKAI_EVENT_TITLE_JACCARD;
}

const TRACKING = /^(?:utm_.*|fbclid|gclid|ref|ref_src|source|igsh|igshid|si|mc_cid|mc_eid|ncid|cmpid|guccounter)$/i;
const SOCIAL_HOSTS = new Set(['instagram.com', 'bsky.app', 'news.ycombinator.com', 'twitter.com', 'x.com', 'threads.net', 'linktr.ee', 'facebook.com', 'youtube.com', 'youtu.be', 'tiktok.com']);

/** The canonical form of a primary URL: scheme, `www.`/`m.`/`amp.`, tracking parameters, fragment, AMP and trailing slash removed. */
export function dneskaiPrimaryUrlKey(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|amp|mobile)\./, '');
  const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING.test(key)).sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  const path = url.pathname.replace(/\/(?:amp|index\.html?)\/?$/i, '/').replace(/\/+$/, '') || '/';
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  return `${host}${path}${query}`;
}

function hostOf(key: string) { return key.split('/', 1)[0] ?? ''; }

/** URLs a report links to in its text (an Instagram caption or a Hacker News item naming the article). */
function linkedUrlKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    const key = dneskaiPrimaryUrlKey(match[0].replace(/[.,;:!?]+$/, ''));
    if (!key || key.endsWith('/') || SOCIAL_HOSTS.has(hostOf(key))) continue;
    keys.push(key);
    if (keys.length >= 5) break;
  }
  return keys;
}

/** The URL identities of one report: its own URL and, for a post, the articles it links to. */
export function dneskaiEventUrlKeys(candidate: Pick<DneskaiCandidate, 'url' | 'text'>): string[] {
  const own = dneskaiPrimaryUrlKey(candidate.url);
  return [...new Set([...(own ? [own] : []), ...linkedUrlKeys(candidate.text)])];
}

export type DneskaiEventInput = Pick<DneskaiCandidate, 'id' | 'sourceId' | 'title' | 'text' | 'url' | 'publishedAt' | 'fetchedAt' | 'duplicateOf' | 'contentHash'>;
export type DneskaiEvent<T extends DneskaiEventInput = DneskaiEventInput> = {
  eventId: string;
  /** The earliest collected member; its id names the event. */
  anchorId: string;
  /** Members in collection order (anchor first). */
  members: T[];
  memberHash: string;
  /** Why the members were joined: `jev-duplicate`, `same-url`, `similar-title`; empty for a single report. */
  links: Array<'jev-duplicate' | 'same-url' | 'similar-title'>;
};

const instant = (candidate: Pick<DneskaiCandidate, 'publishedAt' | 'fetchedAt'>) => Date.parse(candidate.publishedAt ?? candidate.fetchedAt);
const collectionOrder = <T extends DneskaiEventInput>(a: T, b: T) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Groups reports into events. Every input candidate belongs to exactly one event; the output is ordered by
 * each event's anchor. Jev duplicate links join regardless of time; URL and headline links only join reports
 * published within 72 hours of each other.
 */
export function groupDneskaiEvents<T extends DneskaiEventInput>(candidates: readonly T[]): DneskaiEvent<T>[] {
  const items = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()].sort(collectionOrder);
  const index = new Map(items.map((item, position) => [item.id, position]));
  const parent = items.map((_, position) => position);
  const find = (position: number): number => { while (parent[position] !== position) { parent[position] = parent[parent[position]!]!; position = parent[position]!; } return position; };
  const reasons = new Map<number, Set<DneskaiEvent['links'][number]>>();
  const union = (left: number, right: number, reason: DneskaiEvent['links'][number]) => {
    const a = find(left), b = find(right);
    const merged = new Set([...(reasons.get(a) ?? []), ...(reasons.get(b) ?? []), reason]);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    reasons.set(find(left), merged);
  };
  const tokens = items.map((item) => dneskaiEventHeadline(item));
  const urls = items.map((item) => dneskaiEventUrlKeys(item));
  items.forEach((item, position) => {
    const target = item.duplicateOf ? index.get(item.duplicateOf) : undefined;
    if (target !== undefined && target !== position) union(position, target, 'jev-duplicate');
  });
  const windowMs = DNESKAI_EVENT_WINDOW_HOURS * 3600000;
  for (let left = 0; left < items.length; left++) {
    for (let right = left + 1; right < items.length; right++) {
      if (Math.abs(instant(items[left]!) - instant(items[right]!)) > windowMs) continue;
      if (urls[left]!.some((key) => urls[right]!.includes(key))) union(left, right, 'same-url');
      else if (dneskaiHeadlinesMatch(tokens[left]!, tokens[right]!)) union(left, right, 'similar-title');
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((item, position) => { const root = find(position); groups.set(root, [...(groups.get(root) ?? []), item]); });
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([root, members]) => ({
    eventId: dneskaiEventId(members[0]!.id), anchorId: members[0]!.id, members,
    memberHash: dneskaiEventMemberHash(members),
    links: members.length > 1 ? [...(reasons.get(root) ?? [])].sort() : [],
  }));
}

/** The `p_events` argument of `marketing_dneskai_finish`: events with two or more members (a single report is implicit). */
export function dneskaiFinishEvents(events: readonly DneskaiEvent[]): Array<{ eventId: string; anchorId: string; memberIds: string[] }> {
  return events.filter((event) => event.members.length > 1).slice(0, 300)
    .map((event) => ({ eventId: event.eventId, anchorId: event.anchorId, memberIds: event.members.map((member) => member.id) }));
}

/**
 * How directly a source reports an event. 0: the original publisher or its own account (lab and vendor blogs,
 * GitHub releases, arXiv). 1: newsrooms and authors with their own reporting. 2: aggregators and reposts
 * (Hacker News, TechCrunch, news-roundup Instagram accounts). Unknown sources count as 1.
 */
const PUBLISHER_SOURCES = new Set(['anthropic-news', 'openai-blog', 'deepmind-blog', 'google-research', 'hf-blog', 'meta-ai', 'github-ai-releases',
  'arxiv-cs-ai', 'arxiv-cs-lg', 'instagram:mosseri', 'instagram:meta.ai']);
const AGGREGATOR_SOURCES = new Set(['hn-frontpage', 'techcrunch-ai', 'tensorfeed', 'bluesky-language-models', 'stackexchange-ml', 'spaceflight-news',
  'instagram:technology', 'instagram:insidertech', 'instagram:evolving.ai', 'instagram:techcrunch', 'instagram:theapplehub', 'instagram:robotic',
  'instagram:activeprogrammer', 'instagram:tiffintech']);
export function dneskaiSourceTier(sourceId: string): 0 | 1 | 2 {
  return PUBLISHER_SOURCES.has(sourceId) ? 0 : AGGREGATOR_SOURCES.has(sourceId) ? 2 : 1;
}

/**
 * Orders an event's reports with the chosen primary first: the original publisher or account before a
 * newsroom before an aggregator, then more offerable pictures, then the newer report, then the id.
 */
export function rankDneskaiEventMembers<T extends Pick<DneskaiCandidate, 'id' | 'sourceId' | 'publishedAt' | 'fetchedAt'>>(members: readonly T[], mediaCount: (id: string) => number = () => 0): T[] {
  return [...members].sort((a, b) => dneskaiSourceTier(a.sourceId) - dneskaiSourceTier(b.sourceId)
    || mediaCount(b.id) - mediaCount(a.id)
    || instant(b) - instant(a)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
