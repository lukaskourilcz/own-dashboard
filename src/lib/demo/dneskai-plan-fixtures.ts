import assets from './dneskai-preview-assets.json';
import { pragueScheduledAt } from '@/lib/marketing/clock';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';
import { pragueDayAfter } from '@/lib/marketing/dneskai-workspace';
import {
  DNESKAI_PLAN_DAYS, DNESKAI_PLAN_INSTAGRAM_TIMES, DNESKAI_PLAN_READ_MAX_DAYS, DNESKAI_PLAN_THREADS_ONLY_TIMES, DNESKAI_PLAN_VIEW_VERSION,
  type DneskaiPlanChannel, type DneskaiPlanRead, type DneskaiPlanSlide, type DneskaiPlanSlot,
} from '@/lib/marketing/dneskai-plan-view';
import type { DneskaiPlanApi, DneskaiPlanQuery } from '@/lib/marketing/dneskai-plan-client';

/**
 * The deterministic DNESKAi publishing plan for `/dev-preview` and the guest tour. Every title and text is invented.
 * The slides are the committed renders of the workspace fixture decks (dneskai-preview-assets.json), and the slots
 * of today and tomorrow point at the same demo posts the Design Lab opens. Dates are relative to the browser's clock
 * in Europe/Prague. Threads has no connected account here, so the tab shows its texts as waiting.
 */
type DeckName = keyof typeof assets.decks;

/** The workspace fixture's post ids (dneskai-workspace-fixtures.ts), so a slot opens the same post in the Lab. */
const postId = (n: number) => `d0e5ca10-0000-4000-8000-${String(n).padStart(12, '0')}`;
const slotId = (n: number) => `d0e5ca10-0000-4000-9000-${String(n).padStart(12, '0')}`;
const revisionId = (n: number) => `d0e5ca10-0000-4000-a000-${String(n).padStart(12, '0')}`;
const slidesOf = (name: DeckName): DneskaiPlanSlide[] => assets.decks[name].map((entry, index) => ({
  url: entry.render.file, width: entry.render.width, height: entry.render.height, alt: entry.slide.alt ?? `Slide ${index + 1}`,
}));

const caption = (lines: string[], tags = '#dneskai #ai #umelainteligence') => `${lines.join('\n\n')}\n\nText připravil jazykový model. Výběr a schválení: redakce DNESKAi.\n\n${tags}`;

type Plan = {
  time: string; kind: DneskaiPlanSlot['kind']; status: DneskaiPlanSlot['status']; title: string; deck?: DeckName; lab?: number; code?: string;
  instagram?: { caption: string; publication?: DneskaiPlanChannel['publicationStatus']; remoteUrl?: string; errorCode?: string };
  threads?: { caption: string; publication?: DneskaiPlanChannel['publicationStatus']; remoteUrl?: string };
};

