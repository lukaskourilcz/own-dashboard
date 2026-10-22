import { contentHash } from "./hashes";

/**
 * The DNESKAi Apify research plan (brief §4.I): which actors run, on what, how often, and the most each run may
 * cost. Data only: nothing here performs I/O, so the dry run can print it from a terminal without a token.
 *
 * Budget: one existing Apify account, $150 of promotional prepaid usage that expires on 2026-11-22. The research
 * ledger stops at DNESKAI_RESEARCH_CEILING_USD whatever this plan says. Every run carries its own
 * `maxTotalChargeUsd` (`capUsd`), which the platform enforces per run. The plan is front-loaded: the first two waves
 * run between 23 October and 5 November; the month-end wave and the daily @dneskai measurement keep a reserve; the
 * rest is contingency that only a new, re-approved plan can spend.
 *
 * Prices are the Bronze (Starter) tier as `fetch-actor-details` returned them on 2026-10-22. They are recorded here
 * so that each cap can be checked against the worst case of its run, not trusted.
 *
 * Approval binds exact bytes: the approved-plan id is the sha256 of this plan's canonical JSON. Changing a target,
 * a volume, a cap, a date or a pinned build changes the id, and the runner refuses until the owner records the new
 * id. Builds are pinned from public read-only actor metadata observed on 2026-10-22 at 02:45 UTC;
 * docs/dneskai-apify-build-pins.json records each binding. No actor was started. Owner approval remains absent.
 */

export const DNESKAI_RESEARCH_PLAN_VERSION = "dneskai-apify-research/1";
/** Hard stop for the research ledger, separate from the pipeline's $0.04 per profile and $0.25 per Prague day. */
export const DNESKAI_RESEARCH_CEILING_USD = 150;
/** No single research run may be allowed more than this, whatever the plan says. */
export const DNESKAI_RESEARCH_MAX_RUN_CAP_USD = 5;
/** The promotional prepaid usage expires at the end of 2026-11-22; nothing runs after 21 November (Prague). */
export const DNESKAI_RESEARCH_FIRST_DAY = "2026-10-23";
export const DNESKAI_RESEARCH_LAST_DAY = "2026-11-21";
export const DNESKAI_RESEARCH_PRICES_FETCHED_AT = "2026-10-22";

export type ResearchActorKey =
  | "instagram-post" | "instagram-reel" | "instagram-hashtag" | "instagram-search" | "instagram-profile"
  | "threads" | "google-news" | "reddit" | "youtube";

export type ResearchActor = {
  id: string;
  /** `username~name`, the form the run endpoint takes. */
  name: string;
  url: string;
  maintainer: "apify" | "community";
  pricingModel: "PAY_PER_EVENT";
  /** Bronze prices per event in USD, as fetched. */
  prices: Record<string, number>;
  modifiedAt: string;
  /** Pinned build number (`1.2.3`); null remains a fail-closed state for a future unpinned actor. */
  build: string | null;
};

