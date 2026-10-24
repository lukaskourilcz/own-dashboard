import sharp from 'sharp';
import { createHash } from 'node:crypto';

/**
 * The outside world of one simulated DNESKAi night, offline and synthetic: publisher feeds and article pages,
 * the publishers' image hosts, Apify's Instagram scraper, TypeSafe's Jev classifier, the Anthropic Messages
 * API and the Instagram Graph API. Every request lands in `calls`; a request to a host nobody serves fails like
 * a network error and lands in `unknown`, so the test can prove that nothing left the process.
 *
 * Every fact here is invented for the test. No real article, post, account, photograph or quote is used.
 */
export type Call = { method: string; url: string; host: string; at: string; body?: string };
type Handler = (request: Request, url: URL) => Promise<Response> | Response;

export class FakeInternet {
  readonly calls: Call[] = [];
  readonly unknown: string[] = [];
  private readonly hosts = new Map<string, Handler>();
  constructor(readonly clock: () => Date) {}
  route(host: string, handler: Handler) { this.hosts.set(host, handler); return this; }
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request && !init ? input : new Request(input instanceof URL ? input.href : input, init);
    const url = new URL(request.url);
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.clone().text().catch(() => undefined);
    this.calls.push({ method: request.method, url: request.url, host: url.hostname, at: this.clock().toISOString(), ...(body !== undefined && body.length < 20000 ? { body } : {}) });
    const handler = this.hosts.get(url.hostname);
    if (!handler) { this.unknown.push(request.url); throw new TypeError(`fetch failed: no fake host ${url.hostname}`); }
    // Keep and observe the caller's signal for the whole fake fetch, just as
    // native fetch does. A Request's dependent signal alone must not leave a
    // hanging handler waiting forever after its original deadline is released.
    const signal = init?.signal ?? request.signal;
    signal.throwIfAborted();
    let aborted: (() => void) | undefined;
    try {
      return await new Promise<Response>((resolve, reject) => {
        aborted = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        signal.addEventListener('abort', aborted, { once: true });
        Promise.resolve().then(() => handler(request, url)).then(resolve, reject);
      });
    } finally { if (aborted) signal.removeEventListener('abort', aborted); }
  };
  count(predicate: (call: Call) => boolean) { return this.calls.filter(predicate).length; }
}

// ------------------------------------------------------------------ pictures
const PALETTES = [['#1d3557', '#457b9d', '#f1faee'], ['#2b2d42', '#ef233c', '#edf2f4'], ['#264653', '#2a9d8f', '#e9c46a'], ['#3a0ca3', '#4361ee', '#4cc9f0'],
  ['#5f0f40', '#9a031e', '#fb8b24'], ['#023047', '#219ebc', '#ffb703'], ['#283618', '#606c38', '#fefae0'], ['#22223b', '#4a4e69', '#c9ada7']];
