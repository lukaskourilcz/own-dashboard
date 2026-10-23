import 'server-only';
import { DneskaiCandidateSchema, type DneskaiCandidate, type DneskaiSource } from './dneskai-contracts';
import { dneskaiCheapIdentity } from './dneskai-registry';
import { contentHash } from './hashes';

/**
 * Link-library and manual topics (#210). Such a topic has no collected report, so the topic bridge reads its stored
 * URL through Jina Reader (only the URL is sent, as for link enrichment in `docs/ai-and-privacy.md`) and stores the
 * page as one research candidate with the source id `owner-link`. From there the topic takes the report path: the
 * report is selected for a day, `dneskai-media` collects its pictures (og:image, GitHub social preview, article
 * figures) and the brief is built and admitted with every guard unchanged.
 */
export const DNESKAI_OWNER_LINK_SOURCE_ID = 'owner-link';
/** Reader attempts per topic before it stops with `topic-source-unreadable`. */
export const DNESKAI_TOPIC_READER_ATTEMPTS = 3;

/** What the reader returns for a page: its title and readable text. */
export type DneskaiTopicPage = { title: string; text: string };
export type DneskaiTopicReader = (url: string, signal: AbortSignal) => Promise<DneskaiTopicPage | null>;

/** The pseudo-source of a stored owner link: the page's own site, so only pictures from that site are offered. */
export function dneskaiOwnerLinkSource(candidate: Pick<DneskaiCandidate, 'sourceId' | 'url'>): DneskaiSource | undefined {
  if (candidate.sourceId !== DNESKAI_OWNER_LINK_SOURCE_ID) return undefined;
  const url = new URL(candidate.url);
  return { id: DNESKAI_OWNER_LINK_SOURCE_ID, name: url.hostname.replace(/^www\./, ''), url: `${url.origin}/`, kind: 'html', weekdays: [0, 1, 2, 3, 4, 5, 6], maxItems: 1 };
}

/** The first https URL a topic stores in `evidence.urls`, or null (a manual topic with a title only). */
export function dneskaiTopicUrl(evidence: Record<string, unknown> | null): string | null {
  const urls = Array.isArray(evidence?.urls) ? evidence.urls : [];
  for (const value of urls) {
    if (typeof value !== 'string' || value.length > 2048) continue;
    try { if (new URL(value).protocol === 'https:') return value; } catch { /* not a URL */ }
  }
  return null;
}

/** Markdown from the reader as plain text: pictures dropped, links reduced to their words, blank runs closed. */
export function dneskaiReaderText(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The Jina Reader call (https://r.jina.ai), the same one link enrichment makes: only the URL goes out, `JINA_API_KEY`
 * only raises the rate limit. Null when the page cannot be read or has no title and no text.
 */
export function createJinaTopicReader(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): DneskaiTopicReader {
  return async (url, signal) => {
    try {
      const response = await fetcher(`https://r.jina.ai/${url}`, {
        headers: { Accept: 'application/json', 'X-Return-Format': 'markdown', ...(env.JINA_API_KEY ? { Authorization: `Bearer ${env.JINA_API_KEY}` } : {}) },
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) return null;
      const json = await response.json() as { data?: { title?: unknown; description?: unknown; content?: unknown } };
      const data = json.data ?? {};
      const title = typeof data.title === 'string' ? data.title.replace(/\s+/g, ' ').trim() : '';
      const parts = [data.description, data.content].flatMap((part) => typeof part === 'string' && part.trim() ? [dneskaiReaderText(part)] : []);
      const text = parts.join('\n\n').trim();
      return title || text ? { title: title.slice(0, 500), text: text.slice(0, 12000) } : null;
    } catch { return null; }
  };
}

/** The candidate row of an owner link, with the identity hashes the candidates table keeps unique per owner and project. */
export function dneskaiOwnerLinkCandidate(input: { topicId: string; kind: 'news' | 'education'; url: string; page: DneskaiTopicPage; fallbackTitle: string; fallbackText: string | null; now: Date }) {
  const title = (input.page.title || input.fallbackTitle).slice(0, 500);
  const text = (input.page.text || input.fallbackText || '').slice(0, 12000);
  const identity = dneskaiCheapIdentity({ title, text, url: input.url });
  const candidate = DneskaiCandidateSchema.parse({
    targetDate: null, id: `${DNESKAI_OWNER_LINK_SOURCE_ID}:${input.topicId}`, sourceId: DNESKAI_OWNER_LINK_SOURCE_ID, externalId: identity.canonicalUrl.slice(0, 300),
    title, text, url: input.url, publishedAt: null, fetchedAt: input.now.toISOString(), mediaUrls: [], contentHash: contentHash({ title, text, url: identity.canonicalUrl }),
    category: input.kind === 'news' ? 'ai-news' : 'tool', relevance: null, duplicateOf: null, status: 'new', reason: 'topic-approved-by-owner',
  });
  return { candidate, canonicalUrlHash: contentHash(identity.canonicalUrl), normalizedTextHash: contentHash(identity.normalizedText) };
}
