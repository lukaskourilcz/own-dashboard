import * as cheerio from 'cheerio';
import type { DneskaiCandidate, DneskaiSource } from './dneskai-contracts';
import { parseSafeHttpsUrl } from './free-feeds/security/url';
import { DNESKAI_MEDIA_ORIGIN_KINDS, type DneskaiMediaOriginKind } from './dneskai-media-contracts';

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

export { DNESKAI_MEDIA_ORIGIN_KINDS, type DneskaiMediaOriginKind };
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

/** Decides whether one image URL may be fetched for a candidate. */
export type DneskaiImageUrlPolicy = (url: URL) => boolean;

/** Instagram's own CDNs; the scraper hands back their signed, expiring URLs. */
const INSTAGRAM_MEDIA_DOMAINS = ['cdninstagram.com', 'fbcdn.net'];
export function isInstagramMediaHost(hostname: string) { return INSTAGRAM_MEDIA_DOMAINS.some((domain) => matchesDomain(hostname, domain)); }
export const instagramImageUrlPolicy: DneskaiImageUrlPolicy = (url) => isInstagramMediaHost(url.hostname);

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
  'interconnects': ['substack-post-media.s3.amazonaws.com'],
  'meta-ai': ['fbcdn.net'],
  'openai-blog': ['ctfassets.net'],
  'social-media-today': ['divecdn.com'],
  'the-register': ['regmedia.co.uk'],
  'the-verge': ['vox-cdn.com'],
  'github-ai-releases': ['githubusercontent.com', 'githubassets.com'],
  'bluesky-language-models': ['cdn.bsky.app'],
};
/**
 * Image proxies that resize any public picture: WordPress Jetpack (`i0.wp.com/<host>/<path>`), Substack
 * (`substackcdn.com/image/fetch/<options>/<encoded URL>`) and GitHub's camo (`camo.githubusercontent.com/
 * <digest>/<hex URL>`). Their own host says nothing about whose picture it is, so the proxied host decides.
 */
function proxiedImageHost(url: URL): string | null | undefined {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').slice(1);
  try {
    if (/^i[0-3]\.wp\.com$/.test(host)) return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(segments[0] ?? '') ? segments[0]!.toLowerCase() : null;
    if (matchesDomain(host, 'substackcdn.com')) {
      if (segments[0] !== 'image' || segments[1] !== 'fetch') return null;
      const target = segments.slice(2).find((segment) => /^https?%3A/i.test(segment));
      return target ? new URL(decodeURIComponent(target)).hostname.toLowerCase() : null;
    }
    if (host === 'camo.githubusercontent.com') {
      const hex = segments[1] ?? '';
      return /^(?:[0-9a-f]{2})+$/i.test(hex) ? new URL(new TextDecoder().decode(Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16)))).hostname.toLowerCase() : null;
    }
  } catch { return null; }
  return undefined;
}

/**
 * Which image URLs count as the publisher's own for one candidate page: its domain (page or registered
 * source), a CDN it is known to serve its images from, or an image proxy carrying one of those.
 */