export const DNESKAI_RESEARCH_ACTORS: Record<ResearchActorKey, ResearchActor> = {
  "instagram-post": { id: "nH2AHrwxeTRJoN5hX", name: "apify~instagram-post-scraper", url: "https://apify.com/apify/instagram-post-scraper", maintainer: "apify", pricingModel: "PAY_PER_EVENT",
    prices: { post: 0.0015, postDetails: 0.0008, musicData: 0.006 }, modifiedAt: "2026-10-21", build: "0.0.646" },
  "instagram-reel": { id: "xMc5Ga1oCONPmWJIa", name: "apify~instagram-reel-scraper", url: "https://apify.com/apify/instagram-reel-scraper", maintainer: "apify", pricingModel: "PAY_PER_EVENT",
    prices: { reel: 0.0023, actorStart: 0.001, sharesCount: 0.006, transcriptMinute: 0.041, videoDownloadMb: 0.015 }, modifiedAt: "2026-10-21", build: "0.0.617" },
  "instagram-hashtag": { id: "reGe1ST3OBgYZSsZJ", name: "apify~instagram-hashtag-scraper", url: "https://apify.com/apify/instagram-hashtag-scraper", maintainer: "apify", pricingModel: "PAY_PER_EVENT",
    prices: { result: 0.0023 }, modifiedAt: "2026-10-21", build: "0.0.707" },
  "instagram-search": { id: "DrF9mzPPEuVizVF4l", name: "apify~instagram-search-scraper", url: "https://apify.com/apify/instagram-search-scraper", maintainer: "apify", pricingModel: "PAY_PER_EVENT",
    prices: { result: 0.0023, liveSearchResult: 0.0023 }, modifiedAt: "2026-10-21", build: "0.1.557" },
  "instagram-profile": { id: "dSCLg0C3YEZ83HzYX", name: "apify~instagram-profile-scraper", url: "https://apify.com/apify/instagram-profile-scraper", maintainer: "apify", pricingModel: "PAY_PER_EVENT",
    prices: { profile: 0.0023, aboutAccount: 0.006 }, modifiedAt: "2026-10-21", build: "0.0.655" },
  threads: { id: "lct1dlYksEDIG9If9", name: "futurizerush~meta-threads-scraper", url: "https://apify.com/futurizerush/meta-threads-scraper", maintainer: "community", pricingModel: "PAY_PER_EVENT",
    prices: { result: 0.0025, actorStartPerGb: 0.005 }, modifiedAt: "2026-10-17", build: "0.0.413" },
  "google-news": { id: "eWUEW5YpCaCBAa0Zs", name: "lhotanova~google-news-scraper", url: "https://apify.com/lhotanova/google-news-scraper", maintainer: "community", pricingModel: "PAY_PER_EVENT",
    prices: { newsResult: 0.002, resolvedUrl: 0.001, articlePage: 0.001, actorStartPerGb: 0.005 }, modifiedAt: "2026-10-15", build: "0.0.46" },
  reddit: { id: "9sHOY9RzPYGjmTHo8", name: "harshmaur~reddit-scraper", url: "https://apify.com/harshmaur/reddit-scraper", maintainer: "community", pricingModel: "PAY_PER_EVENT",
    prices: { resultSaved: 0.0018, actorStartPerGb: 0.02, aiAnalyzedResult: 0.0005, customLabel: 0.0001 }, modifiedAt: "2026-10-20", build: "0.0.710" },
  youtube: { id: "h7sDV53CddomktSi5", name: "streamers~youtube-scraper", url: "https://apify.com/streamers/youtube-scraper", maintainer: "apify", pricingModel: "PAY_PER_EVENT",
    prices: { video: 0.003, dateRangeForChannels: 0.001, aiDescriptionMinute: 0.01, aiSummaryMinute: 0.01, transcriptMinute: 0.041 }, modifiedAt: "2026-10-21", build: "0.0.319" },
};

export type ResearchWave = "front" | "second" | "daily" | "month-end";

/**
 * Where a run's targets come from.
 * - `fixed`: the list is part of the plan and of its approval; run N takes the N-th slice of `perRun`.
 * - `derived`: the targets come out of an earlier wave (audio ids of top reels, post URLs to re-measure). Each must
 *   match `pattern` and a run takes at most `perRun`; the cap bounds the money either way.
 * - `none`: the input names the one target itself (the @dneskai measurement).
 */
export type ResearchTargets =
  | { kind: "fixed"; values: readonly string[]; perRun: number }
  | { kind: "derived"; from: string; pattern: string; perRun: number }
  | { kind: "none" };

