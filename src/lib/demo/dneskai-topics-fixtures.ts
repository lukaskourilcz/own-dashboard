import { DNESKAI_TOPICS_VERSION, DneskaiTopicsReadSchema, emptyDneskaiTopicGroups, type DneskaiTopic, type DneskaiTopicsRead } from '@/lib/marketing/dneskai-topics';
import { pragueDayAfter } from '@/lib/marketing/dneskai-workspace';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';

/** Synthetic topics (náměty, #154) for `/dev-preview` and tests: example.com sources and a made-up handle only. */
const id = (n: number) => `d0e5ca10-7001-4000-8000-${String(n).padStart(12, '0')}`;

export function createDneskaiTopicsFixture(now: Date): DneskaiTopicsRead {
  const today = pragueMarketingDate(now);
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const topic = (n: number, patch: Partial<DneskaiTopic> & Pick<DneskaiTopic, 'title' | 'kind'>): DneskaiTopic => ({
    id: id(n), sourceKind: 'feed', source: { label: 'example.com', url: `https://www.example.com/clanek/${n}` }, summary: null, keyword: null, verdict: null,
    status: 'proposed', proposedFor: today, approvedAt: null, createdAt: hoursAgo(6), updatedAt: hoursAgo(6), ...patch,
  });
  const topics = [
    topic(1, { kind: 'news', title: 'Ukázka: nový model zvládne delší kontext za stejnou cenu', keyword: null }),
    topic(2, { kind: 'news', title: 'Ukázka: evropský úřad zveřejnil pravidla pro AI v nemocnicích', source: { label: 'example.org', url: 'https://example.org/zpravy/ai-pravidla' } }),
    topic(3, { kind: 'news', status: 'approved', approvedAt: hoursAgo(1), title: 'Ukázka: open-source nástroj na přepis schůzek offline' }),
    topic(4, { kind: 'education', sourceKind: 'instagram', title: 'Jak si nastavit vlastní příkazy v editoru kódu', keyword: 'PRIKAZY', verdict: 'fact',
      source: { label: '@ukazkovy.tvurce', url: 'https://www.example.com/reel/ukazka-4' } }),
    topic(5, { kind: 'education', sourceKind: 'library', title: 'Tři způsoby, jak zkrátit prompt bez ztráty kvality', keyword: 'Prompt' }),
    topic(6, { kind: 'education', sourceKind: 'instagram', title: 'Aplikace, která z fotky tabule udělá poznámky', keyword: 'Tabule', verdict: 'unclear',
      source: { label: '@ukazkovy.tvurce', url: 'https://www.example.com/reel/ukazka-6' } }),
    topic(7, { kind: 'news', status: 'expired', proposedFor: pragueDayAfter(today, -2), title: 'Ukázka: starší zpráva, která propadla po 48 hodinách', updatedAt: hoursAgo(20) }),
    topic(8, { kind: 'education', status: 'rejected', title: 'Ukázka: zamítnutý návod na automatické odpovědi', updatedAt: hoursAgo(3) }),
  ];
  const groups = { news: emptyDneskaiTopicGroups(), education: emptyDneskaiTopicGroups() };
  for (const item of topics) groups[item.kind][item.status].push(item);
  return DneskaiTopicsReadSchema.parse({ schemaVersion: DNESKAI_TOPICS_VERSION, generatedAt: now.toISOString(), groups, lastProposedAt: hoursAgo(6), unreadable: 0 });
}

export const demoTopicId = id;
