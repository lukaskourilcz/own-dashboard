import assets from './dneskai-preview-assets.json';
import { dneskaiCaptionWithKeyword } from '@/lib/marketing/dneskai-caption';
import { MARKETING_DECK_CONTENT_VERSION } from '@/lib/marketing/contracts';
import { DNESKAI_SLIDES_VERSION, type DneskaiDeck, type DneskaiSlide } from '@/lib/marketing/dneskai-slides';
import type { DneskaiBriefMedia } from '@/lib/marketing/dneskai-brief';
import type { MarketingAccountStatus } from '@/lib/marketing/accounts-client';
import { pragueScheduledAt } from '@/lib/marketing/clock';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';
import { DNESKAI_COSTS_VERSION, DNESKAI_WORKSPACE_VERSION, pragueDayAfter, type DneskaiCostsRead, type DneskaiFieldLimit, type DneskaiWorkspacePost, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';

/**
 * Deterministic DNESKAi workspace fixtures for `/dev-preview` and the guest tour (#119). Every post, source, credit
 * and number is invented. The slide images are real renders of these decks by the vendored studio, drawn from
 * abstract stand-in photographs (scripts/dneskai-preview-fixtures.mjs regenerates them and dneskai-preview-assets.json).
 * Dates are relative to the browser's clock in Europe/Prague, so the calendar always shows the coming week.
 */
export const DEMO_PROJECT_ID = 'proj-dneskai';
export const DNESKAI_DECK_CONTENT_VERSION_FOR_DEMO = MARKETING_DECK_CONTENT_VERSION;
type DeckName = keyof typeof assets.decks;
export const demoPhotos = assets.photos;

/** The written fields each template draws and their limits (`DNESKAI_PLACED_FIELDS` × `DNESKAI_TEXT_LIMITS`); a test ties them together. */
export function demoFieldLimits(slide: Pick<DneskaiSlide, 'type' | 'variant' | 'images'>): DneskaiFieldLimit[] {
  const table: Record<string, Array<[DneskaiFieldLimit['field'], number]>> = {
    'cover-photo': [['headline', 110]],
    figure: [['headline', 110], ['body', 260]],
    split: [['headline', 110], ['body', slide.images.length > 1 ? 320 : 330], ['kicker', 28]],
    statement: [['headline', 170], ['body', 240]],
    single: [['headline', slide.variant === 'type' ? 120 : 110]],
    sources: [],
  };
  return (table[slide.type] ?? []).map(([field, max]) => ({ field, max }));
}

const id = (n: number) => `d0e5ca10-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** A deterministic, varied 64-hex stand-in for a content hash (the demo never hashes real content). */
const hash = (n: number) => Array.from({ length: 8 }, (_, part) => (((Math.imul(n * 2654435761 + part * 40503, 2246822519) >>> 0) ^ (n * 97 + part)) >>> 0).toString(16).padStart(8, '0').slice(-8)).join('');
const slidesOf = (name: DeckName): DneskaiSlide[] => assets.decks[name].map((entry) => structuredClone(entry.slide) as DneskaiSlide);
const rendersOf = (name: DeckName) => assets.decks[name].map((entry, index) => ({ url: entry.render.file, sha256: entry.render.sha256, width: entry.render.width, height: entry.render.height, alt: (entry.slide as DneskaiSlide).alt ?? `Slide ${index + 1}` }));
const deckOf = (name: DeckName, slides = slidesOf(name)): DneskaiDeck => ({ schemaVersion: DNESKAI_SLIDES_VERSION, format: slides.length === 1 && slides[0]!.type === 'single' ? 'single-image' : 'carousel', slides });

const photo = (name: keyof typeof assets.photos, candidateId: string, position: number, credit: string): DneskaiBriefMedia => {
  const item = assets.photos[name];
  return { assetSha256: item.sha256, candidateId, position, credit, width: item.width, height: item.height, originKind: position === 0 ? 'og-image' : 'article-figure',
    fullBleedCapable: Math.min(item.width, item.height) >= 900, insetCapable: item.width >= 600 };
};
/** The renders a preview post without stored slides shows once it is saved again (refused, or never attached), by post id. */
export const demoSlides: Record<string, ReturnType<typeof rendersOf>> = { [id(3)]: rendersOf('g'), [id(9)]: rendersOf('c'), [id(10)]: rendersOf('b') };

export function demoAccounts(now: Date): MarketingAccountStatus[] {
  return [{ id: 'd0e5ca10-0000-4000-8000-0000000000aa', brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verifiedAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(), enabled: false,
    token: { expiresAt: new Date(now.getTime() + 8 * 86_400_000).toISOString(), refreshedAt: new Date(now.getTime() - 52 * 86_400_000).toISOString(), scopes: ['instagram_business_basic', 'instagram_business_content_publish'], loginMode: 'instagram' } }];
}

export function createDneskaiWorkspaceFixture(now: Date): DneskaiWorkspaceRead {
  const today = pragueMarketingDate(now);
  const at = (day: number, time: string) => pragueScheduledAt(pragueDayAfter(today, day), time);
  const created = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const evidence = [
    { candidateId: 'ukazka-blog-1', sourceId: 'ukazkovy-blog', url: 'https://www.example.com/blog/benchmarky', title: 'Ukázkový článek: jak se počítají benchmarky' },
    { candidateId: 'ukazka-zpravy-2', sourceId: 'ukazkove-zpravy', url: 'https://www.example.com/zpravy/metodika', title: 'Ukázková zpráva o metodice testů' },
  ];
  const media = [
    photo('p1', 'ukazka-blog-1', 0, 'Foto: ukázkový zdroj'), photo('p3', 'ukazka-blog-1', 1, 'Obrázek: ukázkový zdroj'), photo('p5', 'ukazka-blog-1', 2, 'Obrázek: ukázkový zdroj'),
    photo('p4', 'ukazka-zpravy-2', 0, 'Foto: ukázkový zdroj 2'), photo('p6', 'ukazka-zpravy-2', 1, 'Foto: ukázkový zdroj 2'), photo('p2', 'ukazka-zpravy-2', 2, 'Foto: ukázkový zdroj 2'),
  ];
  const brief = (title: string, day: number) => ({ eventId: hash(9000 + day), title, targetDate: pragueDayAfter(today, day), evidence, media });
  const caption = (lines: string[]) => `${lines.join('\n\n')}\n\nText připravil jazykový model. Výběr a schválení: redakce DNESKAi.\n\n#dneskai #ai #umelainteligence`;
  const rendered = (problems: NonNullable<DneskaiWorkspacePost['renderReport']>['problems'] = []) =>
    ({ schemaVersion: 'dneskai-render-report/1' as const, status: 'rendered' as const, problems, renderKeys: [], renderedAt: created(2) });
  const base = (n: number, deck: DeckName | DneskaiDeck, patch: Partial<DneskaiWorkspacePost>): DneskaiWorkspacePost => {
    const resolved = typeof deck === 'string' ? deckOf(deck) : deck;
    return {
      id: id(n), replacesId: null, status: 'review', ready: true, contentHash: hash(n), createdAt: created(10), approvedAt: null, feedback: null,
      title: 'Ukázkový příspěvek', caption: caption(['Ukázkový popisek.']), format: resolved.format === 'single-image' ? 'post' : 'carousel', scheduledAt: at(1, '08:00'),
      account: { id: '17841400000000001', handle: 'dneskai', platform: 'instagram' }, templateVersion: 'carousel-studio/1.0.0+852c2e9', traceId: `d0e5ca10-7ace-4000-8000-${String(n).padStart(12, '0')}`,
      deck: resolved, fields: resolved.slides.map(demoFieldLimits), assets: typeof deck === 'string' ? rendersOf(deck) : [], renderReport: rendered(), brief: brief('Ukázkové téma', 1), publication: null,
      ...patch,
    };
  };
  const refusedSlides = slidesOf('g');
  refusedSlides[0] = { ...refusedSlides[0]!, headline: 'Proč se vyplatí verzovat prompty a ukládat ke každé změně krátkou poznámku, kdo ji udělal, kdy a proč, aby se dala vrátit' };
  refusedSlides[1] = { ...refusedSlides[1]!, images: [{ slot: 'image-1', assetSha256: assets.photos.p5.sha256 }] };
  const posts: DneskaiWorkspacePost[] = [
    base(1, 'a', { title: 'Benchmark není žebříček', scheduledAt: at(1, '08:00'),
      caption: caption(['Benchmark není žebříček. Jedno číslo shrnuje stovky úloh a často skrývá, jak byl test spuštěn.', 'Než podle výsledku vyberete model, zjistěte, co test měří, porovnávejte stejné podmínky a ověřte rozptyl mezi běhy.']),
      renderReport: rendered([{ slide: 2, code: 'image-upscaled', blocking: false, message: 'The picture is enlarged slightly.', field: 'image-1' }]) }),
    base(2, 'b', { title: 'Tip dne: kontext místo proseb', scheduledAt: at(1, '12:30'), brief: brief('Ukázkový tip', 1),
      caption: dneskaiCaptionWithKeyword(caption(['Model neodpoví lépe, když ho poprosíte. Odpoví lépe, když mu řeknete cíl, publikum a formát.']), 'KONTEXT'),
      // An education post with a comment keyword (#157, #159); the news post above has none and offers to add one.
      engagement: { keyword: 'KONTEXT', publicReply: 'Poslali jsme vám to do zpráv.',
        replyMessage: 'Díky za komentář. Tady je postup ve třech krocích:\n\n1. Napište, k čemu výsledek potřebujete.\n2. Řekněte, kdo ho bude číst.\n3. Popište formát, třeba tabulku nebo pět bodů.\n\nStačí to v jedné zprávě, bez prosby a omluvy.' } }),
    base(3, deckOf('g', refusedSlides), { title: 'Proč verzovat prompty', scheduledAt: at(1, '17:00'), ready: false, assets: [],
      renderReport: { schemaVersion: 'dneskai-render-report/1', status: 'refused', renderKeys: [], renderedAt: created(3), problems: [
        { slide: 0, code: 'text-clipped', blocking: true, message: 'The headline does not fit.', field: 'headline' },
        { slide: 1, code: 'image-low-resolution', blocking: true, message: 'The picture is too small for this frame.', field: 'image-1' },
      ] } }),
    base(4, 'c', { title: 'Tři zkratky pro terminál', status: 'returned', scheduledAt: at(2, '08:00'), feedback: 'Titulek je moc dlouhý, zkraťte ho na jednu krátkou větu.' }),
    base(5, 'd', { title: 'Kdy stačí menší model', status: 'approved', approvedAt: created(5), scheduledAt: at(2, '12:30'),
      publication: { id: id(105), status: 'queued', scheduledAt: at(2, '12:30'), remoteUrl: null, errorCode: null, lastCheckedAt: null, publishedAt: null } }),
    base(6, 'e', { title: 'Pět otázek před nasazením asistenta', status: 'published', approvedAt: created(40), scheduledAt: at(-1, '17:00'),
      publication: { id: id(106), status: 'published', scheduledAt: at(-1, '17:00'), remoteUrl: 'https://www.example.com/instagram/dneskai/ukazka-1', errorCode: null, lastCheckedAt: at(-1, '17:05'), publishedAt: at(-1, '17:01') } }),
    base(7, 'f', { title: 'Kdy ověřit odpověď modelu', status: 'reconciliation', approvedAt: created(20), scheduledAt: at(0, '08:00'),
      publication: { id: id(107), status: 'reconciliation', scheduledAt: at(0, '08:00'), remoteUrl: null, errorCode: 'meta-request-uncertain', lastCheckedAt: at(0, '08:31'), publishedAt: null } }),
    base(8, 'd', { title: 'Schválený příspěvek bez zařazení', status: 'approved', approvedAt: created(1), scheduledAt: at(3, '08:00') }),
    // An edited version whose slides never attached (hours old, no render report): a problem, saved again from the editor.
    base(9, 'c', { title: 'Co stojí jeden dotaz', ready: false, assets: [], renderReport: null, scheduledAt: at(3, '12:30') }),
    // An edited version saved 20 seconds before the read: its render is still on its way.
    base(10, 'b', { title: 'Lokální model na notebooku', ready: false, assets: [], renderReport: null, createdAt: new Date(now.getTime() - 20_000).toISOString(), scheduledAt: at(3, '17:00') }),
    // Owner decision 6: a post of today whose time passed 20 minutes ago (or at midnight) without approval.
    base(11, 'e', { title: 'Malý model bez připojení', brief: brief('Ukázkové téma s prošlým časem', 0),
      scheduledAt: new Date(Math.max(now.getTime() - 20 * 60_000, Date.parse(at(0, '00:00')))).toISOString() }),
  ];
  return {
    schemaVersion: DNESKAI_WORKSPACE_VERSION, today, generatedAt: now.toISOString(), slots: ['08:00', '12:30', '17:00', '20:00'],
    accounts: [{ id: 'd0e5ca10-0000-4000-8000-0000000000aa', remoteId: '17841400000000001', handle: 'dneskai', verified: true, enabled: false }],
    posts,
    jobs: [
      { id: id(201), status: 'running', errorCode: null, createdAt: created(1), title: 'Jak odhadnout cenu jednoho dotazu', scheduledAt: at(1, '20:00') },
      { id: id(202), status: 'failed', errorCode: 'dneskai-daily-generation-budget-exhausted', createdAt: created(2), title: 'Co je kontextové okno', scheduledAt: at(2, '17:00') },
    ],
    // Owner decision 9: two built topics of today that wait for the scheduler, with no job yet.
    waiting: [
      { briefId: id(501), title: 'Jak číst kartu modelu', scheduledAt: at(0, '17:00'), status: 'ready', code: null },
      { briefId: id(502), title: 'Kdy pomůže vyhledávání v dokumentech', scheduledAt: at(0, '20:00'), status: 'ready', code: null },
    ],
    capabilities: { regenerate: true, generateNow: true, engagement: true },
    unreadable: 0,
  };
}