export type ResearchItem = {
  key: string;
  actor: ResearchActorKey;
  wave: ResearchWave;
  /** The decision the data informs. */
  decision: string;
  /** Inclusive Prague dates. */
  window: { from: string; to: string };
  runs: number;
  targets: ResearchTargets;
  /** How the targets enter the actor input. */
  targetField: string;
  targetFormat: "array" | "csv" | "single";
  /** Fixed input, merged under the targets. Never a login, cookie or session field. */
  input: Record<string, unknown>;
  /** Most billed results one run can produce (targets per run x results per target). */
  maxResultsPerRun: number;
  /** Worst-case price per billed result, add-ons included. */
  unitUsd: number;
  /** Worst-case start fee per run (per-GB start events at the largest memory the actor uses). */
  startUsd: number;
  /** `maxTotalChargeUsd` of every run of this item. */
  capUsd: number;
};

const GLOBAL_ACCOUNTS = [
  "evolving.ai", "technology", "techcrunch", "insidertech", "theapplehub", "tiffintech", "mosseri", "meta.ai",
  "therundownai", "heyzainkahn", "tldr_newsletter", "alliekmiller", "businessinsider", "reuters", "axios",
  "theeconomist", "nytimes", "guardian", "bbcnews", "washingtonpost",
] as const;
const CZECH_ACCOUNTS = [
  "jsemvobraze", "dokontextu", "cervenapropiska", "refreshernews.cz", "seznamzpravy", "denikn", "petrmara",
  "czechcrunch", "aktualne.cz", "forbescesko", "filiptitlbach", "danielstach", "vaclavmoravec", "jindrichsidlo",
  "novinarkybezpretvarky", "vinohradska12",
] as const;
const NICHE_ACCOUNTS = [...GLOBAL_ACCOUNTS, ...CZECH_ACCOUNTS];
const THREADS_ACCOUNTS = [
  "evolving.ai", "technology", "techcrunch", "insidertech", "theapplehub", "tiffintech", "mosseri", "meta.ai",
  "therundownai", "alliekmiller", "jsemvobraze", "dokontextu", "cervenapropiska", "refreshernews.cz", "seznamzpravy",
  "denikn", "petrmara", "czechcrunch", "forbescesko", "aktualne.cz",
] as const;
const HASHTAGS = [
  "ai", "artificialintelligence", "chatgpt", "openai", "generativeai", "aitools", "ainews", "technews",
  "machinelearning", "techexplained", "futuretech", "robotics", "umelainteligence", "technologie", "zpravy",
  "novinky", "cesko", "startup", "chatgptcesky", "vzdelavani", "zajimavosti", "veda", "aplikace", "inovace",
] as const;
const POPULAR_KEYWORDS = [
  "ai news", "chatgpt", "openai", "artificial intelligence", "ai tools", "tech news", "robotics", "gemini",
  "claude ai", "ai explained", "umělá inteligence", "technologie", "novinky ai", "chatgpt česky", "ai nástroje",
  "zprávy", "věda", "startup", "aplikace", "ai tipy",
] as const;
const NEWS_QUERIES = ["umělá inteligence", "AI OR ChatGPT OR OpenAI", "technologie startup", "robotika OR čipy OR polovodiče"] as const;
const REDDIT_TERMS = ["AI news", "OpenAI", "ChatGPT", "Anthropic Claude", "Google Gemini", "AI regulation", "AI agents", "robotics"] as const;
const YOUTUBE_QUERIES = ["AI news", "ChatGPT update", "AI explained", "umělá inteligence", "AI novinky", "tech news this week", "OpenAI", "AI tools", "robotics news", "AI česky"] as const;

/** Public Instagram handle; Instagram allows letters, digits, dots and underscores, up to 30. */
export const INSTAGRAM_HANDLE = /^[A-Za-z0-9_.]{1,30}$/;
const INSTAGRAM_POST_URL = "^https://www\\.instagram\\.com/p/[A-Za-z0-9_-]{5,40}/$";
const INSTAGRAM_REEL_URL = "^https://www\\.instagram\\.com/reel/[A-Za-z0-9_-]{5,40}/$";
const INSTAGRAM_AUDIO_URL = "^https://www\\.instagram\\.com/reels/audio/[0-9]{5,30}/$";

