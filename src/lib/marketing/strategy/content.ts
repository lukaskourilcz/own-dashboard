import research from './research.json';
import ideas from './ideas.json';
import type { PublishingBrand } from '@/lib/publishing-calendar';
import { DevsharkDeckSchema } from '@/lib/marketing/devshark-deck';

export type StrategyLang = 'en' | 'cs';
export type StrategyIdea = (typeof ideas)[number];
export const growthResearch = research;
export const strategyIdeas = (brand: PublishingBrand) => ideas.filter((idea) => idea.brand === brand);
export const strategyIdea = (brand: PublishingBrand, id: string) => strategyIdeas(brand).find((idea) => idea.id === id);

/** Deterministic, unapproved concepts. The Lab and its render/approval gates remain authoritative. */
export function strategyDevsharkDraft(idea: StrategyIdea) {
  if (idea.brand !== 'devshark' || !idea.code || !idea.answer || !idea.why) throw new Error('invalid-strategy-idea');
  return {
    title: idea.title,
    caption: `${idea.hook}\n\n${idea.why}\n\nPractise web development on devShark: devshark.app 🦈\n#typescript #javascript #webdevelopment #frontend #devshark`,
    deck: DevsharkDeckSchema.parse({ schemaVersion: 'devshark-deck/1', cover: 'light', slides: [
      { kind: 'cover', kicker: idea.topic, headline: idea.hook },
      { kind: 'code', headline: 'Try this example', code: idea.code },
      { kind: 'answer', headline: idea.answer, body: idea.why },
      { kind: 'closing', headline: 'Practise the next example', body: 'Short lessons and coding tasks on devShark.' },
    ] }),
  };
}

export function strategyBrief(idea: StrategyIdea, lang: StrategyLang): string {
  const t = lang === 'cs'
    ? { hook: 'Úvod', why: 'Přínos pro publikum', visual: 'Vizuální postup', evidence: 'Interní podklad', threads: 'Úhel pro Threads', review: 'Před publikováním ověřte fakta, otestujte příklad a schvalte přesnou verzi v Design Labu.' }
    : { hook: 'Hook', why: 'Audience appeal', visual: 'Visual direction', evidence: 'Internal evidence', threads: 'Threads angle', review: 'Check facts, run the example and approve the exact version in the Design Lab before publishing.' };
  return `${idea.title}\n\n${t.hook}: ${idea.hook}\n${t.why}: ${idea.appeal[lang]}\n${t.visual}: ${idea.visual[lang]}\n${t.threads}: ${idea.threads}\n${t.evidence}: ${idea.sourceUrl}\n\n${t.review}`;
}