/** A synthetic JPEG with its own composition, so no two fixtures share a perceptual hash, and a visible label. */
export async function fixtureJpeg(width: number, height: number, seed: number, label: string): Promise<Buffer> {
  const [dark, mid, light] = PALETTES[seed % PALETTES.length]!;
  const shapes = Array.from({ length: 7 }, (_, index) => {
    const n = (seed * 7919 + index * 104729) % 9973;
    const x = (n * 37) % width, y = (n * 53) % height, r = 80 + (n % 260);
    return index % 2 ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${index % 3 ? mid : light}" fill-opacity="0.55"/>`
      : `<rect x="${x - r}" y="${y - r / 2}" width="${r * 2}" height="${r}" rx="24" fill="${light}" fill-opacity="0.35" transform="rotate(${n % 40 - 20} ${x} ${y})"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="${seed % 2}" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>${shapes}
    <rect x="40" y="${height - 150}" width="${Math.min(width - 80, 880)}" height="110" rx="12" fill="#000" fill-opacity="0.45"/>
    <text x="70" y="${height - 80}" font-family="DejaVu Sans, sans-serif" font-size="44" fill="#fff">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

// ------------------------------------------------------------------ the night's news
export const NIGHT = { date: '2026-10-26', target: '2026-10-27' } as const;
export type Picture = { url: string; width: number; height: number; label: string; bytes?: Buffer };
export const PICTURES = {
  anthropicCover: { url: 'https://cdn.sanity.io/images/fixture/production/team-memory-cover.jpg', width: 1600, height: 900, label: 'A1 og:image 1600x900' },
  anthropicFigure: { url: 'https://cdn.sanity.io/images/fixture/production/team-memory-settings.jpg', width: 1080, height: 1350, label: 'A1 figure 1080x1350' },
  techcrunchCover: { url: 'https://techcrunch.com/wp-content/uploads/2026/10/claude-memory.jpg', width: 1600, height: 900, label: 'A2 og:image 1600x900' },
  techcrunchFigure: { url: 'https://techcrunch.com/wp-content/uploads/2026/10/claude-memory-admin.jpg', width: 1080, height: 1350, label: 'A2 figure 1080x1350' },
  metaDisplay: { url: 'https://scontent-prg1-1.cdninstagram.com/v/t51.fixture/translate-1.jpg?stp=dst-jpg&_nc_ht=fixture', width: 1080, height: 1350, label: 'B child 1 1080x1350' },
  metaChild2: { url: 'https://scontent-prg1-1.cdninstagram.com/v/t51.fixture/translate-2.jpg?stp=dst-jpg&_nc_ht=fixture', width: 1080, height: 1350, label: 'B child 2 1080x1350' },
  metaChild3: { url: 'https://scontent-prg1-1.cdninstagram.com/v/t51.fixture/translate-3.jpg?stp=dst-jpg&_nc_ht=fixture', width: 1600, height: 900, label: 'B child 3 1600x900' },
} satisfies Record<string, Picture>;

export const STORIES = {
  a1: { source: 'anthropic-news', url: 'https://www.anthropic.com/news/shared-memory-team-workspaces', title: 'Shared memory for Claude Team workspaces',
    summary: 'Claude Team and Enterprise workspaces can now keep a shared project memory that every member can review and edit. Administrators decide which projects use it, and it stays off by default for existing workspaces.',
    published: '2026-10-26T15:00:00Z' },
  a2: { source: 'techcrunch-ai', url: 'https://techcrunch.com/2026/10/26/anthropic-claude-team-shared-memory/', title: 'Anthropic gives Claude teams a shared memory they can edit',
    summary: 'The feature lets colleagues see and correct what Claude remembers about a project. Anthropic says administrators control it and that it is off by default for existing customers; pricing does not change. Each project keeps its own memory, so facts from one client project do not appear in another. Members can open the memory panel, see every saved fact with the conversation it came from, and correct or delete it; an administrator can clear a whole project at once. Anthropic says the memory is used only inside the workspace and is not used to train its models. It did not say how long deleted facts stay in backups or whether the memory can be exported, and it has not published an independent review of the feature.',
    published: 'Mon, 26 Oct 2026 17:20:00 +0000' },
  b: { source: 'instagram:meta.ai', url: 'https://www.instagram.com/p/DfixtureTr4n/', caption: 'Live translation is rolling out in the Meta AI app. Speak in one language and hear the reply in another during voice chats, starting with English, Spanish, French, German and Italian. Tap the globe icon in a voice chat to try it.\n\nBoth people hear the conversation in their own language, and the app shows a written transcript of each turn next to the audio. Meta says the translation runs in the voice chat itself, so nobody has to install a separate app or switch modes. The feature is rolling out gradually and may take a few weeks to reach everyone. Meta asks people to report mistranslations from the chat menu and says it will add more languages after it has reviewed the first feedback. It did not say which countries come first.',
    published: '2026-10-26T18:40:00.000Z' },
  /** Tuesday's follow-up of event A: a new URL and headline that Jev does not link, and the same share image as a2. */
  a3: { source: 'techcrunch-ai', url: 'https://techcrunch.com/2026/10/27/what-claude-team-memory-means-for-admins/', title: 'What Claude team memory means for workspace admins',
    summary: 'A day after the launch, administrators ask how long Claude keeps team memory and who can export it. Anthropic points to its workspace settings and says memory is still off by default.',
    published: 'Tue, 27 Oct 2026 15:00:00 +0000', visibleFrom: '2026-10-27T15:00:00Z' },
  /** Tuesday's picture-less report (briefs-01): a long feed text and no image in the feed or on the page, so the brief is a carousel of text slides. */
  c: { source: 'hf-blog', url: 'https://huggingface.co/blog/fixture-open-speech-model', title: 'An open speech model that transcribes meetings on a laptop',
    summary: 'Hugging Face and a group of university labs released an open speech recognition model that runs on an ordinary laptop without a graphics card. The authors say it transcribes meetings in English, German and Spanish and marks who is speaking. The weights and the training code are public under an Apache license, and the training data comes from recordings whose speakers agreed to their use. The post compares the model with closed transcription services on public test sets and says it makes more mistakes on noisy phone calls. It does not run in a browser yet, and the authors ask for help with more languages. They also say the model should not be used to transcribe people who have not been told they are recorded, and that the license does not change local recording laws.',
    published: 'Tue, 27 Oct 2026 14:00:00 +0000', visibleFrom: '2026-10-27T14:00:00Z' },
} as const;
/** Reports Jev rejects: real-looking feed items about other things. */
export const NOISE = [
  { source: 'the-verge', url: 'https://www.theverge.com/2026/10/26/fixture-headphones', title: 'The best noise-cancelling headphones for long flights', published: 'Mon, 26 Oct 2026 09:00:00 +0000' },
  { source: 'wired-ai', url: 'https://www.wired.com/story/fixture-ai-poetry-contest/', title: 'A poetry contest asks whether readers can spot the machine', published: 'Mon, 26 Oct 2026 08:10:00 +0000' },
  { source: 'ars-technica', url: 'https://arstechnica.com/gadgets/2026/10/fixture-keyboard-review/', title: 'Review: a split mechanical keyboard that folds into a pocket', published: 'Mon, 26 Oct 2026 07:30:00 +0000' },
  { source: 'deepmind-blog', url: 'https://deepmind.google/discover/blog/fixture-team-offsite/', title: 'Notes from our autumn team offsite in the mountains', published: 'Mon, 26 Oct 2026 06:45:00 +0000' },
  { source: 'openai-blog', url: 'https://openai.com/index/fixture-residency-applications/', title: 'Applications open for the next residency cohort', published: 'Mon, 26 Oct 2026 06:20:00 +0000' },
] as const;
export const HN_STORY = { id: 41999001, title: 'Ask HN: What is your favourite text editor theme?', time: Date.parse('2026-10-26T05:50:00Z') / 1000, by: 'fixture' };

const rss = (channel: string, items: Array<{ title: string; link: string; pubDate: string; description: string; image?: string }>) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${channel}</title><link>https://example.test/</link><description>fixture</description>
${items.map((item) => `<item><title>${item.title}</title><link>${item.link}</link><guid>${item.link}</guid><pubDate>${item.pubDate}</pubDate><description>${item.description}</description>${item.image ? `<media:content url="${item.image.replace(/&/g, '&amp;')}" medium="image" />` : ''}</item>`).join('\n')}
</channel></rss>`;
const page = (title: string, og: string, published: string, body: string) => `<!doctype html><html><head><title>${title}</title>
<meta property="og:image" content="${og}"><meta property="article:published_time" content="${published}"></head>
<body><header><img src="https://example.test/logo.png" alt="logo"></header><main><article><h1>${title}</h1>${body}</article></main><footer>fixture footer</footer></body></html>`;

const xml = (text: string) => new Response(text, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
const html = (text: string) => new Response(text, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const json = (value: unknown, status = 200) => Response.json(value, { status });

/** Feed and article fixtures for every source due on Monday, 26 October 2026, and their image hosts. */
export async function routePublishers(internet: FakeInternet) {
  const images = new Map<string, Buffer>();
  let seed = 1;
  for (const picture of Object.values(PICTURES) as Picture[]) {
    picture.bytes = await fixtureJpeg(picture.width, picture.height, seed++, picture.label);
    images.set(new URL(picture.url).origin + new URL(picture.url).pathname, picture.bytes);
  }
  const imageHost: Handler = (_request, url) => {
    const bytes = images.get(url.origin + url.pathname);
    return bytes ? new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) } }) : new Response('not found', { status: 404 });
  };
  internet.route('cdn.sanity.io', imageHost).route('scontent-prg1-1.cdninstagram.com', imageHost);
  internet.route('www.anthropic.com', (_request, url) => {
    if (url.pathname === '/news') return html(`<!doctype html><html><body><main>
      <section><article><a href="/news/shared-memory-team-workspaces"><h3>${STORIES.a1.title}</h3></a><p>${STORIES.a1.summary}</p><time datetime="${STORIES.a1.published}">Oct 26, 2026</time></article>
      <article><a href="/news/fixture-older-update"><h3>An older product update from last month</h3></a><p>Older listing entry that falls before the collection window and is skipped.</p><time datetime="2026-09-01T10:00:00Z">Sep 1, 2026</time></article></section></main></body></html>`);
    if (url.pathname === '/news/shared-memory-team-workspaces') return html(page(STORIES.a1.title, PICTURES.anthropicCover.url, STORIES.a1.published,
      `<p>${STORIES.a1.summary}</p><figure><img src="${PICTURES.anthropicFigure.url}" alt="Workspace settings with the memory switch" width="1080" height="1350"></figure><p>Members see each saved fact and can correct or delete it.</p>`));
    return new Response('not found', { status: 404 });
  });
  internet.route('techcrunch.com', (request, url) => {
    if (url.pathname === '/category/artificial-intelligence/feed/') return xml(rss('TechCrunch AI', [
      ...(internet.clock().getTime() >= Date.parse(STORIES.a3.visibleFrom) ? [{ title: STORIES.a3.title, link: STORIES.a3.url, pubDate: STORIES.a3.published, description: STORIES.a3.summary, image: `${PICTURES.techcrunchCover.url}?resize=1200,675` }] : []),
      { title: STORIES.a2.title, link: STORIES.a2.url, pubDate: STORIES.a2.published, description: STORIES.a2.summary, image: `${PICTURES.techcrunchCover.url}?resize=1200,675` }]));
    if (url.pathname === new URL(STORIES.a3.url).pathname) return html(page(STORIES.a3.title, `${PICTURES.techcrunchCover.url}?w=1200`, '2026-10-27T15:00:00+00:00', `<p>${STORIES.a3.summary}</p>`));
    if (url.pathname === new URL(STORIES.a2.url).pathname) return html(page(STORIES.a2.title, `${PICTURES.techcrunchCover.url}?w=1200`, '2026-10-26T17:20:00+00:00',
      `<p>${STORIES.a2.summary}</p><p><img src="${PICTURES.techcrunchFigure.url}?w=680" alt="An administrator panel" width="680" height="850"></p>`));
    return imageHost(request, url);
  });
  const noiseFeeds: Record<string, string> = {
    'www.theverge.com': '/rss/index.xml', 'www.wired.com': '/feed/tag/ai/latest/rss', 'feeds.arstechnica.com': '/arstechnica/index', 'deepmind.google': '/blog/rss.xml', 'openai.com': '/news/rss.xml',
  };
  for (const [host, path] of Object.entries(noiseFeeds)) {
    const items = NOISE.filter((item) => noiseFeedHost(item.source) === host);
    internet.route(host, (_request, url) => url.pathname === path
      ? xml(rss(host, items.map((item) => ({ title: item.title, link: item.url, pubDate: item.published, description: `${item.title}. A fixture report outside DNESKAi's scope.` }))))
      : new Response('not found', { status: 404 }));
  }
  // Tuesday's Hugging Face post has neither a feed image nor a picture on its page.
  internet.route('huggingface.co', (_request, url) => {
    if (url.pathname === '/blog/feed.xml') return xml(rss('Hugging Face', internet.clock().getTime() >= Date.parse(STORIES.c.visibleFrom)
      ? [{ title: STORIES.c.title, link: STORIES.c.url, pubDate: STORIES.c.published, description: STORIES.c.summary }] : []));
    if (url.pathname === new URL(STORIES.c.url).pathname) return html(`<!doctype html><html><head><title>${STORIES.c.title}</title><meta property="article:published_time" content="2026-10-27T14:00:00+00:00"></head>
<body><main><article><h1>${STORIES.c.title}</h1><p>${STORIES.c.summary}</p></article></main></body></html>`);
    return new Response('not found', { status: 404 });
  });
  // Tuesday's other sources answer with nothing new.
  for (const [host, feed] of [['restofworld.org', '/feed/latest/'], ['simonwillison.net', '/atom/everything/']] as const) {
    internet.route(host, (_request, url) => url.pathname === feed ? xml(rss(host, [])) : new Response('not found', { status: 404 }));
  }
  internet.route('github.com', (_request, url) => /^\/[^/]+\/[^/]+\/releases\.atom$/.test(url.pathname)
    ? new Response('<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Release notes</title></feed>', { headers: { 'content-type': 'application/atom+xml; charset=utf-8' } })
    : new Response('not found', { status: 404 }));
  internet.route('hacker-news.firebaseio.com', (_request, url) => url.pathname === '/v0/topstories.json' ? json([HN_STORY.id])
    : url.pathname === `/v0/item/${HN_STORY.id}.json` ? json({ ...HN_STORY, type: 'story', text: 'Asking for a friend who stares at code all day.' }) : json(null, 404));
  return images;
}
function noiseFeedHost(source: string) {
  return ({ 'the-verge': 'www.theverge.com', 'wired-ai': 'www.wired.com', 'ars-technica': 'feeds.arstechnica.com', 'deepmind-blog': 'deepmind.google', 'openai-blog': 'openai.com' } as Record<string, string>)[source]!;
}

// ------------------------------------------------------------------ Apify
export class FakeApify {
  readonly runs = new Map<string, { profile: string; startedAt: string; dataset: string }>();
  private next = 1;
  constructor(readonly clock: () => Date, readonly actorId: string, readonly build: string) {}
  handler: Handler = async (request, url) => {
    if (request.headers.get('authorization') !== 'Bearer apify_api_TEST_ONLY') return json({ error: { type: 'invalid-token' } }, 401);
    if (request.method === 'POST' && url.pathname === '/v2/actors/apify~instagram-scraper/runs') {
      const body = JSON.parse(await request.text()) as { directUrls: string[] };
      const id = `fixtureRun${this.next}`; const dataset = `fixtureDataset${this.next++}`;
      this.runs.set(id, { profile: new URL(body.directUrls[0]!).pathname.split('/').filter(Boolean)[0]!, startedAt: this.clock().toISOString(), dataset });
      return json({ data: { id, actId: this.actorId, buildNumber: this.build, userId: 'fixtureUser', defaultDatasetId: dataset, status: 'READY' } }, 201);
    }
    const run = /^\/v2\/actor-runs\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (run && this.runs.has(run[1]!)) {
      const known = this.runs.get(run[1]!)!;
      // A real run takes a minute or two: the first read finds it still running.
      const running = this.clock().getTime() - Date.parse(known.startedAt) < 60_000;
      return json({ data: { id: run[1], actId: this.actorId, buildNumber: this.build, userId: 'fixtureUser', defaultDatasetId: known.dataset, status: running ? 'RUNNING' : 'SUCCEEDED',
        finishedAt: running ? null : new Date(Date.parse(known.startedAt) + 40_000).toISOString(), usageTotalUsd: running ? null : 0.0081 } });
    }
    const items = /^\/v2\/datasets\/([A-Za-z0-9]+)\/items$/.exec(url.pathname);
    if (items) {
      const known = [...this.runs.values()].find((entry) => entry.dataset === items[1]);
      if (!known) return json({ error: { type: 'page-not-found' } }, 404);
      if (known.profile !== 'meta.ai') return json([]);
      return json([{ id: '3520000000000000001', shortCode: 'DfixtureTr4n', caption: STORIES.b.caption, timestamp: STORIES.b.published, url: STORIES.b.url, ownerUsername: 'meta.ai',
        inputUrl: 'https://www.instagram.com/meta.ai/', type: 'Sidecar', productType: 'carousel_container', displayUrl: PICTURES.metaDisplay.url,
        images: [PICTURES.metaDisplay.url, PICTURES.metaChild2.url, PICTURES.metaChild3.url],
        childPosts: [{ displayUrl: PICTURES.metaDisplay.url, type: 'Image' }, { displayUrl: PICTURES.metaChild2.url, type: 'Image' }, { displayUrl: PICTURES.metaChild3.url, type: 'Image' }] }]);
    }
    return json({ error: { type: 'page-not-found' } }, 404);
  };
}

// ------------------------------------------------------------------ TypeSafe Jev
type JevState = { items: Array<{ id: string; title: string; text: string }>; history: Array<{ id: string; title: string; text: string }> };
type JevQuestion = { type: string; criteria: Record<string, string> };
/** A report of the shared-memory event: Jev links it to the first earlier report of the same event. */
const isEventA = (title: string) => /shared memory/i.test(title);
const inScope = (title: string) => isEventA(title) || /live translation|team memory|open speech model/i.test(title);
function distribution(keys: string[], choice: string, mass: number) {
  const rest = keys.filter((key) => key !== choice);
  const share = rest.length ? Math.floor(((1 - mass) / rest.length) * 1e6) / 1e6 : 0;
  const probabilities = Object.fromEntries(keys.map((key) => [key, key === choice ? 1 - share * rest.length : share]));
  return { type: 'choice', choice, confidence: mass, probabilities };
}
export class FakeJev {
  readonly requests: JevState[] = [];
  handler: Handler = async (request) => {
    if (request.headers.get('authorization') !== 'Bearer typesafe-TEST-ONLY') return json({ error: 'unauthorized' }, 401);
    const body = JSON.parse(await request.text()) as { model: string; state: JevState; questions: Record<string, JevQuestion> };
    this.requests.push(body.state);
    const answers: Record<string, unknown> = {};
    body.state.items.forEach((item, index) => {
      const relevant = inScope(item.title);
      answers[`category_${index}`] = distribution(Object.keys(body.questions[`category_${index}`]!.criteria), relevant ? 'ai-news' : 'other', relevant ? 0.96 : 0.95);
      answers[`relevance_${index}`] = { type: 'noul', noul: relevant ? (/live translation/i.test(item.title) ? 0.97 : 0.95) : 0.05 };
      const keys = Object.keys(body.questions[`duplicate_${index}`]!.criteria);
      const earlier = isEventA(item.title) ? body.state.items.slice(0, index).findIndex((other) => isEventA(other.title)) : -1;
      const known = isEventA(item.title) && earlier < 0 ? body.state.history.findIndex((other) => isEventA(other.title)) : -1;
      answers[`duplicate_${index}`] = distribution(keys, earlier >= 0 ? `c${earlier}` : known >= 0 ? `h${known}` : 'none', 0.95);
    });
    return json({ model: body.model, answers, usage: { input_tokens: 2900 + body.state.items.length * 40, output_tokens: 0 } });
  };
}

// ------------------------------------------------------------------ Anthropic
type OfferMedia = { assetSha256: string; evidenceIndex: number; position: number; credit: string; width: number; height: number; fullBleedCapable: boolean; insetCapable: boolean; singlePhotoCapable: boolean };
type Offer = { brief: { title: string }; rules: { firstSlide: string }; evidence: Array<{ index: number; title: string }>; media: OfferMedia[] };
/** marketing-copy/7 answers a careful model could give for the two briefs; pictures are chosen by capability, never by content. */
export function fixtureCopy(offer: Offer) {
  const cover = offer.media.find((item) => item.fullBleedCapable)!;
  const inset = offer.media.filter((item) => item.insetCapable && item.assetSha256 !== cover.assetSha256);
  const image = (item: OfferMedia | undefined) => item ? [{ slot: 'image-1' as const, assetSha256: item.assetSha256 }] : [];
  if (!offer.media.length) {
    // The picture-less brief: a carousel of statement slides, as rules.firstSlide 'statement' and no media allow.
    return {
      title: 'Otevřený model pro přepis porad na notebooku',
      caption: 'Hugging Face s několika univerzitními laboratořemi zveřejnil otevřený model pro rozpoznávání řeči, který podle autorů běží na běžném notebooku bez grafické karty. Přepisuje porady v angličtině, němčině a španělštině a označuje, kdo mluví.\n\nVáhy i kód pro trénování jsou veřejné. Autoři přiznávají, že u hlučných telefonátů dělá model víc chyb než uzavřené služby.\n\nV prohlížeči zatím neběží. Autoři připomínají, že licence nemění pravidla pro nahrávání lidí.',
      hashtags: ['huggingface', 'rozpoznavanireci', 'otevrenemodely'],
      format: 'carousel',
      slides: [
        { type: 'statement', headline: 'Otevřený model přepisuje porady přímo na notebooku.', body: 'Podle Hugging Face nepotřebuje grafickou kartu ani připojení ke cloudové službě.', images: [], alt: 'Úvodní textový slide o otevřeném modelu pro přepis porad.' },
        { type: 'statement', headline: 'Umí angličtinu, němčinu a španělštinu a pozná, kdo mluví.', images: [], alt: 'Textový slide o jazycích, které model zvládá.' },
        { type: 'statement', variant: 'ink', headline: 'U hlučných telefonátů dělá víc chyb než uzavřené služby.', body: 'Autoři to uvádějí sami po srovnání na veřejných testovacích sadách.', images: [], alt: 'Textový slide o slabinách modelu.' },
        { type: 'statement', headline: 'Licence nemění pravidla pro nahrávání lidí.', images: [], alt: 'Textový slide o upozornění autorů k nahrávání.' },
      ],
    };
  }
  if (/live translation/i.test(offer.brief.title + offer.evidence.map((item) => item.title).join(' '))) {
    return {
      title: 'Meta AI: živý překlad hlasových rozhovorů',
      caption: 'Meta podle svého příspěvku na Instagramu spouští v aplikaci Meta AI živý překlad hlasových rozhovorů. Uživatel mluví jedním jazykem a odpověď slyší v jiném.\n\nNa začátku má funkce umět angličtinu, španělštinu, francouzštinu, němčinu a italštinu. Zapíná se ikonou glóbu přímo v hlasovém rozhovoru.\n\nPříspěvek neuvádí, ve kterých zemích je funkce dostupná, ani jak spolehlivě překládá odborné výrazy. To ukáže až běžné používání.',
      hashtags: ['meta', 'preklad', 'hlasovyasistent'],
      format: 'carousel',
      slides: [
        { type: 'cover-photo', headline: 'Aplikace Meta AI začíná živě překládat hlasové rozhovory', images: image(cover), alt: 'Úvodní slide o živém překladu v aplikaci Meta AI s obrázkem z příspěvku účtu meta.ai.' },
        { type: 'figure', headline: 'Mluvíte jedním jazykem, odpověď slyšíte v jiném', body: 'Podle Mety funkce překládá hlasový rozhovor průběžně. Zatím umí angličtinu, španělštinu, francouzštinu, němčinu a italštinu.', images: image(inset[0]), alt: 'Slide s vysvětlením, jak živý překlad funguje, s druhým obrázkem z příspěvku meta.ai.' },
        { type: 'statement', headline: 'Meta zatím neuvádí, ve kterých zemích bude překlad dostupný.', images: [], alt: 'Textový slide o tom, co Meta ve svém oznámení neuvedla.' },
        { type: 'split', kicker: 'Co sledovat', headline: 'Kvalitu překladu ukáže až běžné používání', body: 'Oznámení nezmiňuje nezávislé testy přesnosti. Sledujte, jak si funkce poradí s nářečím a odbornými pojmy.', images: image(inset[1]), alt: 'Slide s tím, co u nové funkce sledovat, s třetím obrázkem z příspěvku meta.ai.' },
      ],
    };
  }
  return {
    title: 'Claude: sdílená paměť pro týmové pracovní prostory',
    caption: 'Anthropic přidává do týmových a firemních pracovních prostorů Claude sdílenou paměť projektu. Členové týmu v ní vidí, co si Claude o projektu pamatuje, a mohou to opravit nebo smazat.\n\nO zapnutí rozhodují správci pro jednotlivé projekty. U stávajících pracovních prostorů zůstává paměť ve výchozím stavu vypnutá a podle TechCrunch se nemění cena.\n\nOtevřené zůstává, jak dlouho se uložené údaje drží a jak je firma chrání.',
    hashtags: ['claude', 'anthropic', 'tymovaprace'],
    format: 'carousel',
    slides: [
      { type: 'cover-photo', headline: 'Claude dostává sdílenou paměť pro týmové pracovní prostory', images: image(cover), alt: 'Úvodní slide o sdílené paměti v Claude s ilustrací z oznámení společnosti Anthropic.' },
      { type: 'split', kicker: 'Jak to funguje', headline: 'Paměť projektu vidí a upravují všichni členové', body: 'Každý uložený údaj si mohou členové týmu prohlédnout, opravit nebo smazat.', images: image(inset[0]), alt: 'Slide o tom, jak týmová paměť funguje, s obrázkem nastavení od společnosti Anthropic.' },
      { type: 'figure', headline: 'Správci rozhodují, kde paměť poběží', body: 'U stávajících pracovních prostorů je funkce ve výchozím stavu vypnutá. Cena se podle TechCrunch nemění.', images: image(inset[1]), alt: 'Slide o roli správců s obrázkem z článku TechCrunch.' },
      { type: 'statement', headline: 'Anthropic zatím neříká, jak dlouho paměť údaje uchovává.', images: [], alt: 'Textový slide o otázce, kterou oznámení nechává otevřenou.' },
    ],
  };
}
export class FakeAnthropic {
  readonly requests: Array<{ model: string; system: string; prompt: string; outputConfig: unknown }> = [];
  /** Briefs (matched on their title) whose first answer draws a character the body face does not carry. */
  constructor(readonly unsupportedGlyphFirst: RegExp | null = null) {}
  handler: Handler = async (request, url) => {
    if (url.pathname !== '/v1/messages' || request.headers.get('x-api-key') !== 'sk-ant-TEST-ONLY') return json({ type: 'error', error: { type: 'authentication_error', message: 'fixture' } }, 401);
    const body = JSON.parse(await request.text()) as { model: string; system: string | Array<{ text: string }>; messages: Array<{ content: string | Array<{ type: string; text?: string }> }>; output_config?: unknown };
    const last = body.messages.at(-1)!.content;
    const prompt = typeof last === 'string' ? last : last.map((part) => part.text ?? '').join('');
    this.requests.push({ model: body.model, system: typeof body.system === 'string' ? body.system : body.system.map((part) => part.text).join(''), prompt, outputConfig: body.output_config });
    // The human turn starts with the offer JSON; a retry appends instructions after it.
    const end = prompt.indexOf('\nYour previous answer');
    const offer = JSON.parse(end < 0 ? prompt : prompt.slice(0, end)) as Offer;
    const copy = fixtureCopy(offer);
    if (end < 0 && this.unsupportedGlyphFirst?.test(offer.brief.title)) {
      // The copy gate lets a bullet through; only the renderer's glyph gate knows Source Serif 4 cannot draw it.
      copy.slides[1] = { ...copy.slides[1]!, body: 'Každý uložený údaj • prohlédnout • opravit • smazat.' };
    }
    return json({ id: `msg_fixture_${this.requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(copy) }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: Math.ceil(Buffer.byteLength(prompt) / 3) + 2400, output_tokens: Math.ceil(JSON.stringify(copy).length / 3) } });
  };
}

// ------------------------------------------------------------------ Instagram Graph API
type Container = { id: string; children?: string[]; imageUrl?: string; caption?: string; status: 'FINISHED' | 'PUBLISHED'; mediaId?: string; alt?: string };
export class FakeGraph {
  readonly containers = new Map<string, Container>();
  readonly media: Array<{ id: string; caption: string; timestamp: string; permalink: string; media_type: string }> = [];
  readonly fetchedImages: Array<{ url: string; width: number; height: number; format: string; sha256: string }> = [];
  /** Container ids whose media_publish is answered only after the caller gave up (the request times out). */
  readonly hangOnPublish = new Set<string>();
  hangNextPublish = false;
  refreshes = 0;
  private next = 17900000000001;
  constructor(readonly clock: () => Date, readonly internet: FakeInternet, public token: string, readonly userId: string, readonly appScopedId: string, readonly handle: string) {}
  private id() { return String(this.next++); }
  handler: Handler = async (request, url) => {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'refresh_access_token') {
      if (url.searchParams.get('grant_type') !== 'ig_refresh_token' || url.searchParams.get('access_token') !== this.token) return json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400);
      this.token = `${this.token}-refreshed`; this.refreshes++;
      return json({ access_token: this.token, token_type: 'bearer', expires_in: 5184000 });
    }
    if (!/^v\d+\.\d+$/.test(segments[0] ?? '')) return json({ error: { message: 'version' } }, 400);
    if (request.headers.get('authorization') !== `Bearer ${this.token}`) return json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 401);
    const node = segments[1]!, edge = segments[2];
    const form = request.method === 'POST' ? new URLSearchParams(await request.text()) : url.searchParams;
    if (node === 'me' && !edge) return json({ user_id: this.userId, username: this.handle, account_type: 'MEDIA_CREATOR', id: this.appScopedId });
    if (node === this.userId && !edge) return json({ id: this.appScopedId, user_id: this.userId, username: this.handle });
    if (node === this.userId && edge === 'content_publishing_limit') return json({ data: [{ quota_usage: this.media.length, config: { quota_total: 100, quota_duration: 86400 } }] });
    if (node === this.userId && edge === 'media' && request.method === 'POST') {
      const children = form.get('children');
      if (form.get('media_type') === 'CAROUSEL') {
        const ids = children!.split(',');
        if (ids.length < 2 || ids.some((id) => !this.containers.has(id))) return json({ error: { message: 'children invalid' } }, 400);
        const id = this.id();
        this.containers.set(id, { id, children: ids, caption: form.get('caption') ?? '', status: 'FINISHED' });
        return json({ id });
      }
      // Meta fetches every image itself; the fake does the same through the fake network and checks it.
      const image = form.get('image_url')!;
      const response = await this.internet.fetch(image);
      if (!response.ok) return json({ error: { message: 'image unreachable' } }, 400);
      const bytes = Buffer.from(await response.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      this.fetchedImages.push({ url: image, width: meta.width ?? 0, height: meta.height ?? 0, format: meta.format ?? '', sha256: sha256(bytes) });
      if (meta.format !== 'jpeg' || meta.width !== 1080 || meta.height !== 1350) return json({ error: { message: 'image invalid' } }, 400);
      const id = this.id();
      this.containers.set(id, { id, imageUrl: image, status: 'FINISHED', alt: form.get('alt_text') ?? undefined });
      return json({ id });
    }
    if (node === this.userId && edge === 'media_publish' && request.method === 'POST') {
      const container = this.containers.get(form.get('creation_id') ?? '');
      if (!container || !container.children) return json({ error: { message: 'creation_id invalid' } }, 400);
      if (container.status === 'PUBLISHED') return json({ error: { message: 'already published' } }, 400);
      const mediaId = this.id();
      container.status = 'PUBLISHED'; container.mediaId = mediaId;
      this.media.unshift({ id: mediaId, caption: container.caption ?? '', timestamp: this.clock().toISOString().replace(/\.\d{3}Z$/, '+0000'), permalink: `https://www.instagram.com/p/FX${mediaId.slice(-6)}/`, media_type: 'CAROUSEL_ALBUM' });
      if (this.hangNextPublish) {
        this.hangNextPublish = false; this.hangOnPublish.add(container.id);
        // Published remotely, but the answer never arrives: the caller's own deadline ends the request.
        request.signal.throwIfAborted();
        await new Promise<never>((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason ?? new DOMException('aborted', 'AbortError')), { once: true }));
      }
      return json({ id: mediaId });
    }
    if (node === this.userId && edge === 'media' && request.method === 'GET') {
      const since = Number(url.searchParams.get('since')) * 1000, until = Number(url.searchParams.get('until')) * 1000;
      const metaInstant = (value: string) => Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      return json({ data: this.media.filter((item) => metaInstant(item.timestamp) >= since && metaInstant(item.timestamp) <= until).slice(0, Number(url.searchParams.get('limit') ?? 25)) });
    }
    const container = this.containers.get(node);
    if (container && !edge) return json({ id: container.id, status_code: container.status });
    const published = this.media.find((item) => item.id === node);
    if (published && !edge) return json({ id: published.id, permalink: published.permalink });
    return json({ error: { message: `fixture graph: no ${request.method} ${url.pathname}` } }, 400);
  };
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