export function publisherImageUrlPolicy(source: Pick<DneskaiSource, 'id' | 'url'>, pageUrl: string): DneskaiImageUrlPolicy {
  const own = new Set([registrableDomain(new URL(pageUrl).hostname), registrableDomain(new URL(source.url).hostname)]);
  const known = PUBLISHER_IMAGE_DOMAINS[source.id] ?? [];
  const publisherHost = (hostname: string) => own.has(registrableDomain(hostname)) || known.some((domain) => matchesDomain(hostname, domain));
  return (url) => {
    const proxied = proxiedImageHost(url);
    if (proxied === undefined) return publisherHost(url.hostname);
    // A proxy inside a proxy is refused.
    return proxied !== null && proxiedImageHost(new URL(`https://${proxied}/`)) === undefined && publisherHost(proxied);
  };
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
  const page = new URL(pageUrl ?? candidate.url);
  const host = page.hostname.toLowerCase();
  const author = platformAuthor(source, page);
  if (author) return bounded(`Obrázek: ${author}`);
  // An aggregator (Hacker News, Spaceflight News) links to another publisher's page: credit that site.
  const sites = [registrableDomain(new URL(source.url).hostname), ...(SOURCE_SITES[source.id] ?? [])];
  const onSourceSite = sites.includes(registrableDomain(host));
  return bounded(`Obrázek: ${onSourceSite ? dneskaiPublisherName(source) : host.replace(/^www\./, '')}`);
}
/** Registered API hosts whose candidates live on another domain of the same publisher. */
const SOURCE_SITES: Readonly<Record<string, readonly string[]>> = { 'stackexchange-ml': ['stackoverflow.com'] };
/** A post on a platform belongs to its author: the credit names the account, not the platform. */
function platformAuthor(source: Pick<DneskaiSource, 'kind'>, page: URL): string | undefined {
  const segments = page.pathname.split('/').filter(Boolean).map((segment) => { try { return decodeURIComponent(segment); } catch { return ''; } });
  if (source.kind === 'bluesky' && segments[0] === 'profile' && segments[2] === 'post' && /^[a-z0-9.:-]{1,253}$/i.test(segments[1] ?? '')) return `@${segments[1]} (Bluesky)`;
  if (source.kind === 'github' && page.hostname === 'github.com' && /^[a-z0-9-]{1,39}$/i.test(segments[0] ?? '') && /^[a-z0-9._-]{1,100}$/i.test(segments[1] ?? '')) return `${segments[0]}/${segments[1]} (GitHub)`;
  return undefined;
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
const CHROME_WORDS = 'avatars?|gravatar|authors?|bylines?|headshots?|logos?|logotype|icons?|favicons?|sprites?|badges?|emojis?|spinner|loader|placeholder|blank|spacer|tracking|beacon|pixel';
const EXCLUDED_TOKENS = new RegExp(`(?:^|[^a-z])(?:${CHROME_WORDS})(?:[^a-z]|$)`, 'i');
const CHROME_WORD = new RegExp(`^(?:${CHROME_WORDS})$`, 'i');
const SIZE_TOKEN = /^(?:\d+x\d+|\d+w|\d+x|\d{1,2})$/;
/**
 * Chrome by path: a folder named for it (`/avatars/`, `/icons/`) or a short file name built around it
 * (`logo.png`, `site-logo-dark.png`, `favicon-32x32.png`). A descriptive editorial file name that merely
 * mentions a logo or an icon (`openai-logo-GettyImages-1234.jpg`) is a photograph and stays.
 */
function chromePath(pathname: string) {
  const segments = pathname.toLowerCase().split('/').filter(Boolean);
  const file = segments.pop() ?? '';
  if (segments.some((segment) => CHROME_WORD.test(segment))) return true;
  const words = file.replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter((word) => word && !SIZE_TOKEN.test(word));
  return words.length <= 3 && words.some((word) => CHROME_WORD.test(word));
}
const EXCLUDED_ALT = /(?:^|[^a-z])(?:avatar|headshot of the author|author photo|profile (?:photo|picture)|icon|favicon|emoji|spinner|placeholder)(?:[^a-z]|$)/i;
const EXCLUDED_CONTAINER = /(?:^|[^a-z])(?:author|byline|avatar|logo|related|recirc|newsletter|share|social|comments?|promo|advert|ads?|sponsor|sidebar|footer|nav|breadcrumbs?|icons?)(?:[^a-z]|$)/i;
const EXCLUDED_ELEMENTS = 'nav, footer, aside, form, noscript, [role=navigation], [role=contentinfo], [role=complementary]';

function usableImageUrl(raw: string | undefined, base: URL, allowImage: DneskaiImageUrlPolicy): string | undefined {
  const value = raw?.trim();
  if (!value || /^(?:data|blob):/i.test(value)) return undefined;
  try {
    const url = parseSafeHttpsUrl(new URL(value, base).href);
    url.hash = '';
    if (url.href.length > 2048 || EXCLUDED_EXTENSION.test(url.pathname) || EXCLUDED_FORMAT_QUERY.test(url.search) || chromePath(url.pathname)) return undefined;
    return allowImage(url) ? url.href : undefined;
  } catch { return undefined; }
}
const declaredSmall = (value: string | undefined) => value !== undefined && /^\d+$/.test(value.trim()) && Number(value) < 300;

/**
 * The article's pictures in publisher order: social-card meta images, the feed's own image, then every
 * figure and image of the article body, deduplicated, at most `limit`.
 */
export function extractArticleMedia(html: string, pageUrl: string, options: { allowImage: DneskaiImageUrlPolicy; feedImages?: readonly string[]; limit?: number }): DneskaiMediaPlanEntry[] {
  const $ = cheerio.load(html);
  const page = new URL(pageUrl);
  const baseHref = $('base[href]').first().attr('href');
  let base = page;
  try { if (baseHref) { const declared = new URL(baseHref, page); if (declared.protocol === 'https:') base = declared; } } catch { /* the page URL stays the base */ }
  const found: Array<{ url: string; kind: DneskaiMediaOriginKind }> = [];
  const push = (raw: string | undefined, kind: DneskaiMediaOriginKind) => { const url = usableImageUrl(raw, base, options.allowImage); if (url) found.push({ url, kind }); };

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