/** Today and tomorrow in full; the posts that exist in the workspace fixture keep their titles and slides. */
function nearDays(): Plan[][] {
  return [[
    { time: '08:00', kind: 'news', status: 'approved', title: 'Kdy ověřit odpověď modelu', deck: 'f', lab: 7,
      instagram: { caption: caption(['Model odpoví sebejistě i tehdy, když si číslo vymyslí.', 'Čísla, jména a citace si vždy dohledejte v původním dokumentu. Zabere to minutu a ušetří ostudu.']), publication: 'reconciliation', errorCode: 'meta-request-uncertain' },
      threads: { caption: 'Model odpoví sebejistě i tehdy, když si číslo vymyslí. Čísla, jména a citace si vždy dohledejte v původním dokumentu.', publication: 'published', remoteUrl: 'https://www.example.com/threads/dneskai/ukazka-1' } },
    { time: '12:30', kind: 'education', status: 'ready', title: 'Malý model bez připojení', deck: 'e', lab: 11,
      instagram: { caption: caption(['Malý model běží i na notebooku bez internetu. Na shrnutí poznámek nebo opravu textu stačí.', 'Na složité úvahy a dlouhé dokumenty ale pořád sáhněte po větším modelu.']) },
      threads: { caption: 'Malý model běží i na notebooku bez internetu. Na shrnutí poznámek stačí, na složité úvahy ne.' } },
    { time: '19:00', kind: 'education', status: 'generating', title: 'Jak číst kartu modelu',
      instagram: { caption: '' }, threads: { caption: '' } },
    { time: '21:00', kind: 'education', status: 'planned', title: 'Kdy pomůže vyhledávání v dokumentech',
      threads: { caption: 'Když model neví, co je ve vašich dokumentech, nepomůže delší prompt. Pomůže mu je dát k ruce: vyhledávání najde správné odstavce a model odpoví podle nich.\n\nFunguje to dobře na interní návody, smlouvy a zápisy z porad. Na obecné otázky to nepotřebujete.' } },
  ], [
    { time: '08:00', kind: 'news', status: 'ready', title: 'Benchmark není žebříček', deck: 'a', lab: 1,
      instagram: { caption: caption(['Benchmark není žebříček. Jedno číslo shrnuje stovky úloh a často skrývá, jak byl test spuštěn.', 'Než podle výsledku vyberete model, zjistěte, co test měří, porovnávejte stejné podmínky a ověřte rozptyl mezi běhy.', 'Malý rozdíl v procentech často neznamená nic. Rozhoduje, jestli se úlohy podobají vaší práci.'], '#dneskai #ai #umelainteligence #benchmark #jazykovemodely') },
      threads: { caption: 'Benchmark není žebříček. Jedno číslo shrnuje stovky úloh a často skrývá, jak byl test spuštěn.\n\nNež podle výsledku vyberete model, zjistěte, co test měří, porovnávejte stejné podmínky a ověřte rozptyl mezi běhy. Malý rozdíl v procentech často neznamená nic.\n\nRozhoduje, jestli se úlohy v testu podobají vaší práci.' } },
    { time: '12:30', kind: 'education', status: 'ready', title: 'Tip dne: kontext místo proseb', deck: 'b', lab: 2,
      instagram: { caption: caption(['Model neodpoví lépe, když ho poprosíte. Odpoví lépe, když mu řeknete cíl, publikum a formát.']) },
      threads: { caption: 'Model neodpoví lépe, když ho poprosíte. Odpoví lépe, když mu řeknete cíl, publikum a formát.' } },
    { time: '19:00', kind: 'education', status: 'failed', title: 'Proč verzovat prompty', lab: 3, code: 'render-validation-failed',
      instagram: { caption: caption(['Prompt je kód. Když ho změníte, zapište kdo, kdy a proč.']) }, threads: { caption: 'Prompt je kód. Když ho změníte, zapište kdo, kdy a proč.' } },
    { time: '21:00', kind: 'education', status: 'generating', title: 'Jak odhadnout cenu jednoho dotazu', threads: { caption: '' } },
  ]];
}

const LATER_TITLES = [
  'Tři zkratky pro terminál', 'Kdy stačí menší model', 'Co stojí jeden dotaz', 'Lokální model na notebooku', 'Co je kontextové okno',
  'Jak napsat zadání pro souhrn', 'Proč model zapomíná začátek', 'Teplota: kdy ji snížit', 'Jak poznat vymyšlenou citaci', 'Agent, nebo skript?',
  'Tabulka místo odstavce', 'Kdy model zeptat na zdroj', 'Překlad s glosářem', 'Jak zkrátit dlouhý e-mail', 'Co zjistit před nákupem licence',
];