export function createDneskaiCostsFixture(now: Date): DneskaiCostsRead {
  const today = pragueMarketingDate(now);
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  return {
    schemaVersion: DNESKAI_COSTS_VERSION, generatedAt: now.toISOString(),
    generation: { spentUsd: 0.5, ceilingUsd: 1, code: null },
    days: Array.from({ length: 7 }, (_, index) => ({ date: pragueDayAfter(today, -index), collectionUsd: index === 0 ? 0.04 : index % 3 === 0 ? 0 : 0.04, generationUsd: index === 0 ? 0.5 : index === 1 ? 0.37 : 0, generationBookedUsd: index === 1 ? 0.25 : 0, unknown: index === 1 ? 1 : 0 })),
    runs: [
      { id: id(301), date: today, targetDate: pragueDayAfter(today, 1), status: 'complete', costUsd: 0.04, errorCode: null, createdAt: ago(120) },
      { id: id(302), date: pragueDayAfter(today, -1), targetDate: today, status: 'partial', costUsd: 0.04, errorCode: 'collection-source-partial', createdAt: ago(1560) },
      { id: id(303), date: pragueDayAfter(today, -2), targetDate: pragueDayAfter(today, -1), status: 'held', costUsd: null, errorCode: 'collection-budget-exceeded', createdAt: ago(3000) },
    ],
    jobs: [
      { id: id(202), status: 'failed', errorCode: 'dneskai-daily-generation-budget-exhausted', createdAt: ago(120), costUsd: null, title: 'Co je kontextové okno', scheduledAt: pragueScheduledAt(pragueDayAfter(today, 2), '17:00') },
      { id: id(203), status: 'failed', errorCode: 'render-validation-failed', createdAt: ago(1500), costUsd: 0.12, title: 'Ukázkové téma bez návrhu', scheduledAt: pragueScheduledAt(today, '12:30') },
      { id: id(204), status: 'reconciliation', errorCode: 'worker-lease-expired', createdAt: ago(1600), costUsd: null, title: 'Ukázkové téma s nejistým výsledkem', scheduledAt: pragueScheduledAt(today, '20:00') },
    ],
    publications: [{ id: id(107), revisionId: id(7), status: 'reconciliation', errorCode: 'meta-request-uncertain', scheduledAt: pragueScheduledAt(today, '08:00'), lastCheckedAt: ago(30), title: 'Kdy ověřit odpověď modelu' }],
    unreadable: 0,
    ticks: {
      total: 1386, withErrors: 2, generationDeferred: 1, lastStartedAt: ago(1),
      recent: [
        { id: id(401), kind: 'minute', startedAt: ago(1), finishedAt: ago(1), did: [{ category: 'reconciliation', status: 'done', code: null }], errors: [] },
        { id: id(402), kind: 'minute', startedAt: ago(95), finishedAt: ago(95), did: [{ category: 'generation', status: 'error', code: 'dneskai-daily-generation-budget-exhausted' }], errors: [{ category: 'generation', code: 'dneskai-daily-generation-budget-exhausted' }] },
        { id: id(403), kind: 'daily', startedAt: ago(300), finishedAt: ago(299), did: [{ category: 'renewal', status: 'done', code: null }, { category: 'purge', status: 'done', code: null }], errors: [] },
        { id: id(404), kind: 'minute', startedAt: ago(520), finishedAt: ago(520), did: [{ category: 'publishing', status: 'error', code: 'meta-request-uncertain' }], errors: [{ category: 'publishing', code: 'meta-request-uncertain' }] },
      ],
    },
  };
}
