import type { PublishingBrand } from '@/lib/publishing-calendar';
import type { StrategyRead, StrategyResultInput } from '@/lib/marketing/strategy/contracts';
import { strategyDevsharkDraft, strategyIdea } from '@/lib/marketing/strategy/content';
import { demoDevsharkStudio } from './devshark-studio-demo';
import { demoDneskaiTopicsApi } from './dneskai-topics-demo';

const stores = new Map<string, StrategyRead>();
const read = (projectId: string, brand: PublishingBrand) => {
  const key = `${projectId}:${brand}`;
  if (!stores.has(key)) stores.set(key, { links: [], results: [], publications: [], partial: false });
  return stores.get(key)!;
};
/** Shares the real fixture draft/topic stores; there are no fabricated audience metrics. */
export const demoMarketingStrategy = {
  async load(projectId: string, brand: PublishingBrand) { return structuredClone(read(projectId, brand)); },
  async add(projectId: string, brand: PublishingBrand, ideaId: string) {
    const store = read(projectId, brand);
    const existing = store.links.find((link) => link.idea_id === ideaId);
    if (existing) return structuredClone(existing);
    const idea = strategyIdea(brand, ideaId);
    if (!idea) throw new Error('strategy-idea-unavailable');
    const result = brand === 'devshark'
      ? { idea_id: ideaId, draft_id: await demoDevsharkStudio.create(strategyDevsharkDraft(idea)), topic_id: null }
      : await (async () => {
        const r = await demoDneskaiTopicsApi.act({ action: 'create', projectId, kind: 'education', title: idea.title, url: idea.sourceUrl, ...(idea.keyword ? { keyword: idea.keyword } : {}) });
        return { idea_id: ideaId, draft_id: null, topic_id: r.results[0]!.id };
      })();
    store.links.push(result); return structuredClone(result);
  },
  async save(input: StrategyResultInput) {
    const store = read(input.projectId, input.brand);
    if (!store.publications.some((p) => p.id === input.publicationId)) throw new Error('publication-unavailable');
    store.results.push({ id: crypto.randomUUID(), publication_id: input.publicationId, published_at: input.publishedAt,
      observed_at: input.observedAt, experiment: input.experiment, variant: input.variant, evidence: input.evidence, metrics: input.metrics });
  },
};
export function resetDemoMarketingStrategy() { stores.clear(); }
