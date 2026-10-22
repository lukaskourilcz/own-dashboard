import { DneskaiSourceSchema, type DneskaiSource } from './dneskai-contracts';
import { portfolioEntryFor } from '@/lib/portfolio';
import type { Project } from '@/lib/types';
export const DNESKAI_REGISTRY_VERSION='dneskai-sources/1';
/**
 * The one DNESKAi source registry (audit C6): identity, Prague cadence, ranking tier and adapter parameters.
 * Feed identities were copied from Quorum config/sources.json on 2026-10-13; no new adapters.
 * maxItems: 20 per feed and 10 per Instagram profile since #112 (Quorum's own pipelines keep 10).
 * tier: how directly a source reports an event, used to pick an event's primary report. 0 is the original
 * publisher or its own account (lab and vendor blogs, GitHub releases, arXiv), 1 (the default, omitted) a
 * newsroom or author with their own reporting, 2 an aggregator or repost account.
 * adapter: the native free-feed adapter's parameters (search query, GitHub repositories, Stack Exchange site).
 */
export type DneskaiSourceTier = 0 | 1 | 2;
export interface DneskaiFeedAdapter { readonly query?: string; readonly repos?: readonly string[]; readonly site?: string }
/** `topic: 'education'` marks a scouting source (#151): its reports become topics (náměty), never Jev news candidates. */
type DneskaiRegistryEntry = DneskaiSource & { tier?: 0 | 2; adapter?: DneskaiFeedAdapter; topic?: 'education' };
const instagram: DneskaiRegistryEntry[] = [
  { id: "instagram:mosseri", name: "mosseri", url: "https://www.instagram.com/mosseri/", kind: 'instagram', maxItems: 10, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 0 },
  { id: "instagram:meta.ai", name: "meta.ai", url: "https://www.instagram.com/meta.ai/", kind: 'instagram', maxItems: 10, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 0 },
  { id: "instagram:technology", name: "technology", url: "https://www.instagram.com/technology/", kind: 'instagram', maxItems: 10, weekdays: [1, 4], tier: 2 },
  { id: "instagram:insidertech", name: "insidertech", url: "https://www.instagram.com/insidertech/", kind: 'instagram', maxItems: 10, weekdays: [1, 0], tier: 2 },
  { id: "instagram:activeprogrammer", name: "activeprogrammer", url: "https://www.instagram.com/activeprogrammer/", kind: 'instagram', maxItems: 10, weekdays: [2, 5], tier: 2 },
  { id: "instagram:tiffintech", name: "tiffintech", url: "https://www.instagram.com/tiffintech/", kind: 'instagram', maxItems: 10, weekdays: [2, 5], tier: 2 },
  { id: "instagram:robotic", name: "robotic", url: "https://www.instagram.com/robotic/", kind: 'instagram', maxItems: 10, weekdays: [3, 6], tier: 2 },
  { id: "instagram:evolving.ai", name: "evolving.ai", url: "https://www.instagram.com/evolving.ai/", kind: 'instagram', maxItems: 10, weekdays: [3], tier: 2 },
  { id: "instagram:techcrunch", name: "techcrunch", url: "https://www.instagram.com/techcrunch/", kind: 'instagram', maxItems: 10, weekdays: [4, 0], tier: 2 },
  { id: "instagram:theapplehub", name: "theapplehub", url: "https://www.instagram.com/theapplehub/", kind: 'instagram', maxItems: 10, weekdays: [6, 0], tier: 2 },
];
const feeds: DneskaiRegistryEntry[] = [
  { id: "404-media", name: "404 Media", url: "https://www.404media.co/rss/", kind: 'rss', maxItems: 20, weekdays: [4] },
  { id: "anthropic-news", name: "Anthropic", url: "https://www.anthropic.com/news", kind: 'html', maxItems: 20, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 0 },
  { id: "ars-technica", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", kind: 'rss', maxItems: 20, weekdays: [1] },
  { id: "arxiv-cs-ai", name: "arXiv cs.AI", url: "https://export.arxiv.org/api/query", kind: 'arxiv', maxItems: 20, weekdays: [3], tier: 0, adapter: { query: "cat:cs.AI" } },
  { id: "arxiv-cs-lg", name: "arXiv cs.LG", url: "https://export.arxiv.org/api/query", kind: 'arxiv', maxItems: 20, weekdays: [3], tier: 0, adapter: { query: "cat:cs.LG" } },
  { id: "bluesky-language-models", name: "Bluesky · language models", url: "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts", kind: 'bluesky', maxItems: 20, weekdays: [0], tier: 2, adapter: { query: "language model" } },
  { id: "deepmind-blog", name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", kind: 'rss', maxItems: 20, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 0 },
  { id: "digiday", name: "Digiday", url: "https://digiday.com/feed/", kind: 'rss', maxItems: 20, weekdays: [6] },
  { id: "github-ai-releases", name: "GitHub · AI releases", url: "https://github.com/", kind: 'github', maxItems: 20, weekdays: [2, 5], tier: 0, adapter: { repos: ["openai/openai-python", "anthropics/anthropic-sdk-python", "huggingface/transformers", "vllm-project/vllm", "ollama/ollama", "ggml-org/llama.cpp", "langchain-ai/langchain"] } },
  { id: "google-research", name: "Google Research", url: "https://research.google/blog/rss/", kind: 'rss', maxItems: 20, weekdays: [3], tier: 0 },
  { id: "hf-blog", name: "Hugging Face", url: "https://huggingface.co/blog/feed.xml", kind: 'rss', maxItems: 20, weekdays: [2, 5], tier: 0 },
  { id: "hn-frontpage", name: "Hacker News (front page)", url: "https://hacker-news.firebaseio.com/v0/topstories.json", kind: 'hn', maxItems: 20, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 2 },
  { id: "import-ai", name: "Import AI (Jack Clark)", url: "https://jack-clark.net/feed/", kind: 'rss', maxItems: 20, weekdays: [5, 0] },
  { id: "interconnects", name: "Interconnects (Nathan Lambert)", url: "https://www.interconnects.ai/feed", kind: 'rss', maxItems: 20, weekdays: [5, 0] },
  { id: "meta-ai", name: "Meta AI", url: "https://ai.meta.com/blog/", kind: 'html', maxItems: 20, weekdays: [3], tier: 0 },
  { id: "mit-tech-review", name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", kind: 'rss', maxItems: 20, weekdays: [4] },
  { id: "nieman-lab", name: "Nieman Lab", url: "https://www.niemanlab.org/", kind: 'html', maxItems: 20, weekdays: [4] },
  { id: "openai-blog", name: "OpenAI", url: "https://openai.com/news/rss.xml", kind: 'rss', maxItems: 20, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 0 },
  { id: "platformer", name: "Platformer (Casey Newton)", url: "https://www.platformer.news/rss/", kind: 'rss', maxItems: 20, weekdays: [5, 0] },
  { id: "rest-of-world", name: "Rest of World", url: "https://restofworld.org/feed/latest/", kind: 'rss', maxItems: 20, weekdays: [2] },
  { id: "simonw", name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", kind: 'rss', maxItems: 20, weekdays: [2] },
  { id: "social-media-today", name: "Social Media Today", url: "https://www.socialmediatoday.com/feeds/news/", kind: 'rss', maxItems: 20, weekdays: [6] },
  { id: "spaceflight-news", name: "Spaceflight News", url: "https://api.spaceflightnewsapi.net/v4/articles/", kind: 'spaceflight', maxItems: 20, weekdays: [6], tier: 2 },
  { id: "stackexchange-ml", name: "Stack Overflow · machine-learning", url: "https://api.stackexchange.com/2.3/questions", kind: 'stackexchange', maxItems: 20, weekdays: [0], tier: 2, adapter: { query: "machine-learning", site: "stackoverflow" } },
  { id: "stratechery", name: "Stratechery (Ben Thompson)", url: "https://stratechery.com/feed/", kind: 'rss', maxItems: 20, weekdays: [5, 0] },
  { id: "techcrunch-ai", name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", kind: 'rss', maxItems: 20, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 2 },
  { id: "tensorfeed", name: "TensorFeed (AI news)", url: "https://tensorfeed.ai/feed.xml", kind: 'rss', maxItems: 20, weekdays: [6], tier: 2 },
  { id: "the-register", name: "The Register", url: "https://www.theregister.com/?lab_viewport=rss", kind: 'rss', maxItems: 20, weekdays: [4] },
  { id: "the-verge", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", kind: 'rss', maxItems: 20, weekdays: [1] },
  { id: "tubefilter", name: "Tubefilter", url: "https://www.tubefilter.com/", kind: 'html', maxItems: 20, weekdays: [6] },
  { id: "variety", name: "Variety", url: "https://variety.com/feed/", kind: 'rss', maxItems: 20, weekdays: [5] },
  { id: "wired-ai", name: "Wired (AI)", url: "https://www.wired.com/feed/tag/ai/latest/rss", kind: 'rss', maxItems: 20, weekdays: [1] },
];
/**
 * Education sources (#151, plan section 5), read only while DNESKAI_SCOUTING_ENABLED is on. Each profile is read on two
 * weekdays so that, with the news profiles, a day stays near the $0.25 Apify ceiling; the SQL caps hold the rest.
 * Feed URLs were taken from the plan's seed list on 22 October 2026 and are checked by the first scouting night.
 * @aimanie and @digitalnihumanista wait for the owner's check and are not listed (DNESKAI_EDUCATION_PENDING_PROFILES).
 */
const educationProfile = (handle: string, weekdays: number[]): DneskaiRegistryEntry =>
  ({ id: `instagram:${handle}`, name: handle, url: `https://www.instagram.com/${handle}/`, kind: 'instagram', maxItems: 10, weekdays, tier: 0, topic: 'education' });
const education: DneskaiRegistryEntry[] = [
  educationProfile('itstundeanthony', [1, 4]),
  educationProfile('godofprompt', [2, 5]),
  educationProfile('rowancheung', [3, 6]),
  educationProfile('mreflow', [0, 3]),
  educationProfile('bensbites', [1, 5]),
  educationProfile('futurepedia', [2, 6]),
  educationProfile('therundownai', [0, 4]),
  educationProfile('czechcrunch', [1, 3]),
  { id: "claude-code-whats-new", name: "Claude Code · what's new", url: "https://code.claude.com/docs/en/whats-new", kind: 'html', maxItems: 10, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 0, topic: 'education' },
  { id: "product-hunt", name: "Product Hunt", url: "https://www.producthunt.com/feed", kind: 'rss', maxItems: 10, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 2, topic: 'education' },
  { id: "show-hn", name: "Show HN (over 200 points)", url: "https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=points%3E200", kind: 'hnsearch', maxItems: 10, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 2, topic: 'education' },
  { id: "bens-bites", name: "Ben's Bites", url: "https://www.bensbites.com/feed", kind: 'rss', maxItems: 10, weekdays: [0, 1, 2, 3, 4, 5, 6], tier: 2, topic: 'education' },
  { id: "aisdg", name: "AISDG digest", url: "https://aisdg.substack.com/feed", kind: 'rss', maxItems: 10, weekdays: [1, 4], tier: 2, topic: 'education' },
  { id: "perplexity-changelog", name: "Perplexity changelog", url: "https://www.perplexity.ai/changelog", kind: 'html', maxItems: 10, weekdays: [2, 5], tier: 0, topic: 'education' },
  { id: "devto-github", name: "dev.to · GitHub", url: "https://dev.to/feed/tag/github", kind: 'rss', maxItems: 10, weekdays: [3], tier: 2, topic: 'education' },
  { id: "webcrew", name: "WebCrew", url: "https://webcrew.cz/feed/", kind: 'rss', maxItems: 10, weekdays: [1], topic: 'education' },
  { id: "czechcrunch-ai", name: "CzechCrunch · AI", url: "https://cc.cz/umela-inteligence/feed/", kind: 'rss', maxItems: 10, weekdays: [0, 1, 2, 3, 4, 5, 6], topic: 'education' },
];
/** Profiles from the plan that stay unread until the owner confirms them. */
export const DNESKAI_EDUCATION_PENDING_PROFILES = Object.freeze(['aimanie', 'digitalnihumanista']);
const entries: ReadonlyMap<string, DneskaiRegistryEntry> = new Map([...instagram, ...feeds, ...education].map((entry) => [entry.id, entry]));
const publicRow = ({ id, name, url, kind, weekdays, maxItems }: DneskaiRegistryEntry) => Object.freeze(DneskaiSourceSchema.parse({ id, name, url, kind, weekdays, maxItems }));
/** The public news source rows: the schema is strict, so tier and adapter parameters stay inside this module. */
export const DNESKAI_SOURCES: readonly DneskaiSource[] = Object.freeze([...entries.values()].filter((entry) => !entry.topic).map(publicRow));
/** The education (scouting) source rows (#151); collected only while DNESKAI_SCOUTING_ENABLED is on. */
export const DNESKAI_EDUCATION_SOURCES: readonly DneskaiSource[] = Object.freeze([...entries.values()].filter((entry) => entry.topic === 'education').map(publicRow));
const allRows: ReadonlyMap<string, DneskaiSource> = new Map([...DNESKAI_SOURCES, ...DNESKAI_EDUCATION_SOURCES].map((row) => [row.id, row]));
/** A news or education source row by id. */
export function dneskaiSourceById(sourceId: string): DneskaiSource | undefined { return allRows.get(sourceId); }
/** True for a scouting source: its reports become topics and never reach Jev. */
export function isDneskaiEducationSource(sourceId: string): boolean { return entries.get(sourceId)?.topic === 'education'; }
/** Unknown sources count as newsrooms (1). */
export function dneskaiSourceTier(sourceId: string): DneskaiSourceTier { return entries.get(sourceId)?.tier ?? 1; }
/** The registered adapter parameters of a feed; `{}` for a feed that needs none, undefined for an unknown id. */
export function dneskaiFeedAdapter(sourceId: string): DneskaiFeedAdapter | undefined {
  const entry = entries.get(sourceId);
  return entry ? entry.adapter ?? {} : undefined;
}
export function isDneskaiProject(project:Pick<Project,'portfolio_key'|'repo_full_name'|'parent_id'>&Partial<Pick<Project,'previous_repo_full_names'>>):boolean{return portfolioEntryFor(project)?.key==='aifirst';}
/** The sources due on a Prague date; education sources only with `education` (DNESKAI_SCOUTING_ENABLED). */
export function dueDneskaiSources(date:string,options:{education?:boolean}={}):DneskaiSource[]{const instant=new Date(`${date}T12:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(instant.getTime())||instant.toISOString().slice(0,10)!==date)throw new Error('collection-date-invalid');return [...DNESKAI_SOURCES,...(options.education?DNESKAI_EDUCATION_SOURCES:[])].filter(source=>source.weekdays.includes(instant.getUTCDay()));}
/** Cheap pre-model identity: tracking parameters never create a second research topic. */
export function dneskaiCheapIdentity(item:{title:string;text:string;url:string}) {
 const url=new URL(item.url);url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid|ref|source)$/i.test(key))url.searchParams.delete(key);url.searchParams.sort();
 const normalizedText=[item.title,item.text].join('\n').normalize('NFC').toLocaleLowerCase('en').replace(/\s+/g,' ').trim();
 return{canonicalUrl:url.href.replace(/\/$/,''),normalizedText};
}