const front = { from: "2026-10-23", to: "2026-10-29" };
const second = { from: "2026-10-30", to: "2026-11-05" };
const monthEnd = { from: "2026-11-16", to: "2026-11-21" };
const daily = { from: DNESKAI_RESEARCH_FIRST_DAY, to: DNESKAI_RESEARCH_LAST_DAY };
const POST_DETAILED = 0.0015 + 0.0008;
const POST_DETAILED_WITH_MUSIC = POST_DETAILED + 0.006;
const REEL_WITH_SHARES = 0.0023 + 0.006;

export const DNESKAI_RESEARCH_ITEMS: readonly ResearchItem[] = [
  // Wave 1, front-loaded: the niche study, formats, captions, music, hashtags and sources.
  { key: "niche-posts-global", actor: "instagram-post", wave: "front", window: front, runs: 4,
    decision: "Which formats, slide counts, caption shapes, CTAs, hashtag counts, slots and collaborations go with engagement on global AI and tech accounts.",
    targets: { kind: "fixed", values: GLOBAL_ACCOUNTS, perRun: 5 }, targetField: "username", targetFormat: "array",
    input: { resultsLimit: 300, dataDetailLevel: "detailedData", skipPinnedPosts: true, includeMusicData: false },
    maxResultsPerRun: 1500, unitUsd: POST_DETAILED, startUsd: 0, capUsd: 3.6 },
  { key: "niche-posts-czech", actor: "instagram-post", wave: "front", window: front, runs: 4,
    decision: "The same questions for Czech news and explainer accounts, so the Czech audience is not inferred from US accounts.",
    targets: { kind: "fixed", values: CZECH_ACCOUNTS, perRun: 4 }, targetField: "username", targetFormat: "array",
    input: { resultsLimit: 300, dataDetailLevel: "detailedData", skipPinnedPosts: true, includeMusicData: false },
    maxResultsPerRun: 1200, unitUsd: POST_DETAILED, startUsd: 0, capUsd: 2.9 },
  { key: "niche-carousel-music", actor: "instagram-post", wave: "front", window: { from: "2026-10-24", to: "2026-10-29" }, runs: 4,
    decision: "Whether niche accounts put music on carousels and single images, which tracks, and whether those posts do better.",
    targets: { kind: "fixed", values: NICHE_ACCOUNTS, perRun: 9 }, targetField: "username", targetFormat: "array",
    input: { resultsLimit: 30, dataDetailLevel: "detailedData", skipPinnedPosts: true, includeMusicData: true, onlyPostsNewerThan: "60 days" },
    maxResultsPerRun: 270, unitUsd: POST_DETAILED_WITH_MUSIC, startUsd: 0, capUsd: 2.35 },
  { key: "niche-reels", actor: "instagram-reel", wave: "front", window: front, runs: 6,
    decision: "Reels against carousels on the same accounts: plays, likes, comments, public share counts, audio names and lengths.",
    targets: { kind: "fixed", values: NICHE_ACCOUNTS, perRun: 6 }, targetField: "username", targetFormat: "array",
    input: { resultsLimit: 60, skipPinnedPosts: true, includeSharesCount: true, includeTranscript: false, includeDownloadedVideo: false },
    maxResultsPerRun: 360, unitUsd: REEL_WITH_SHARES, startUsd: 0.001, capUsd: 3.15 },
  { key: "hashtag-posts", actor: "instagram-hashtag", wave: "front", window: { from: "2026-10-24", to: "2026-10-29" }, runs: 3,
    decision: "Which global and Czech hashtags still carry reach for AI and tech posts, and how many hashtags top posts use.",
    targets: { kind: "fixed", values: HASHTAGS, perRun: 8 }, targetField: "hashtags", targetFormat: "array",
    input: { resultsType: "posts", resultsLimit: 100 },
    maxResultsPerRun: 800, unitUsd: 0.0023, startUsd: 0, capUsd: 1.95 },
  { key: "hashtag-reels", actor: "instagram-hashtag", wave: "front", window: { from: "2026-10-24", to: "2026-10-29" }, runs: 3,
    decision: "The same hashtags for Reels, with audio, to see what format and sound the tag surfaces.",
    targets: { kind: "fixed", values: HASHTAGS, perRun: 8 }, targetField: "hashtags", targetFormat: "array",
    input: { resultsType: "reels", resultsLimit: 50 },
    maxResultsPerRun: 400, unitUsd: 0.0023, startUsd: 0, capUsd: 1.0 },
  { key: "popular-reels", actor: "instagram-search", wave: "front", window: { from: "2026-10-24", to: "2026-10-29" }, runs: 2,
    decision: "Which reels Instagram ranks as popular for AI keywords in English and Czech, and which audio they use.",
    targets: { kind: "fixed", values: POPULAR_KEYWORDS, perRun: 10 }, targetField: "search", targetFormat: "csv",
    input: { searchType: "popular", searchLimit: 64, enhanceUserSearchWithFacebookPage: false },
    maxResultsPerRun: 640, unitUsd: 0.0023, startUsd: 0, capUsd: 1.55 },
  { key: "threads-posts", actor: "threads", wave: "front", window: front, runs: 2,
    decision: "Whether the reference accounts' Threads posts are a better or earlier source than their Instagram, and what headline register earns reposts.",
    targets: { kind: "fixed", values: THREADS_ACCOUNTS, perRun: 10 }, targetField: "usernames", targetFormat: "array",
    input: { mode: "user", max_posts: 100 },
    maxResultsPerRun: 1000, unitUsd: 0.0025, startUsd: 0.02, capUsd: 2.65 },
  { key: "google-news-cs", actor: "google-news", wave: "front", window: front, runs: 4,
    decision: "Which Czech publishers cover AI news first and with usable pictures: candidates for new native sources.",
    targets: { kind: "fixed", values: NEWS_QUERIES, perRun: 1 }, targetField: "query", targetFormat: "single",
    input: { language: "CZ:cs", maxItems: 500, fetchArticleDetails: true, fetchArticlePage: true, openEndedDateRange: "30d" },
    maxResultsPerRun: 500, unitUsd: 0.004, startUsd: 0.02, capUsd: 2.15 },
  { key: "reddit-ai", actor: "reddit", wave: "front", window: front, runs: 2,
    decision: "Which AI stories draw discussion before they reach Instagram: an early-signal source, posts only.",
    targets: { kind: "fixed", values: REDDIT_TERMS, perRun: 4 }, targetField: "searchTerms", targetFormat: "array",
    input: { searchPosts: true, searchComments: false, searchCommunities: false, crawlCommentsPerPost: false, searchSort: "top", searchTime: "month", maxPostsCount: 250, includeNSFW: false, aiAnalysis: false },
    maxResultsPerRun: 1000, unitUsd: 0.0018, startUsd: 0.08, capUsd: 2.0 },
  { key: "youtube-ai", actor: "youtube", wave: "front", window: front, runs: 2,
    decision: "Which AI explainer topics and titles draw views this month, in English and Czech: hook and topic evidence.",
    targets: { kind: "fixed", values: YOUTUBE_QUERIES, perRun: 5 }, targetField: "searchQueries", targetFormat: "array",
    input: { maxResults: 60, maxResultsShorts: 0, maxResultStreams: 0, dateFilter: "month", transcriptionAndSubtitle: "NONE", aiVideoDescription: false, aiVideoSummary: false },
    maxResultsPerRun: 300, unitUsd: 0.003, startUsd: 0, capUsd: 0.95 },
  // Wave 2: follow-ups that need wave 1's results.
  { key: "audio-trend-reels", actor: "instagram-reel", wave: "second", window: second, runs: 3,
    decision: "How widely the audio found in wave 1 is used in the niche and in Czechia, and whether it is still rising.",
    targets: { kind: "derived", from: "top audio ids of niche-reels, hashtag-reels and popular-reels", pattern: INSTAGRAM_AUDIO_URL, perRun: 10 }, targetField: "username", targetFormat: "array",
    input: { resultsLimit: 50, includeSharesCount: false, includeTranscript: false, includeDownloadedVideo: false },
    maxResultsPerRun: 500, unitUsd: 0.0023, startUsd: 0.001, capUsd: 1.25 },
  { key: "posts-resnapshot", actor: "instagram-post", wave: "second", window: { from: "2026-10-31", to: "2026-11-05" }, runs: 6,
    decision: "How engagement of wave-1 posts grew over about a week: which formats keep earning after day one.",
    targets: { kind: "derived", from: "post URLs of the newest wave-1 posts", pattern: INSTAGRAM_POST_URL, perRun: 1000 }, targetField: "username", targetFormat: "array",
    input: { dataDetailLevel: "basicData", includeMusicData: false },
    maxResultsPerRun: 1000, unitUsd: 0.0015, startUsd: 0, capUsd: 1.6 },
  { key: "reels-resnapshot", actor: "instagram-reel", wave: "second", window: { from: "2026-10-31", to: "2026-11-05" }, runs: 2,
    decision: "The same growth curve for reels, with public share counts.",
    targets: { kind: "derived", from: "reel URLs of the newest wave-1 reels", pattern: INSTAGRAM_REEL_URL, perRun: 500 }, targetField: "username", targetFormat: "array",
    input: { includeSharesCount: true, includeTranscript: false, includeDownloadedVideo: false },
    maxResultsPerRun: 500, unitUsd: REEL_WITH_SHARES, startUsd: 0.001, capUsd: 4.35 },
  // Daily: @dneskai's own public metrics, the learning loop until Insights scopes exist.
  { key: "dneskai-daily-posts", actor: "instagram-post", wave: "daily", window: daily, runs: 30,
    decision: "Which kit, hook style and slot did best on @dneskai, from two weeks of daily snapshots per post.",
    targets: { kind: "none" }, targetField: "username", targetFormat: "array",
    input: { username: ["dneskai"], resultsLimit: 60, onlyPostsNewerThan: "14 days", dataDetailLevel: "detailedData", includeMusicData: false },
    maxResultsPerRun: 60, unitUsd: POST_DETAILED, startUsd: 0, capUsd: 0.15 },
  { key: "dneskai-daily-profile", actor: "instagram-profile", wave: "daily", window: daily, runs: 30,
    decision: "Daily follower and post counts of @dneskai.",
    targets: { kind: "none" }, targetField: "usernames", targetFormat: "array",
    input: { usernames: ["dneskai"], includeAboutSection: false },
    maxResultsPerRun: 1, unitUsd: 0.0023, startUsd: 0, capUsd: 0.01 },
  // Month end: re-measure what the niche published during the month, for the findings report.
  { key: "month-end-niche-posts", actor: "instagram-post", wave: "month-end", window: monthEnd, runs: 4,
    decision: "What the niche published during the month and how it did, to compare with @dneskai over the same weeks.",
    targets: { kind: "fixed", values: NICHE_ACCOUNTS, perRun: 9 }, targetField: "username", targetFormat: "array",
    input: { resultsLimit: 40, onlyPostsNewerThan: "2026-10-23", dataDetailLevel: "detailedData", skipPinnedPosts: true, includeMusicData: false },
    maxResultsPerRun: 360, unitUsd: POST_DETAILED, startUsd: 0, capUsd: 0.9 },
  { key: "month-end-niche-reels", actor: "instagram-reel", wave: "month-end", window: monthEnd, runs: 4,
    decision: "The month's reels of the same accounts, with share counts and audio.",
    targets: { kind: "fixed", values: NICHE_ACCOUNTS, perRun: 9 }, targetField: "username", targetFormat: "array",
    input: { resultsLimit: 20, onlyPostsNewerThan: "2026-10-23", skipPinnedPosts: true, includeSharesCount: true, includeTranscript: false, includeDownloadedVideo: false },
    maxResultsPerRun: 180, unitUsd: REEL_WITH_SHARES, startUsd: 0.001, capUsd: 1.6 },
  { key: "month-end-popular-reels", actor: "instagram-search", wave: "month-end", window: monthEnd, runs: 2,
    decision: "Whether the popular reels and audio for the same keywords changed over the month.",
    targets: { kind: "fixed", values: POPULAR_KEYWORDS, perRun: 10 }, targetField: "search", targetFormat: "csv",
    input: { searchType: "popular", searchLimit: 64, enhanceUserSearchWithFacebookPage: false },
    maxResultsPerRun: 640, unitUsd: 0.0023, startUsd: 0, capUsd: 1.55 },
];

