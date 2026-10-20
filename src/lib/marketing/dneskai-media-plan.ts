import * as cheerio from 'cheerio';
import type { DneskaiCandidate, DneskaiSource } from './dneskai-contracts';
import { parseSafeHttpsUrl } from './free-feeds/security/url';

/**
 * Which source pictures the DNESKAi media collector (#114) fetches for a selected candidate, in what
 * order, and how each is credited. Pure: no network, storage or clock.
 *
 * Instagram: every `mediaUrls` entry in collection order (display image first, then the carousel
 * children), at most ten. Feed: the article page's og:image / twitter:image, the feed's own image and
 * the figures in the article body, in publisher order, at most eight, from the publisher's own domain
 * or a CDN it is known to serve its images from. Avatars, logos, icons, SVG, GIF and pictures declared
 * under 300 px are never fetched.
 */

export const DNESKAI_MEDIA_ORIGIN_KINDS = ['instagram-display', 'instagram-child', 'og-image', 'article-figure', 'feed-image'] as const;
export type DneskaiMediaOriginKind = (typeof DNESKAI_MEDIA_ORIGIN_KINDS)[number];
export interface DneskaiMediaPlanEntry {
  /** Zero-based place in the original carousel or article. */
  position: number;
  url: string;
  kind: DneskaiMediaOriginKind;
  /** Tried when `url` (a full-size rendition derived from it) cannot be fetched. */
  fallbackUrl?: string;
}

export const DNESKAI_MEDIA_INSTAGRAM_LIMIT = 10;
export const DNESKAI_MEDIA_FEED_LIMIT = 8;
/** The resolution gate (report §5.3): not a rights gate. Smaller pictures are stored and shown as small. */
export const DNESKAI_FULL_BLEED_MIN_SIDE = 900;
export const DNESKAI_INSET_MIN_WIDTH = 600;

export function dneskaiMediaCapabilities(size: { width: number; height: number }) {
  return { fullBleedCapable: Math.min(size.width, size.height) >= DNESKAI_FULL_BLEED_MIN_SIDE, insetCapable: size.width >= DNESKAI_INSET_MIN_WIDTH };
}

/**
 * True when the candidate's text is an Instagram caption that cannot stand for the media: a Reel or video,
 * a carousel with a video child, or an Instagram item collected before its type was recorded. The brief
 * and the prompt must then never present the caption as what the video says.
 */
