import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  dneskaiCaptionOnly, dneskaiMediaCapabilities, dneskaiMediaCredit, dneskaiPublisherName, extractArticleMedia, fullSizeImageUrl,
  instagramMediaPlan, isInstagramMediaHost, largestSrcsetCandidate, publisherImageHostPolicy, registrableDomain,
} from '@/lib/marketing/dneskai-media-plan';
import { DNESKAI_SOURCES } from '@/lib/marketing/dneskai-registry';

const source = (id: string) => DNESKAI_SOURCES.find((row) => row.id === id)!;
// Synthetic markup shaped like a publisher article page; no real page text or image is copied.
const ARTICLE = `<!doctype html><html><head>
<meta property="og:image" content="https://www.theverge.com/wp-content/uploads/2026/10/hero.jpg?quality=90&strip=all&crop=0,0,100,100">
<meta name="twitter:image" content="https://www.theverge.com/wp-content/uploads/2026/10/hero.jpg?quality=90&strip=all&crop=0,0,100,100">
<link rel="icon" href="/favicon.ico"></head><body>
<header class="site-header"><img src="/brand/wordmark.png" width="800" height="200" alt="The site"></header>
<nav><img src="https://www.theverge.com/nav-promo.jpg" width="900" height="900"></nav>
<article class="story"><header><h1>OFFLINE TEST headline</h1>
<div class="byline"><img src="https://www.theverge.com/people/jane.jpg" width="900" height="900" alt="Jane"></div></header>
<p>OFFLINE TEST paragraph one with enough words to be the story body of this synthetic page.</p>
<figure><img src="https://duet-cdn.vox-cdn.com/thumbor/small.jpg" srcset="https://duet-cdn.vox-cdn.com/thumbor/400.jpg 400w, https://duet-cdn.vox-cdn.com/thumbor/1600.jpg 1600w, https://duet-cdn.vox-cdn.com/thumbor/800.jpg 800w" alt="A product photograph"><figcaption>OFFLINE caption</figcaption></figure>
<picture><source type="image/avif" srcset="https://www.theverge.com/figure-2.avif 2400w"><source type="image/webp" srcset="https://www.theverge.com/figure-2-1200.webp 1200w, https://www.theverge.com/figure-2-2400.webp 2400w"><img src="https://www.theverge.com/figure-2.jpg" alt="Chart"></picture>
<p><img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/relative/figure-3.png" alt="Diagram"></p>
<img src="https://www.theverge.com/logo-mark.png" alt="Mark">
<img src="https://www.theverge.com/figure-4.jpg" width="120" height="80" alt="Thumbnail">
<img src="https://www.theverge.com/animated.gif" alt="Loop">
<img src="https://www.theverge.com/drawing.svg" alt="Drawing">
<img src="https://images.thirdparty.example/stock.jpg" alt="Third-party picture">
<img src="https://www.theverge.com/icons/share.png" alt="Share">
<div class="related-posts"><img src="https://www.theverge.com/related.jpg" alt="Related"></div>
<p>OFFLINE TEST paragraph two.</p></article>
<aside><img src="https://www.theverge.com/sidebar.jpg"></aside><footer><img src="https://www.theverge.com/footer.jpg"></footer>
</body></html>`;