export type DneskaiResearchPlan = {
  version: typeof DNESKAI_RESEARCH_PLAN_VERSION;
  pricesFetchedAt: string;
  ceilingUsd: number;
  actors: Record<ResearchActorKey, ResearchActor>;
  items: readonly ResearchItem[];
};

export const DNESKAI_RESEARCH_PLAN: DneskaiResearchPlan = {
  version: DNESKAI_RESEARCH_PLAN_VERSION,
  pricesFetchedAt: DNESKAI_RESEARCH_PRICES_FETCHED_AT,
  ceilingUsd: DNESKAI_RESEARCH_CEILING_USD,
  actors: DNESKAI_RESEARCH_ACTORS,
  items: DNESKAI_RESEARCH_ITEMS,
};

const cents = (usd: number) => Math.round(usd * 100);
/** Worst case of one run, before the cap: every billed result at its highest price plus the largest start fee. */
export const researchRunWorstUsd = (item: ResearchItem) => item.maxResultsPerRun * item.unitUsd + item.startUsd;
/** Sum of every run's cap: the most the plan can ever spend. */
export const researchPlanCapTotalUsd = (plan: DneskaiResearchPlan = DNESKAI_RESEARCH_PLAN) =>
  plan.items.reduce((sum, item) => sum + cents(item.capUsd) * item.runs, 0) / 100;
