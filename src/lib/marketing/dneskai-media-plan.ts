import { sanitizeExternalContent } from "./free-feeds/security/content";
import * as cheerio from 'cheerio';
import type { DneskaiCandidate, DneskaiSource } from './dneskai-contracts';
import { parseSafeHttpsUrl } from './free-feeds/security/url';
import { DNESKAI_MEDIA_ORIGIN_KINDS, type DneskaiMediaOriginKind } from './dneskai-media-contracts';

/**
 * Which source pictures the DNESKAi media collector (#114) fetches for a selected candidate, in what
 * order, and how each is credited. Pure: no network, storage or clock.
 *
 * Instagram: carousel children first, then unique fallback image/display renditions, at most ten. Feed: the article page's og:image / twitter:image, the feed's own image and
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
  /** Publisher metadata, untrusted and never a vision description. */
  sourceAltText?: string;
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

/**
 * What one picture says about its own origin: its URL, the publisher's alt text and figure caption
 * (`sourceAltText`), and the credit fields embedded in the file (IPTC and XMP, `dneskaiEmbeddedCredits`).
 */
export interface DneskaiPictureSignals { url?: string; sourceAltText?: string; embeddedCredits?: readonly string[] }

const bounds = (pattern: string) => `(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`;
/**
 * Photo agencies DNESKAi credits by name. `text` matches inside a credit (a caption's credit part or an embedded
 * credit field); the short uppercase names (AP, AFP, EPA, ČTK) match only as written. `file` matches a token of
 * the picture's URL path, only for names that do not occur there by chance.
 */