/** A later day: planned slots without slides yet; day 2 and 3 carry the remaining workspace posts. */
function laterDay(offset: number): Plan[] {
  const title = (index: number) => LATER_TITLES[(offset * 4 + index) % LATER_TITLES.length]!;
  const ig = (text: string) => ({ caption: caption([text]) });
  const plans: Plan[] = [
    ...DNESKAI_PLAN_INSTAGRAM_TIMES.map((time, index): Plan => ({ time, kind: index === 0 ? 'news' : 'education', status: 'planned', title: title(index),
      instagram: ig(`${title(index)}. Krátce a prakticky.`), threads: { caption: `${title(index)}. Krátce a prakticky.` } })),
    ...DNESKAI_PLAN_THREADS_ONLY_TIMES.map((time): Plan => ({ time, kind: 'education', status: 'planned', title: title(3), threads: { caption: `${title(3)}. Jedna rada na večer.` } })),
  ];
  if (offset === 2) {
    plans[0] = { ...plans[0]!, status: 'ready', title: 'Tři zkratky pro terminál', deck: 'c', lab: 4 };
    plans[1] = { ...plans[1]!, status: 'approved', title: 'Kdy stačí menší model', deck: 'd', lab: 5 };
  }
  if (offset === 3) {
    plans[0] = { ...plans[0]!, status: 'approved', title: 'Schválený příspěvek bez zařazení', deck: 'd', lab: 8 };
    plans[1] = { ...plans[1]!, status: 'failed', title: 'Co stojí jeden dotaz', lab: 9, code: 'render-validation-failed' };
    plans[2] = { ...plans[2]!, status: 'generating', title: 'Lokální model na notebooku', lab: 10 };
  }
  // A weekly evening without a post: the owner skipped it.
  if (offset % 7 === 5) plans[3] = { ...plans[3]!, status: 'skipped' };
  return plans;
}

function channel(n: number, input: NonNullable<Plan['instagram']>, format: DneskaiPlanChannel['format'], status: Plan['status']): DneskaiPlanChannel {
  const written = status !== 'planned' && status !== 'generating' && input.caption !== '';
  return {
    revisionId: written ? revisionId(n) : null,
    caption: input.caption === '' ? null : input.caption,
    format: written ? format : null,
    revisionStatus: written ? (status === 'ready' ? 'review' : status === 'failed' ? 'failed' : status) : null,
    publicationStatus: input.publication ?? (status === 'approved' ? 'queued' : status === 'published' ? 'published' : null),
    remoteUrl: input.remoteUrl ?? null,
    errorCode: input.errorCode ?? null,
  };
}

/** The whole 30-day plan from today; the read cuts the window the query asks for. */
export function createDneskaiPlanFixture(now: Date, query: DneskaiPlanQuery = {}): DneskaiPlanRead {
  const today = pragueMarketingDate(now);
  const from = query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : today;
  const days = Math.min(DNESKAI_PLAN_READ_MAX_DAYS, Math.max(1, Math.floor(query.days ?? 2)));
  const near = nearDays();
  const slots: DneskaiPlanSlot[] = [];
  for (let offset = 0; offset < DNESKAI_PLAN_DAYS; offset += 1) {
    const date = pragueDayAfter(today, offset);
    (near[offset] ?? laterDay(offset)).forEach((plan, index) => {
      const n = offset * 10 + index + 1;
      const slides = plan.deck && plan.status !== 'generating' && plan.status !== 'planned' && plan.status !== 'failed' ? slidesOf(plan.deck) : [];
      const format = slides.length > 1 ? 'carousel' : 'post';
      slots.push({
        id: slotId(n), date, time: plan.time, scheduledAt: pragueScheduledAt(date, plan.time), kind: plan.kind, status: plan.status,
        code: plan.code ?? null, title: plan.title, kit: plan.deck ? 'spotlight' : null, slides,
        labPostId: plan.lab ? postId(plan.lab) : null,
        instagram: plan.instagram ? channel(n, plan.instagram, format, plan.status) : null,
        threads: plan.threads ? channel(n + 500, plan.threads, 'thread', plan.status) : null,
      });
    });
  }
  const until = pragueDayAfter(from, days - 1);
  return {
    schemaVersion: DNESKAI_PLAN_VIEW_VERSION, generatedAt: now.toISOString(), today, from, days, enabled: true,
    accounts: { instagram: { handle: 'dneskai', enabled: false }, threads: null },
    slots: slots.filter((slot) => slot.date >= from && slot.date <= until),
  };
}

/** The preview's stand-in for the plan read: no network, the same shapes. */
export const demoDneskaiPlanApi: DneskaiPlanApi = {
  preview: true,
  async load(query) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return createDneskaiPlanFixture(new Date(), query);
  },
};
