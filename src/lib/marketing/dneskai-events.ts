import { createHash } from 'node:crypto';
import type { DneskaiCandidate } from './dneskai-contracts';
import { dneskaiSourceTier } from './dneskai-registry';

/**
 * DNESKAi events (#115): reports of one news event, grouped without any paid call. Two candidates belong to
 * one event when Jev marked one a duplicate of the other, when they point at the same primary URL after
 * canonicalization, or when their headlines match (SEL-07): at least 60 % of their meaningful tokens are shared
 * (Jaccard over Czech and English stop-word-free tokens), or at least 45 % with three shared tokens of which one
 * names an entity. Different numbers or versions keep headlines apart. Pure: no network, storage or clock.
 */
export const DNESKAI_EVENT_VERSION = 'dneskai-event/1';
export const DNESKAI_EVENT_MEMBERS_VERSION = 'dneskai-event-members/1';
/** Headline token Jaccard at or above this joins two reports (issue #115). */
export const DNESKAI_EVENT_TITLE_JACCARD = 0.6;
/** A headline match also needs this many shared tokens, so two one-word titles never merge on their own. */
export const DNESKAI_EVENT_MIN_SHARED_TOKENS = 2;
/** The second tier (SEL-07): a reworded headline joins at this Jaccard ... */
export const DNESKAI_EVENT_REWORDED_JACCARD = 0.45;
/** ... with at least this many shared tokens, one of them an entity (a capitalised name such as `OpenAI` or `Nova`). */
export const DNESKAI_EVENT_REWORDED_MIN_SHARED_TOKENS = 3;
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
  'these', 'those', 'than', 'then', 'not', 'no', 'yes', 'some', 'one', 'get', 'gets', 'got', 'make', 'makes', 'made', 'now', 'today', 'yet',
  // Czech (diacritics folded)
  'a', 'aby', 'ale', 'ani', 'asi', 'az', 'bez', 'bude', 'budou', 'by', 'byl', 'byla', 'bylo', 'byly', 'byt', 'co', 'do', 'ho', 'i', 'jak',
  'jako', 'je', 'jeho', 'jej', 'jeji', 'jen', 'jeste', 'ji', 'jsem', 'jsme', 'jsou', 'jste', 'k', 'kam', 'kde', 'kdo', 'kdyz', 'ke', 'ktera',
  'ktere', 'kteri', 'ktery', 'ma', 'maji', 'me', 'mezi', 'mi', 'mu', 'muze', 'na', 'nad', 'nam', 'nas', 'nebo', 'neni', 'nez', 'nic', 'o',
  'od', 'po', 'pod', 'pokud', 'pri', 'pro', 'proc', 'proto', 'protoze', 'se', 'si', 'snad', 'so', 'sve', 'svuj', 'ta', 'tak', 'take', 'taky',
  'te', 'ten', 'tento', 'teto', 'tim', 'to', 'tohle', 'toho', 'tom', 'tomto', 'tu', 'tuto', 'ty', 'u', 'uz', 'v', 've', 'vsak', 'z', 'za',
  'ze', 'zde', 'nove', 'novy', 'nova', 'dnes', 'jiz',
]);

/**
 * Words that are function words in lower case and names when capitalised inside a headline („Amazon Nova“,
 * „New York“). A capitalised one followed by another capitalised word becomes one token with it (`new-york`,
 * beside `york`), so „New York“ and „New Delhi“ do not share a token.
 */