export const researchWaveCapUsd = (wave: ResearchWave, plan: DneskaiResearchPlan = DNESKAI_RESEARCH_PLAN) =>
  plan.items.filter((item) => item.wave === wave).reduce((sum, item) => sum + cents(item.capUsd) * item.runs, 0) / 100;

/** The approved-plan id: sha256 of the plan's canonical JSON, so an approval covers these exact bytes. */
export function dneskaiResearchPlanId(plan: DneskaiResearchPlan = DNESKAI_RESEARCH_PLAN): string {
  return contentHash(plan);
}

const FORBIDDEN_INPUT = /cookie|session|login|password|token|proxy|email|facebook/i;
const PRAGUE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every rule a plan must meet before it can be approved or run. Returns issue codes; empty means valid. */
export function validateDneskaiResearchPlan(plan: DneskaiResearchPlan = DNESKAI_RESEARCH_PLAN): string[] {
  const issues: string[] = [];
  const keys = new Set<string>();
  if (plan.ceilingUsd !== DNESKAI_RESEARCH_CEILING_USD) issues.push("plan-ceiling-changed");
  for (const item of plan.items) {
    const at = (code: string) => issues.push(`${item.key}:${code}`);
    if (keys.has(item.key)) at("duplicate-key");
    keys.add(item.key);
    if (!plan.actors[item.actor]) at("actor-unknown");
    if (!Number.isInteger(item.runs) || item.runs < 1) at("runs-invalid");
    if (!(item.capUsd > 0) || item.capUsd > DNESKAI_RESEARCH_MAX_RUN_CAP_USD) at("cap-out-of-range");
    const worst = researchRunWorstUsd(item);
    // The cap must cover the worst case (so a run is not cut off by our own number) without padding beyond 25 %.
    if (cents(item.capUsd) < Math.ceil(worst * 100 - 1e-6)) at("cap-below-worst-case");
    if (item.capUsd > worst * 1.25 + 0.05) at("cap-padded");
    if (!PRAGUE_DATE.test(item.window.from) || !PRAGUE_DATE.test(item.window.to) || item.window.from > item.window.to
      || item.window.from < DNESKAI_RESEARCH_FIRST_DAY || item.window.to > DNESKAI_RESEARCH_LAST_DAY) at("window-invalid");
    if (Object.keys(item.input).some((key) => FORBIDDEN_INPUT.test(key) && key !== "enhanceUserSearchWithFacebookPage")) at("input-forbidden");
    if (item.input.enhanceUserSearchWithFacebookPage === true) at("input-personal-data");
    if (item.input.crawlCommentsPerPost === true || item.input.searchComments === true) at("input-comments");
    if (item.input.includeDownloadedVideo === true || item.input.includeTranscript === true) at("input-media-copy");
    if (item.targets.kind === "fixed") {
      const { values, perRun } = item.targets;
      if (values.length === 0 || values.length > item.runs * perRun) at("targets-do-not-fit-runs");
      if (new Set(values).size !== values.length) at("targets-duplicate");
      if (item.actor.startsWith("instagram") || item.actor === "threads") {
        if (values.some((value) => !INSTAGRAM_HANDLE.test(value) && item.targetField !== "hashtags" && item.targetField !== "search")) at("targets-invalid");
      }
    }
    if (item.targets.kind === "none" && !(item.targetField in item.input)) at("target-missing");
  }
  if (researchPlanCapTotalUsd(plan) > plan.ceilingUsd) issues.push("plan-over-ceiling");
  return issues;
}