const AGENCIES: ReadonlyArray<{ name: string; text: RegExp; file?: RegExp }> = [
  { name: 'Getty Images', text: new RegExp(bounds('[Gg]etty\\s*[Ii]mages|GETTY\\s*IMAGES'), 'u'), file: /(?:^|[^a-z])getty[-_ ]?images(?:[^a-z]|$)/i },
  { name: 'Reuters', text: new RegExp(bounds('Reuters|REUTERS'), 'u'), file: /(?:^|[^a-z])reuters(?:[^a-z]|$)/i },
  { name: 'AP', text: new RegExp(bounds('AP(?:\\s+Photo)?|Associated\\s+Press'), 'u') },
  { name: 'AFP', text: new RegExp(bounds('AFP'), 'u'), file: /(?:^|[^a-z])afp(?:[^a-z]|$)/i },
  { name: 'Shutterstock', text: new RegExp(bounds('[Ss]hutterstock|SHUTTERSTOCK'), 'u'), file: /shutterstock/i },
  { name: 'Alamy', text: new RegExp(bounds('Alamy|ALAMY'), 'u'), file: /(?:^|[^a-z])alamy(?:[^a-z]|$)/i },
  { name: 'EPA', text: new RegExp(bounds('EPA(?:-EFE)?'), 'u') },
  { name: 'Bloomberg', text: new RegExp(bounds('Bloomberg'), 'u') },
  { name: 'ČTK', text: new RegExp(bounds('ČTK|CTK'), 'u') },
];
/** Partners Getty Images distributes: „Bloomberg via Getty Images“ is credited as „Bloomberg / Getty Images“. */
const GETTY_PARTNER = /(?<![\p{L}\p{N}])(Bloomberg|AFP|NurPhoto|SOPA Images|Anadolu|AP)(?:\s+(?:via|přes)\s+|\s*\/\s*)Getty\s*Images/iu;
const CREDIT_LABELS = String.raw`Image\s+Credits?|Photo(?:graph)?\s+Credits?|Credits?|Photo(?:graph)?(?:\s+by)?|Image(?:\s+by)?|Picture|Illustration|Foto(?:grafie)?|Obrázek|Zdroj\s+fotografie|Zdroj\s+foto`;
/** The parts of a caption or alt text that are a credit: after a credit label, after ©, an „(AP Photo/…)“ or a „/ Agency“ tail. */
function creditSegments(text: string): string[] {
  const segments: string[] = [];
  for (const match of text.matchAll(new RegExp(`(?:${CREDIT_LABELS})\\s*:\\s*([^·\\n]{1,160})`, 'giu'))) segments.push(match[1]!);
  for (const match of text.matchAll(/Photo(?:graph)?\s+by\s+([^·\n]{1,160})/giu)) segments.push(match[1]!);
  for (const match of text.matchAll(/(?:©|\(c\)|Copyright)\s*([^·\n]{1,120})/giu)) segments.push(match[1]!);
  for (const match of text.matchAll(/\(\s*(AP\s+Photo[^)]{0,100})\)/gu)) segments.push(match[1]!);
  for (const match of text.matchAll(/\bREUTERS\s*\//gu)) segments.push(match[0]);
  // „Jakub Porzycki/NurPhoto via Getty Images“, „Justin Sullivan / Getty Images“: an agency right after a slash or „via“.
  for (const match of text.matchAll(/(?:\/|\svia\s)\s*([^·\n/]{1,60})/gu)) if (AGENCIES.some((agency) => startsWith(agency.text).test(match[1]!))) segments.push(match[1]!);
  return segments;
}
const startsWith = (pattern: RegExp) => new RegExp(`^(?:${pattern.source})`, pattern.flags);
function agenciesIn(text: string): string[] {
  const partner = GETTY_PARTNER.exec(text)?.[1];
  if (partner) {
    const name = AGENCIES.find((agency) => agency.text.test(partner))?.name ?? partner.replace(/\b\w/g, (letter) => letter.toUpperCase());
    return [`${name} / Getty Images`];
  }
  return AGENCIES.filter((agency) => agency.text.test(text)).map((agency) => agency.name);
}
function urlPath(url: string): string {
  try { const parsed = new URL(url); return decodeURIComponent(`${parsed.pathname}${parsed.search}`); } catch { return ''; }
}

/**
 * The photo agency one picture names, or `null`. Only explicit signals count: a credit field embedded in the
 * file, the credit part of the caption or alt text, or an agency's name as a token of the image URL („GettyImages-
 * 1234.jpg“). An agency merely mentioned in a caption („the Reuters building“) does not count, and two different
 * agencies give `null`: the credit then names the publisher alone rather than guess.
 */
export function dneskaiPictureAgency(signals: DneskaiPictureSignals): string | null {
  const found = new Set<string>();
  for (const field of signals.embeddedCredits ?? []) for (const name of agenciesIn(field)) found.add(name);
  for (const segment of creditSegments(signals.sourceAltText ?? '')) for (const name of agenciesIn(segment)) found.add(name);
  const path = signals.url ? urlPath(signals.url) : '';
  for (const agency of AGENCIES) if (agency.file?.test(path)) found.add(agency.name);
  // „Bloomberg / Getty Images“ already names Getty Images and its partner.
  for (const name of [...found]) if (name.endsWith(' / Getty Images')) { found.delete('Getty Images'); found.delete(name.replace(' / Getty Images', '')); }
  return found.size === 1 ? [...found][0]! : null;
}

/**
 * Credit line for one candidate's pictures, or for one picture of it when its signals are given. Never empty.
 * A feed picture whose own signals name a photo agency credits both: „Foto: Getty Images přes TechCrunch“.
 */
export function dneskaiMediaCredit(source: Pick<DneskaiSource, 'id' | 'name' | 'url' | 'kind'>, candidate: Pick<DneskaiCandidate, 'url' | 'instagram'>, pageUrl?: string, picture?: DneskaiPictureSignals): string {
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
  const publisher = onSourceSite ? dneskaiPublisherName(source) : host.replace(/^www\./, '');
  const agency = picture ? dneskaiPictureAgency(picture) : null;
  if (agency) return bounded(agency.toLocaleLowerCase('cs') === publisher.toLocaleLowerCase('cs') ? `Foto: ${agency}` : `Foto: ${agency} přes ${publisher}`);
  return bounded(`Obrázek: ${publisher}`);
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

function usableImageUrl(raw: string | undefined, base: URL, allowImage: DneskaiImageUrlPolicy, refused?: (url: URL) => void): string | undefined {
  const value = raw?.trim();
  if (!value || /^(?:data|blob):/i.test(value)) return undefined;
  try {
    const url = parseSafeHttpsUrl(new URL(value, base).href);
    url.hash = '';
    if (url.href.length > 2048 || EXCLUDED_EXTENSION.test(url.pathname) || EXCLUDED_FORMAT_QUERY.test(url.search) || chromePath(url.pathname)) return undefined;
    if (allowImage(url)) return url.href;
    refused?.(url);
    return undefined;
  } catch { return undefined; }
}
const declaredSmall = (value: string | undefined) => value !== undefined && /^\d+$/.test(value.trim()) && Number(value) < 300;

/**
 * The article's pictures in publisher order: social-card meta images, the feed's own image, then every
 * figure and image of the article body, deduplicated, at most `limit`.
 */
/**
 * The host a refused picture is counted under: the proxied host for an image proxy, else the registrable domain.
 * Public CDN names only, so the publisher allowlist can be extended from evidence instead of guesses (M-08).
 */
function refusedImageHost(url: URL): string {
  const proxied = proxiedImageHost(url);
  return registrableDomain(proxied ?? url.hostname);
}

export function extractArticleMedia(html: string, pageUrl: string, options: { allowImage: DneskaiImageUrlPolicy; feedImages?: readonly string[]; limit?: number; refusedHosts?: Map<string, number> }): DneskaiMediaPlanEntry[] {
  const $ = cheerio.load(html);
  const page = new URL(pageUrl);
  const baseHref = $('base[href]').first().attr('href');
  let base = page;
  try { if (baseHref) { const declared = new URL(baseHref, page); if (declared.protocol === 'https:') base = declared; } } catch { /* the page URL stays the base */ }
  const found: Array<{ url: string; kind: DneskaiMediaOriginKind; sourceAltText?: string }> = [];
  // Each distinct refused picture counts once under its host, however many tags name it.
  const refusedSeen = new Set<string>();
  const countRefused = options.refusedHosts && ((refused: URL) => {
    if (refusedSeen.has(refused.href)) return;
    refusedSeen.add(refused.href);
    const host = refusedImageHost(refused);
    options.refusedHosts!.set(host, (options.refusedHosts!.get(host) ?? 0) + 1);
  });
  const push = (raw: string | undefined, kind: DneskaiMediaOriginKind, alt?:string) => {
    const url = usableImageUrl(raw, base, options.allowImage, countRefused);const sourceAltText=cleanSourceText(alt??"",1000);
    if (url) found.push({ url, kind, ...(sourceAltText?{sourceAltText}:{}) });
  };

  for (const selector of ["meta[property='og:image']", "meta[property='og:image:secure_url']", "meta[property='og:image:url']", "meta[name='twitter:image']", "meta[name='twitter:image:src']", "meta[property='twitter:image']"]) {
    $(selector).each((_, element) => push($(element).attr('content'), 'og-image', $("meta[property='og:image:alt'], meta[name='twitter:image:alt']").first().attr('content')));
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
      push((srcsets.length ? largestSrcsetCandidate(srcsets.join(', ')) : undefined) ?? src, 'article-figure', [image.attr('alt'),image.closest('figure').find('figcaption').text()].filter(Boolean).join(' · '));
    });
  }

  const seen = new Set<string>();
  const entries: DneskaiMediaPlanEntry[] = [];
  for (const item of found) {
    const { url, fallbackUrl } = fullSizeImageUrl(item.url);
    if (seen.has(url) || (fallbackUrl && seen.has(fallbackUrl))) {
      const previous=entries.find(entry=>entry.url===url||entry.url===fallbackUrl||entry.fallbackUrl===url);
      if(previous&&!previous.sourceAltText&&item.sourceAltText)previous.sourceAltText=item.sourceAltText;
      continue;
    }
    seen.add(url); if (fallbackUrl) seen.add(fallbackUrl);
    entries.push({ position: entries.length, url, kind: item.kind, ...(fallbackUrl ? { fallbackUrl } : {}), ...(item.sourceAltText?{sourceAltText:item.sourceAltText}:{}) });
    if (entries.length >= (options.limit ?? DNESKAI_MEDIA_FEED_LIMIT)) break;
  }
  return entries;
}


function cleanSourceText(value:string,max:number):string {
 const clean=sanitizeExternalContent(value,max);return clean.promptInjectionSignals.length?"":clean.text;
}
/** Public article prose from the page already fetched for pictures. Navigation and instructions are excluded. */
export function extractArticleText(html:string):string {
 const $=cheerio.load(html);
 $('script,style,noscript,nav,header,footer,aside,form,[hidden],[aria-hidden="true"]').remove();
 const articles=$('article').toArray().sort((a,b)=>$(b).find('p').text().length-$(a).find('p').text().length);
 const container=articles[0]??$('main,[role=main]').first().get(0);if(!container)return "";
 const paragraphs=$(container).find('p,h1,h2,h3,li,blockquote').toArray().filter(el=>!$(el).parentsUntil(container).is('nav,aside,form'));
 return cleanSourceText(paragraphs.map(el=>$(el).text().trim()).filter(Boolean).join('\n'),4000);
}