const NAME_WHEN_CAPITALISED = new Set(['new', 'nova', 'novy', 'nove']);
/** Currency words carry no event: „$40B“ and „40 billion dollars“ are the same figure. */
const CURRENCY_WORDS = new Set(['dollar', 'dollars', 'usd', 'dolar', 'dolaru', 'dolary', 'eur', 'euro', 'eura', 'euros', 'czk', 'kc', 'korun', 'koruna', 'koruny']);
/** Magnitude words and suffixes, folded to one English word so „40B“, „40 bn“, „40 billion“ and „40 mld“ compare. */
const MAGNITUDE_WORDS = new Map([
  ...['billion', 'billions', 'bn', 'mld', 'miliard', 'miliardy', 'miliardu'].map((word) => [word, 'billion'] as const),
  ...['million', 'millions', 'mn', 'mil', 'milion', 'miliony', 'milionu'].map((word) => [word, 'million'] as const),
  ...['trillion', 'trillions', 'tn'].map((word) => [word, 'trillion'] as const),
]);
const MAGNITUDE_SUFFIX: Record<string, string> = { b: 'billion', bn: 'billion', m: 'million', mn: 'million', t: 'trillion', tn: 'trillion' };
const MONTHS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'leden', 'ledna', 'unor', 'unora', 'brezen', 'brezna', 'duben', 'dubna', 'kveten', 'kvetna', 'cerven', 'cervna', 'cervenec', 'cervence',
  'srpen', 'srpna', 'zari', 'rijen', 'rijna', 'listopad', 'listopadu', 'prosinec', 'prosince',
]);
const YEAR = /^(?:19|20)\d{2}$/;
const DAY = /^(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?$/;

/** One headline token: lower case, diacritics folded, with what the comparison needs to know about it. */
type HeadlineToken = { token: string; entity: boolean; date: boolean };
function headlineTokens(value: string): HeadlineToken[] {
  // Thousands separators go, a decimal comma becomes a point: „1,000“ is 1000 and „1,5 mld“ is 1.5 billion.
  const folded = value.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1').replace(/(\d),(?=\d)/g, '$1.');
  const raw = folded.match(/[\p{L}\p{N}]+(?:[.\-+][\p{L}\p{N}]+)*/gu) ?? [];
  const lower = raw.map((word) => word.toLocaleLowerCase('en'));
  const capitalised = (index: number) => /^\p{Lu}/u.test(raw[index] ?? '');
  // A headline in Title Case capitalises every word, so a capital says nothing about a name there.
  const longWords = raw.slice(1).filter((word) => /^\p{L}{4,}$/u.test(word));
  const titleCase = longWords.length >= 2 && longWords.every((word) => /^\p{Lu}/u.test(word));
  const named = (index: number) => index > 0 && !titleCase && capitalised(index);
  const tokens: HeadlineToken[] = [];
  for (let index = 0; index < raw.length; index++) {
    const word = raw[index]!, token = lower[index]!;
    // Mixed case (OpenAI, iPhone, GPT-6) names something wherever it stands; a capital inside a sentence-case headline does too.
    const entity = /\p{Lu}/u.test(word.slice(1)) || named(index);
    if (NAME_WHEN_CAPITALISED.has(token) && named(index)) {
      if (index + 1 < raw.length && capitalised(index + 1) && !STOP_WORDS.has(lower[index + 1]!)) {
        tokens.push({ token: `${token}-${lower[index + 1]}`, entity: true, date: false });
      } else tokens.push({ token, entity: true, date: false });
      continue;
    }
    if (STOP_WORDS.has(token) || CURRENCY_WORDS.has(token)) continue;
    const magnitude = MAGNITUDE_WORDS.get(token);
    if (magnitude) { tokens.push({ token: magnitude, entity: false, date: false }); continue; }
    const scaled = /^(\d+(?:\.\d+)?)(bn|mn|tn|b|m|t)$/.exec(token);
    if (scaled) {
      tokens.push({ token: scaled[1]!, entity: false, date: false }, { token: MAGNITUDE_SUFFIX[scaled[2]!]!, entity: false, date: false });
      continue;
    }
    if (token.length < 2 && !/\d/.test(token)) continue;
    // A day next to a month and a year are dates: they never decide whether two headlines report one event.
    const date = YEAR.test(token) || (DAY.test(token) && (MONTHS.has(lower[index - 1] ?? '') || MONTHS.has(lower[index + 1] ?? '')));
    tokens.push({ token, entity, date });
  }
  return tokens;
}

/**
 * Meaningful lower-case tokens of a headline, diacritics folded; versions such as `0.5.1` or `gpt-4o` stay whole.
 * Figures are normalised (`$40B` gives `40` and `billion`), currency words are dropped, and „New York“ or
 * „Amazon Nova“ keep the word a lower-case „new“ or „nova“ would lose.
 */
export function dneskaiTitleTokens(value: string): Set<string> {
  return new Set(headlineTokens(value).map((entry) => entry.token));
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
const VERSION_TOKEN = /^v?\d+(?:\.\d+)+[a-z0-9-]*$|^v\d+$/;
/** A headline's tokens with its number, version and entity tokens, computed once per report. */
type TitleFacts = { tokens: ReadonlySet<string>; numbers: string[]; versions: string[]; entities: ReadonlySet<string> };
function titleFacts(headline: string): TitleFacts {
  const entries = headlineTokens(headline);
  const tokens = new Set(entries.map((entry) => entry.token));
  // A date (a year, a day beside a month) is a token for the Jaccard but never a fact: „15 October“ and „2026“ may report one event.
  const facts = [...new Set(entries.filter((entry) => !entry.date).map((entry) => entry.token))];
  return {
    tokens, numbers: facts.filter((token) => /\d/.test(token)), versions: facts.filter((token) => VERSION_TOKEN.test(token)),
    entities: new Set(entries.filter((entry) => entry.entity).map((entry) => entry.token)),
  };
}
/**
 * Different version or number tokens mean different events, however similar the rest reads: `0.12.6` and
 * `0.12.7` are two releases even when both headlines also mention „Gemma 3“.
 */
function factsMatch(a: TitleFacts, b: TitleFacts, reworded = true): boolean {
  if (disjoint(a.versions, b.versions) || disjoint(a.numbers, b.numbers)) return false;
  const { score, shared } = jaccard(a.tokens, b.tokens);
  if (shared >= DNESKAI_EVENT_MIN_SHARED_TOKENS && score >= DNESKAI_EVENT_TITLE_JACCARD) return true;
  // The second tier: a reworded headline about the same named thing.
  if (!reworded || shared < DNESKAI_EVENT_REWORDED_MIN_SHARED_TOKENS || score < DNESKAI_EVENT_REWORDED_JACCARD) return false;
  for (const token of a.tokens) if (b.tokens.has(token) && (a.entities.has(token) || b.entities.has(token))) return true;
  return false;
}

/** True when two headlines describe the same event by the #115 token rule and its SEL-07 second tier. */
export function dneskaiHeadlinesMatch(left: string, right: string): boolean {
  return factsMatch(titleFacts(left), titleFacts(right));
}

/**
 * True when any headline on the left repeats any on the right (briefs-15): the #115 first tier only (token
 * Jaccard ≥ 0.6 with ≥ 2 shared tokens) under the same number and version guard, so `Ollama 0.12.7` never
 * repeats `Ollama 0.12.6`. The reworded second tier is left out because the 14-day repeat window is much wider
 * than the 72-hour event window. Each headline is tokenised once.
 */
export function dneskaiHeadlinesRepeat(left: readonly string[], right: readonly string[]): boolean {
  if (!left.length || !right.length) return false;
  const others = right.map(titleFacts);
  return left.some((headline) => { const facts = titleFacts(headline); return others.some((other) => factsMatch(facts, other, false)); });
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
    const root = Math.min(a, b), other = Math.max(a, b);
    const merged = reasons.get(root) ?? new Set<DneskaiEvent['links'][number]>();
    if (a !== b) { for (const value of reasons.get(other) ?? []) merged.add(value); reasons.delete(other); parent[other] = root; }
    merged.add(reason);
    reasons.set(root, merged);
  };
  // Everything a pair comparison needs is computed once per report: a night can hold a few thousand reports.
  const facts = items.map((item) => titleFacts(dneskaiEventHeadline(item)));
  const urls = items.map((item) => dneskaiEventUrlKeys(item));
  const urlSets = urls.map((keys) => new Set(keys));
  const times = items.map((item) => { const value = instant(item); return Number.isFinite(value) ? value : 0; });
  items.forEach((item, position) => {
    const target = item.duplicateOf ? index.get(item.duplicateOf) : undefined;
    if (target !== undefined && target !== position) union(position, target, 'jev-duplicate');
  });
  const windowMs = DNESKAI_EVENT_WINDOW_HOURS * 3600000;
  // Pairs are visited in publication order, so each scan stops at the end of the 72-hour window.
  const byTime = items.map((_, position) => position).sort((a, b) => times[a]! - times[b]! || a - b);
  for (let i = 0; i < byTime.length; i++) {
    const left = byTime[i]!;
    for (let j = i + 1; j < byTime.length; j++) {
      const right = byTime[j]!;
      if (times[right]! - times[left]! > windowMs) break;
      if (urls[left]!.some((key) => urlSets[right]!.has(key))) union(left, right, 'same-url');
      else if (factsMatch(facts[left]!, facts[right]!)) union(left, right, 'similar-title');
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

/** `marketing_dneskai_finish` accepts at most this many events, each with at most this many members. */
export const DNESKAI_FINISH_EVENT_LIMIT = 300;
export const DNESKAI_FINISH_EVENT_MEMBER_LIMIT = 300;
/**
 * The `p_events` argument of `marketing_dneskai_finish`: events with two or more members (a single report is
 * implicit). `keep` drops events that cannot be selected (no open report); over the limit the events with the
 * most recently collected member win, and an oversized event keeps its anchor and earliest members.
 */
export function dneskaiFinishEvents<T extends DneskaiEventInput>(events: readonly DneskaiEvent<T>[], keep: (event: DneskaiEvent<T>) => boolean = () => true,
  categoryOf: (event: DneskaiEvent<T>) => DneskaiEventCategory | null = () => null): Array<{ eventId: string; anchorId: string; memberIds: string[]; category?: DneskaiEventCategory }> {
  const latest = (event: DneskaiEvent<T>) => Math.max(...event.members.map((member) => Date.parse(member.fetchedAt)));
  const grouped = events.filter((event) => event.members.length > 1 && keep(event));
  const kept = grouped.length > DNESKAI_FINISH_EVENT_LIMIT ? [...grouped].sort((a, b) => latest(b) - latest(a)).slice(0, DNESKAI_FINISH_EVENT_LIMIT) : grouped;
  return kept.map((event) => {
    const category = categoryOf(event);
    return { eventId: event.eventId, anchorId: event.anchorId, memberIds: event.members.slice(0, DNESKAI_FINISH_EVENT_MEMBER_LIMIT).map((member) => member.id), ...(category ? { category } : {}) };
  });
}

/** A category an event can be selected under: every Jev category except `other`. */
export type DneskaiEventCategory = Exclude<NonNullable<DneskaiCandidate['category']>, 'other'>;
type CategoryMember = Pick<DneskaiCandidate, 'id' | 'sourceId' | 'category' | 'relevance' | 'publishedAt'>;
/**
 * An event's category (SEL-10): the category most of its eligible reports carry. On a tie the reports of tier-0/1
 * sources (publishers and newsrooms, not aggregators) decide; if they tie too, the most relevant eligible report
 * among the tied categories decides (relevance, then the newer report, then the id, as the SQL picks its lead).
 * Null when no report is eligible. Each report keeps its own Jev label for display; this only names the event.
 * tool and ai-project stay separate categories here. Under 20261022180000 (decisions 11 and 12) they share the one
 * daily slot outside news with marketing; the SQL applies that, not this label.
 */
export function dneskaiEventCategory<T extends CategoryMember>(members: readonly T[], eligible: (member: T) => boolean): DneskaiEventCategory | null {
  const pool = members.filter((member) => member.category && member.category !== 'other' && eligible(member));
  if (!pool.length) return null;
  const counts = (items: readonly T[]) => {
    const tally = new Map<DneskaiEventCategory, number>();
    for (const item of items) tally.set(item.category as DneskaiEventCategory, (tally.get(item.category as DneskaiEventCategory) ?? 0) + 1);
    return tally;
  };
  const leaders = (tally: Map<DneskaiEventCategory, number>, among: readonly DneskaiEventCategory[]) => {
    const best = Math.max(0, ...among.map((category) => tally.get(category) ?? 0));
    return among.filter((category) => (tally.get(category) ?? 0) === best);
  };
  let tied = leaders(counts(pool), [...counts(pool).keys()]);
  if (tied.length > 1) tied = leaders(counts(pool.filter((member) => dneskaiSourceTier(member.sourceId) <= 1)), tied);
  if (tied.length === 1) return tied[0]!;
  const lead = pool.filter((member) => tied.includes(member.category as DneskaiEventCategory)).sort((a, b) => (b.relevance ?? -1) - (a.relevance ?? -1)
    || Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? '') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]!;
  return lead.category as DneskaiEventCategory;
}

/** How directly a source reports an event (0 publisher, 1 newsroom, 2 aggregator) is a registry field (audit C6). */
export { dneskaiSourceTier };

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