describe('DNESKAi media plan: what is fetched, in what order', () => {
  it('keeps every Instagram picture in collection order, display first, at most ten', () => {
    const urls = Array.from({ length: 12 }, (_, index) => `https://scontent-prg1-1.cdninstagram.com/v/${index}.jpg`);
    const plan = instagramMediaPlan({ mediaUrls: [urls[0]!, urls[0]!, ...urls.slice(1)] });
    expect(plan).toHaveLength(10);
    expect(plan.map((entry) => entry.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan[0]).toEqual({ position: 0, url: urls[0], kind: 'instagram-display' });
    expect(plan.slice(1).every((entry) => entry.kind === 'instagram-child')).toBe(true);
    expect(isInstagramMediaHost('scontent-prg1-1.cdninstagram.com')).toBe(true);
    expect(isInstagramMediaHost('instagram.fprg2-1.fna.fbcdn.net')).toBe(true);
    expect(isInstagramMediaHost('cdninstagram.com.attacker.example')).toBe(false);
  });

  it('extracts social-card, feed and body pictures in publisher order, largest rendition, without chrome', () => {
    const verge = source('the-verge');
    const plan = extractArticleMedia(ARTICLE, 'https://www.theverge.com/2026/10/20/offline-test', {
      allowHost: publisherImageHostPolicy(verge, 'https://www.theverge.com/2026/10/20/offline-test'),
      feedImages: ['https://www.theverge.com/wp-content/uploads/2026/10/hero.jpg', 'https://www.theverge.com/feed-only.jpg'],
    });
    expect(plan).toEqual([
      // WordPress: the original upload first, the publisher's resized URL as the fallback.
      { position: 0, url: 'https://www.theverge.com/wp-content/uploads/2026/10/hero.jpg', kind: 'og-image', fallbackUrl: 'https://www.theverge.com/wp-content/uploads/2026/10/hero.jpg?quality=90&strip=all&crop=0,0,100,100' },
      { position: 1, url: 'https://www.theverge.com/feed-only.jpg', kind: 'feed-image' },
      { position: 2, url: 'https://duet-cdn.vox-cdn.com/thumbor/1600.jpg', kind: 'article-figure' },
      { position: 3, url: 'https://www.theverge.com/figure-2-2400.webp', kind: 'article-figure' },
      { position: 4, url: 'https://www.theverge.com/relative/figure-3.png', kind: 'article-figure' },
    ]);
  });

  it('caps a feed candidate at eight pictures and never fetches off-publisher hosts', () => {
    const figures = Array.from({ length: 12 }, (_, index) => `<figure><img src="https://www.anthropic.com/images/figure-${index}.png" alt="Figure ${index}"></figure>`).join('');
    const html = `<html><body><main><p>OFFLINE TEST body</p>${figures}<img src="https://cdn.sanity.io/images/x/y/hero.png"><img src="https://evil.example/a.png"></main></body></html>`;
    const plan = extractArticleMedia(html, 'https://www.anthropic.com/news/offline-test', { allowHost: publisherImageHostPolicy(source('anthropic-news'), 'https://www.anthropic.com/news/offline-test') });
    expect(plan).toHaveLength(8);
    expect(plan.every((entry) => entry.url.startsWith('https://www.anthropic.com/images/'))).toBe(true);
    const empty = extractArticleMedia('', 'https://www.anthropic.com/news/offline-test', { allowHost: () => true, feedImages: ['http://insecure.example/a.jpg', 'https://10.0.0.1/a.jpg'] });
    expect(empty).toEqual([]);
  });

  it('knows the publisher domains and CDNs, nothing else', () => {
    const ars = publisherImageHostPolicy(source('ars-technica'), 'https://arstechnica.com/ai/2026/10/offline-test/');
    expect(['arstechnica.com', 'cdn.arstechnica.net', 'i0.wp.com'].map(ars)).toEqual([true, true, true]);
    expect(['arstechnica.net.evil.example', 'gravatar.com', 'images.ctfassets.net.example'].map(ars)).toEqual([false, false, false]);
    // An aggregator's candidate links to another publisher: that page's own domain counts.
    const hn = publisherImageHostPolicy(source('hn-frontpage'), 'https://blog.example.org/post');
    expect(['static.example.org', 'news.ycombinator.com', 'other.example'].map(hn)).toEqual([true, false, false]);
    expect(registrableDomain('regmedia.co.uk')).toBe('regmedia.co.uk');
    expect(registrableDomain('www.theregister.com')).toBe('theregister.com');
  });

  it('reads srcset like a browser, including commas inside URLs and density descriptors', () => {
    expect(largestSrcsetCandidate('https://res.example/w_400,h_300/a.jpg 400w, https://res.example/w_1600,h_1200/a.jpg 1600w')).toBe('https://res.example/w_1600,h_1200/a.jpg');
    expect(largestSrcsetCandidate('a.jpg, a@2x.jpg 2x, a@3x.jpg 3x')).toBe('a@3x.jpg');
    expect(largestSrcsetCandidate('')).toBeUndefined();
    expect(fullSizeImageUrl('https://example.org/wp-content/uploads/a.jpg?resize=1200,675&ssl=1')).toEqual({ url: 'https://example.org/wp-content/uploads/a.jpg', fallbackUrl: 'https://example.org/wp-content/uploads/a.jpg?resize=1200,675&ssl=1' });
    expect(fullSizeImageUrl('https://example.org/images/a.jpg?w=1200')).toEqual({ url: 'https://example.org/images/a.jpg?w=1200' });
  });
});

describe('DNESKAi media credit, caption-only and resolution flags', () => {
  it('credits the post owner on Instagram and the publisher on feeds, never empty', () => {
    const mosseri = source('instagram:mosseri');
    expect(dneskaiMediaCredit(mosseri, { url: 'https://www.instagram.com/p/x/', instagram: { ownerUsername: 'test_creator' } })).toBe('Foto: @test_creator');
    expect(dneskaiMediaCredit(mosseri, { url: 'https://www.instagram.com/p/x/' })).toBe('Foto: @mosseri');
    expect(dneskaiMediaCredit(source('techcrunch-ai'), { url: 'https://techcrunch.com/2026/10/20/x/' })).toBe('Obrázek: TechCrunch');
    expect(dneskaiMediaCredit(source('wired-ai'), { url: 'https://www.wired.com/story/x/' })).toBe('Obrázek: Wired');
    expect(dneskaiMediaCredit(source('hf-blog'), { url: 'https://huggingface.co/blog/x' })).toBe('Obrázek: Hugging Face');
    expect(dneskaiMediaCredit(source('hn-frontpage'), { url: 'https://www.example.org/post' })).toBe('Obrázek: example.org');
    expect(dneskaiPublisherName(source('import-ai'))).toBe('Import AI');
    for (const row of DNESKAI_SOURCES) {
      const credit = dneskaiMediaCredit(row, { url: row.kind === 'instagram' ? 'https://www.instagram.com/p/x/' : row.url });
      expect(credit.length, row.id).toBeGreaterThan(8);
      expect(credit.length, row.id).toBeLessThanOrEqual(120);
    }
  });

  it('treats a Reel caption as caption only, never as a transcript', () => {
    expect(dneskaiCaptionOnly({ sourceId: 'instagram:mosseri', url: 'https://www.instagram.com/p/x/', instagram: { mediaType: 'video' } })).toBe(true);
    expect(dneskaiCaptionOnly({ sourceId: 'instagram:mosseri', url: 'https://www.instagram.com/p/x/', instagram: { mediaType: 'carousel', containsVideo: true } })).toBe(true);
    expect(dneskaiCaptionOnly({ sourceId: 'instagram:mosseri', url: 'https://www.instagram.com/reel/x/', instagram: { mediaType: 'image' } })).toBe(true);
    // Collected before the type was recorded: nothing proves it is not a video.
    expect(dneskaiCaptionOnly({ sourceId: 'instagram:mosseri', url: 'https://www.instagram.com/p/x/' })).toBe(true);
    expect(dneskaiCaptionOnly({ sourceId: 'instagram:mosseri', url: 'https://www.instagram.com/p/x/', instagram: { mediaType: 'carousel' } })).toBe(false);
    expect(dneskaiCaptionOnly({ sourceId: 'openai-blog', url: 'https://openai.com/index/x/' })).toBe(false);
  });

  it('flags full-bleed from a 900 px shorter side and inset from 600 px width', () => {
    expect(dneskaiMediaCapabilities({ width: 1600, height: 900 })).toEqual({ fullBleedCapable: true, insetCapable: true });
    expect(dneskaiMediaCapabilities({ width: 1600, height: 899 })).toEqual({ fullBleedCapable: false, insetCapable: true });
    expect(dneskaiMediaCapabilities({ width: 624, height: 351 })).toEqual({ fullBleedCapable: false, insetCapable: true });
    expect(dneskaiMediaCapabilities({ width: 599, height: 1200 })).toEqual({ fullBleedCapable: false, insetCapable: false });
  });
});