/** The targets of one run of a fixed item, in plan order. */
export function researchRunTargets(item: ResearchItem, runIndex: number): string[] {
  if (item.targets.kind !== "fixed") return [];
  return item.targets.values.slice(runIndex * item.targets.perRun, (runIndex + 1) * item.targets.perRun);
}

/** The actor input of one run: the fixed input plus the run's targets in the field the actor expects. */
export function researchRunInput(item: ResearchItem, targets: readonly string[]): Record<string, unknown> {
  if (item.targets.kind === "none") return { ...item.input };
  const value = item.targetFormat === "csv" ? targets.join(", ") : item.targetFormat === "single" ? targets[0] : [...targets];
  return { ...item.input, [item.targetField]: value };
}

const usd = (value: number) => `$${value.toFixed(2)}`;

/** The plan as the owner reads it before approving: per item, runs, caps, window and the total. */
export function formatDneskaiResearchPlan(plan: DneskaiResearchPlan = DNESKAI_RESEARCH_PLAN): string {
  const lines = [
    `DNESKAi Apify research plan ${plan.version} (prices fetched ${plan.pricesFetchedAt}, Bronze tier)`,
    `plan id ${dneskaiResearchPlanId(plan)}`,
    "",
  ];
  for (const item of plan.items) {
    const actor = plan.actors[item.actor];
    lines.push(`${item.key} [${item.wave}] ${actor.name} build ${actor.build ?? "UNPINNED"}`);
    lines.push(`  ${item.window.from}..${item.window.to}, ${item.runs} run(s) x cap ${usd(item.capUsd)} = ${usd(item.runs * item.capUsd)}; worst case per run ${usd(researchRunWorstUsd(item))}, up to ${item.maxResultsPerRun} results`);
  }
  const total = researchPlanCapTotalUsd(plan);
  lines.push("", `front ${usd(researchWaveCapUsd("front", plan))}, second ${usd(researchWaveCapUsd("second", plan))}, daily ${usd(researchWaveCapUsd("daily", plan))}, month-end ${usd(researchWaveCapUsd("month-end", plan))}`);
  lines.push(`total of caps ${usd(total)} of ${usd(plan.ceilingUsd)}; unallocated ${usd(plan.ceilingUsd - total)} (spendable only through a new, re-approved plan)`);
  const issues = validateDneskaiResearchPlan(plan);
  lines.push(issues.length ? `INVALID: ${issues.join(", ")}` : "plan valid");
  return lines.join("\n");
}