export function dneskaiCaptionOnly(candidate: Pick<DneskaiCandidate, 'sourceId' | 'url' | 'instagram'>): boolean {
  if (!candidate.sourceId.startsWith('instagram:')) return false;
  if (/^\/(?:reels?|tv)\//.test(safePath(candidate.url))) return true;
  return candidate.instagram?.mediaType === undefined || candidate.instagram.mediaType === 'video' || candidate.instagram.containsVideo === true;
}
function safePath(url: string) { try { return new URL(url).pathname; } catch { return ''; } }

/** Instagram's own CDNs; the scraper hands back their signed, expiring URLs. */
const INSTAGRAM_MEDIA_DOMAINS = ['cdninstagram.com', 'fbcdn.net'];
export function isInstagramMediaHost(hostname: string) { return INSTAGRAM_MEDIA_DOMAINS.some((domain) => matchesDomain(hostname, domain)); }

export function instagramMediaPlan(candidate: Pick<DneskaiCandidate, 'mediaUrls'>): DneskaiMediaPlanEntry[] {
  return [...new Set(candidate.mediaUrls)].slice(0, DNESKAI_MEDIA_INSTAGRAM_LIMIT)
    .map((url, position) => ({ position, url, kind: position === 0 ? 'instagram-display' as const : 'instagram-child' as const }));
}

function matchesDomain(hostname: string, domain: string) {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);
/** eTLD+1 for the hosts DNESKAi reads; `regmedia.co.uk` → `regmedia.co.uk`, `cdn.arstechnica.net` → `arstechnica.net`. */
export function registrableDomain(hostname: string) {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.');
  const keep = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/**
 * CDNs a registered publisher serves its own article images from, beyond its own domain. Matched as the
 * host or a subdomain. Kept short and explicit: an unknown host is skipped, not guessed.
 */
const PUBLISHER_IMAGE_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  'anthropic-news': ['cdn.sanity.io'],
  'ars-technica': ['arstechnica.net'],
  'deepmind-blog': ['googleusercontent.com', 'storage.googleapis.com'],
  'google-research': ['googleusercontent.com', 'storage.googleapis.com'],
  'interconnects': ['substackcdn.com', 'substack-post-media.s3.amazonaws.com'],
  'meta-ai': ['fbcdn.net'],
  'openai-blog': ['ctfassets.net'],
  'social-media-today': ['divecdn.com'],
  'the-register': ['regmedia.co.uk'],
  'the-verge': ['vox-cdn.com'],
  'github-ai-releases': ['githubusercontent.com', 'githubassets.com'],
  'bluesky-language-models': ['cdn.bsky.app'],
};
/** Hosted-CMS image hosts that serve only what the site itself uploaded (WordPress Jetpack, Contentful, Sanity, Substack). */
const CMS_IMAGE_DOMAINS = ['wp.com', 'ctfassets.net', 'cdn.sanity.io', 'substackcdn.com'];

/** Which image hosts count as the publisher's own for one candidate page. */
export function publisherImageHostPolicy(source: Pick<DneskaiSource, 'id' | 'url'>, pageUrl: string) {
  const own = new Set([registrableDomain(new URL(pageUrl).hostname), registrableDomain(new URL(source.url).hostname)]);
  const known = [...(PUBLISHER_IMAGE_DOMAINS[source.id] ?? []), ...CMS_IMAGE_DOMAINS];
  return (hostname: string) => own.has(registrableDomain(hostname)) || known.some((domain) => matchesDomain(hostname, domain));
}

/** Registry names carry a section or an author; the credit names the publisher. */
const PUBLISHER_NAMES: Readonly<Record<string, string>> = { 'techcrunch-ai': 'TechCrunch', 'arxiv-cs-ai': 'arXiv', 'arxiv-cs-lg': 'arXiv', 'hn-frontpage': 'Hacker News' };
export function dneskaiPublisherName(source: Pick<DneskaiSource, 'id' | 'name'>) {
  return PUBLISHER_NAMES[source.id] ?? source.name.replace(/\s*\(.*\)\s*$/, '').replace(/\s+·\s+.*$/, '').trim();
}

/** Credit line for one candidate's pictures. Never empty. */
export function dneskaiMediaCredit(source: Pick<DneskaiSource, 'id' | 'name' | 'url' | 'kind'>, candidate: Pick<DneskaiCandidate, 'url' | 'instagram'>, pageUrl?: string): string {
  if (source.kind === 'instagram') {
    const profile = new URL(source.url).pathname.split('/').filter(Boolean)[0] ?? source.name;
    return bounded(`Foto: @${candidate.instagram?.ownerUsername ?? profile}`);
  }
  const host = new URL(pageUrl ?? candidate.url).hostname.toLowerCase();
  // An aggregator (Hacker News, Spaceflight News) links to another publisher's page: credit that site.
  const onSourceSite = registrableDomain(host) === registrableDomain(new URL(source.url).hostname);
  return bounded(`Obrázek: ${onSourceSite ? dneskaiPublisherName(source) : host.replace(/^www\./, '')}`);
}
function bounded(credit: string) {
  const value = credit.replace(/\s+/g, ' ').trim();
  return value.length <= 120 ? value : value.slice(0, 120).trimEnd();
}

/** Picks the largest candidate of a srcset (width descriptors first, then density). */
export function largestSrcsetCandidate(srcset: string): string | undefined {
  const candidates: Array<{ url: string; width?: number; density?: number }> = [];
  let index = 0;
  while (index < srcset.length) {
    while (index < srcset.length && /[\s,]/.test(srcset[index]!)) index += 1;
    let url = '';
    while (index < srcset.length && !/\s/.test(srcset[index]!)) url += srcset[index++];
    let descriptor = '';
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else {
      while (index < srcset.length && srcset[index] !== ',') descriptor += srcset[index++];
    }
    if (!url) continue;
    const width = /^\s*(\d+)w\s*$/.exec(descriptor)?.[1];
    const density = /^\s*(\d+(?:\.\d+)?)x\s*$/.exec(descriptor)?.[1];
    candidates.push({ url, ...(width ? { width: Number(width) } : {}), ...(density ? { density: Number(density) } : { ...(width ? {} : { density: 1 }) }) });
  }
  const byWidth = candidates.filter((candidate) => candidate.width !== undefined).sort((left, right) => right.width! - left.width!);
  if (byWidth.length) return byWidth[0]!.url;
  return candidates.sort((left, right) => (right.density ?? 1) - (left.density ?? 1))[0]?.url;
}

const RESIZE_PARAMETERS = ['resize', 'w', 'h', 'fit', 'crop', 'quality', 'strip', 'zoom', 'lossy', 'ssl', 'width', 'height'];
/** WordPress serves the original upload without its resize query; the resized URL stays the fallback. */
export function fullSizeImageUrl(raw: string): { url: string; fallbackUrl?: string } {
  const url = new URL(raw);
  if (!url.pathname.includes('/wp-content/uploads/') || !RESIZE_PARAMETERS.some((name) => url.searchParams.has(name))) return { url: url.href };
  for (const name of RESIZE_PARAMETERS) url.searchParams.delete(name);
  return { url: url.href, fallbackUrl: raw };
}

const EXCLUDED_EXTENSION = /\.(?:svgz?|gif|ico|avif|bmp|tiff?|heic)$/i;
const EXCLUDED_FORMAT_QUERY = /(?:^|[?&])(?:format|fm|f)=(?:svg|gif|avif)(?:&|$)/i;
const EXCLUDED_TOKENS = /(?:^|[^a-z])(?:avatars?|gravatar|authors?|byline|headshots?|logos?|logotype|icons?|favicons?|sprites?|badges?|emojis?|spinner|loader|placeholder|blank|spacer|tracking|beacon)(?:[^a-z]|$)/i;
const EXCLUDED_ALT = /(?:^|[^a-z])(?:avatar|headshot of the author|author photo|profile (?:photo|picture)|icon|favicon|emoji|spinner|placeholder)(?:[^a-z]|$)/i;
const EXCLUDED_CONTAINER = /(?:^|[^a-z])(?:author|byline|avatar|logo|related|recirc|newsletter|share|social|comments?|promo|advert|ads?|sponsor|sidebar|footer|nav|breadcrumbs?|icons?)(?:[^a-z]|$)/i;
const EXCLUDED_ELEMENTS = 'nav, footer, aside, form, noscript, [role=navigation], [role=contentinfo], [role=complementary]';

function usableImageUrl(raw: string | undefined, base: URL, allowHost: (hostname: string) => boolean): string | undefined {
  const value = raw?.trim();
  if (!value || /^(?:data|blob):/i.test(value)) return undefined;
  try {
    const url = parseSafeHttpsUrl(new URL(value, base).href);
    url.hash = '';
    if (url.href.length > 2048 || EXCLUDED_EXTENSION.test(url.pathname) || EXCLUDED_FORMAT_QUERY.test(url.search) || EXCLUDED_TOKENS.test(url.pathname)) return undefined;
    return allowHost(url.hostname) ? url.href : undefined;
  } catch { return undefined; }
}
const declaredSmall = (value: string | undefined) => value !== undefined && /^\d+$/.test(value.trim()) && Number(value) < 300;

/**
 * The article's pictures in publisher order: social-card meta images, the feed's own image, then every
 * figure and image of the article body, deduplicated, at most `limit`.
 */
export function extractArticleMedia(html: string, pageUrl: string, options: { allowHost: (hostname: string) => boolean; feedImages?: readonly string[]; limit?: number }): DneskaiMediaPlanEntry[] {
  const $ = cheerio.load(html);
  const page = new URL(pageUrl);
  const baseHref = $('base[href]').first().attr('href');
  let base = page;
  try { if (baseHref) { const declared = new URL(baseHref, page); if (declared.protocol === 'https:') base = declared; } } catch { /* the page URL stays the base */ }
  const found: Array<{ url: string; kind: DneskaiMediaOriginKind }> = [];
  const push = (raw: string | undefined, kind: DneskaiMediaOriginKind) => { const url = usableImageUrl(raw, base, options.allowHost); if (url) found.push({ url, kind }); };

  for (const selector of ["meta[property='og:image']", "meta[property='og:image:secure_url']", "meta[property='og:image:url']", "meta[name='twitter:image']", "meta[name='twitter:image:src']", "meta[property='twitter:image']"]) {
    $(selector).each((_, element) => push($(element).attr('content'), 'og-image'));
  }
  for (const image of options.feedImages ?? []) push(image, 'feed-image');

  const articles = $('article').toArray().map((element) => ({ element, text: $(element).find('p').text().length }));
  const container = articles.sort((left, right) => right.text - left.text)[0]?.element ?? $('main').get(0) ?? $('[role=main]').get(0) ?? $('body').get(0);
  if (container) {
    const inBody = container === $('body').get(0);
    $(container).find('picture, img').each((_, element) => {
      const node = $(element);
      if (element.type === 'tag' && element.name === 'img' && node.parent().is('picture')) return;
      if (node.closest(EXCLUDED_ELEMENTS).length || (inBody && node.closest('header, [role=banner]').length)) return;
      const ancestors = node.parentsUntil(container).toArray();
      if (ancestors.some((ancestor) => ancestor.type === 'tag' && EXCLUDED_CONTAINER.test(`${ancestor.attribs.class ?? ''} ${ancestor.attribs.id ?? ''}`))) return;
      const image = element.type === 'tag' && element.name === 'picture' ? node.find('img').first() : node;
      // Alt text describes the photograph ("the OpenAI logo on a phone"), so it is checked for chrome only.
      if (EXCLUDED_TOKENS.test(`${image.attr('class') ?? ''} ${image.attr('id') ?? ''}`) || EXCLUDED_ALT.test(image.attr('alt') ?? '')
        || declaredSmall(image.attr('width')) || declaredSmall(image.attr('height'))) return;
      const srcsets: string[] = [];
      if (element.type === 'tag' && element.name === 'picture') {
        node.find('source').each((__, source) => {
          const type = $(source).attr('type');
          if (type && !['image/jpeg', 'image/png', 'image/webp'].includes(type.toLowerCase())) return;
          const srcset = $(source).attr('srcset') ?? $(source).attr('data-srcset');
          if (srcset) srcsets.push(srcset);
        });
      }
      const own = image.attr('srcset') ?? image.attr('data-srcset') ?? image.attr('data-lazy-srcset');
      if (own) srcsets.push(own);
      const src = [image.attr('data-src'), image.attr('data-lazy-src'), image.attr('data-original'), image.attr('src')].find((value) => value && !/^data:/i.test(value.trim()));
      // srcset lists the renditions; the widest one across the picture's sources and the img wins.
      push((srcsets.length ? largestSrcsetCandidate(srcsets.join(', ')) : undefined) ?? src, 'article-figure');
    });
  }

  const seen = new Set<string>();
  const entries: DneskaiMediaPlanEntry[] = [];
  for (const item of found) {
    const { url, fallbackUrl } = fullSizeImageUrl(item.url);
    if (seen.has(url) || (fallbackUrl && seen.has(fallbackUrl))) continue;
    seen.add(url); if (fallbackUrl) seen.add(fallbackUrl);
    entries.push({ position: entries.length, url, kind: item.kind, ...(fallbackUrl ? { fallbackUrl } : {}) });
    if (entries.length >= (options.limit ?? DNESKAI_MEDIA_FEED_LIMIT)) break;
  }
  return entries;
}
