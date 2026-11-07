import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { DevsharkDeckSchema, type DevsharkDeck } from './devshark-deck';
import { layoutDevsharkSlide } from '@/lib/design-studio/devshark-layout';
import type { DneskaiTopicModel } from './dneskai-topic-model';

/**
 * devShark concept generation (owner decision, 7 November 2026). When fewer than `DEVSHARK_CONCEPT_QUEUE` concepts
 * wait for the owner in the studio, one Claude call writes the next one: a short English carousel on a web-development
 * topic from a fixed rotation, in the devShark slide format. It enters the studio as a draft; nothing is planned or
 * published until the owner approves it there. Each call is checked against two daily limits first: the number of
 * generated concepts in the last 24 hours and their recorded cost. Only the topic and the titles of recent concepts
 * are sent; nothing about the owner or other projects.
 */
type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;

export const DEFAULT_DEVSHARK_CONCEPT_MODEL = 'claude-sonnet-5-5';
/** Claude Sonnet 5.5 standard rates in USD per million tokens, as in docs/marketing-generation.md. */
export const DEFAULT_DEVSHARK_CONCEPT_PRICING = { inputPerMillionUsd: 2, outputPerMillionUsd: 10 } as const;
export const DEVSHARK_CONCEPT_QUEUE = 5;
const MAX_OUTPUT_TOKENS = 2_000;
const MAX_INPUT_TOKENS = 3_000;

export const DEVSHARK_CONCEPT_TOPICS = [
  'a JavaScript quiz with three answer options', 'a CSS layout technique', 'a React pattern or pitfall', 'a frequent web developer interview question',
  'a short coding task with one clear solution', 'a TypeScript type-safety tip', 'a Git command that saves time', 'an HTTP or browser fundamental',
  'a Node.js or async JavaScript pitfall', 'an accessibility rule for web developers', 'a performance tip for web pages', 'an SQL query basic for web developers',
] as const;

export function devsharkConceptLimits(env: Environment = process.env) {
  const number = (value: string | undefined, fallback: number, max: number) => {
    const parsed = value && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : fallback;
    return Math.min(parsed, max);
  };
  return { perDay: number(env.DEVSHARK_CONCEPTS_PER_DAY, 3, 10), dailyUsd: number(env.DEVSHARK_CONCEPT_DAILY_USD, 0.3, 2) };
}
export function devsharkConceptModelConfiguration(env: Environment = process.env) {
  if (env.MARKETING_AI_CONSENT !== 'true') throw new Error('concept-model-consent-required');
  if (!env.ANTHROPIC_API_KEY) throw new Error('concept-model-configuration-required');
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.MARKETING_DEVSHARK_CONCEPT_MODEL?.trim() || DEFAULT_DEVSHARK_CONCEPT_MODEL, pricing: DEFAULT_DEVSHARK_CONCEPT_PRICING };
}

const SlideOutput = z.object({
  kind: z.enum(['cover', 'text', 'code', 'answer', 'closing']),
  kicker: z.string().max(40).optional(),
  headline: z.string().min(1).max(80),
  body: z.string().max(220).optional(),
  code: z.string().max(400).optional(),
});
export const DevsharkConceptOutputSchema = z.object({
  title: z.string().min(1).max(80),
  caption: z.string().min(1).max(600),
  cover: z.enum(['light', 'dark']),
  slides: z.array(SlideOutput).min(4).max(6),
});
export type DevsharkConceptOutput = z.infer<typeof DevsharkConceptOutputSchema>;

export const DEVSHARK_CONCEPT_SYSTEM = `You write Instagram carousel concepts for devShark, a learning platform for web developers (lessons, interview prep, quizzes and graded coding tasks).
Write in clear, plain English for developers. Every technical statement must be correct and current; prefer well-established facts and never invent numbers, versions or quotes.
Structure: 4 to 6 slides. The first slide has kind "cover" with a short kicker (2-3 words naming the topic) and a headline of at most 30 characters plus a one-sentence body.
Middle slides use kind "text", "code" or "answer" (the answer or key takeaway, at most one). The last slide has kind "closing": one sentence about what devShark offers, no code.
Limits: headline at most 45 characters (cover at most 30); body at most 140 characters; code at most 7 lines of at most 34 characters each.
Mark 1 to 4 key words per slide as green with double brackets, like [[this]]. Never put brackets inside code.
Caption, in the owner's voice: one or two short paragraphs that talk to the reader directly with a playful, slightly teasing challenge (a question they may hesitate over, a nudge from junior to senior), never a dry summary and never a hint like "answer on slide 3". Then the devShark line naming what devShark offers for this topic, with devshark.app followed by the shark emoji 🦈. Then 3 to 5 hashtags ending with #devshark. The caption may mention devshark.app and no other URL. The shark is the only emoji.
Captions the owner wrote:
- "Guess before you swipe: what does typeof null return? If you know, then you are much better than what they say about you. 🦈\n\nMore JavaScript quizzes on devShark: devshark.app\n#javascript #webdevelopment #coding #frontend #devshark"
- "We heard that many devs still get this wrong. Including us.\nLearn CSS layout step by step on devShark: devshark.app 🦈\n#css #frontend #webdevelopment #coding #devshark"
- "Do you know how to reverse the order of words in a sentence? Of course you know, that is a junior thing. Do you want to be a senior though? Then check out our coding tasks for web developers on devShark: devshark.app 🦈\n#codingchallenge #javascript #webdevelopment #coding #devshark"`;

export function devsharkConceptPrompt(topic: string, recentTitles: readonly string[]): string {
  return [`Topic for this concept: ${topic}.`, recentTitles.length ? `Do not repeat these recent concepts:\n${recentTitles.map((title) => `- ${title}`).join('\n')}` : '', 'Return the concept.'].filter(Boolean).join('\n\n');
}

const BROWSERLESS_ASSETS = { finGreen: 'fin', finInk: 'fin', logoWhite: 'logo' };
/** The deck a model output becomes, or a code when it would not fit the slides. */
export function devsharkConceptDeck(output: DevsharkConceptOutput): { deck: DevsharkDeck } | { code: string } {
  const parsed = DevsharkDeckSchema.safeParse({ schemaVersion: 'devshark-deck/1', cover: output.cover, slides: output.slides.map((slide, index) => ({
    kind: slide.kind, headline: slide.headline.trim(), ...(index === 0 && slide.kicker?.trim() ? { kicker: slide.kicker.trim() } : {}),
    ...(slide.body?.trim() ? { body: slide.body.trim() } : {}), ...(slide.code?.trim() ? { code: slide.code.replace(/\[\[|\]\]/g, '') } : {}),
  })) });
  if (!parsed.success) return { code: 'concept-deck-invalid' };
  if (parsed.data.slides.at(-1)?.kind !== 'closing') return { code: 'concept-closing-missing' };
  for (const index of parsed.data.slides.keys()) if (layoutDevsharkSlide(parsed.data, index, BROWSERLESS_ASSETS).warnings.length) return { code: 'concept-does-not-fit' };
  return { deck: parsed.data };
}

export type DevsharkConceptResult = { status: 'generated' | 'skipped' | 'refused'; code?: string; costUsd?: number };

export async function generateDevsharkConcept(db: Database, owner: string, project: string, input: { now: Date; env?: Environment; signal: AbortSignal; model: () => Promise<DneskaiTopicModel> }): Promise<DevsharkConceptResult> {
  z.uuid().parse(owner); z.uuid().parse(project);
  const limits = devsharkConceptLimits(input.env);
  const waiting = await db.from('marketing_devshark_drafts').select('id', { count: 'exact', head: true }).eq('user_id', owner).eq('project_id', project).eq('status', 'draft');
  if (waiting.error) throw new Error('devshark-drafts-unavailable');
  if ((waiting.count ?? 0) >= DEVSHARK_CONCEPT_QUEUE) return { status: 'skipped', code: 'concept-queue-full' };
  const since = new Date(input.now.getTime() - 86_400_000).toISOString();
  const recent = await db.from('marketing_devshark_drafts').select('cost_usd').eq('user_id', owner).eq('origin', 'generated').gte('created_at', since).limit(50);
  if (recent.error) throw new Error('devshark-drafts-unavailable');
  const spent = (recent.data ?? []).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
  if ((recent.data ?? []).length >= limits.perDay) return { status: 'skipped', code: 'concept-daily-count-reached' };
  const model = await input.model();
  const reserve = (MAX_INPUT_TOKENS * model.pricing.inputPerMillionUsd + MAX_OUTPUT_TOKENS * model.pricing.outputPerMillionUsd) / 1_000_000;
  if (spent + reserve > limits.dailyUsd) return { status: 'skipped', code: 'concept-daily-ceiling' };
  const titles = await db.from('marketing_devshark_drafts').select('title').eq('user_id', owner).eq('project_id', project).order('created_at', { ascending: false }).limit(40);
  if (titles.error) throw new Error('devshark-drafts-unavailable');
  const total = await db.from('marketing_devshark_drafts').select('id', { count: 'exact', head: true }).eq('user_id', owner).eq('origin', 'generated');
  const topic = DEVSHARK_CONCEPT_TOPICS[(total.count ?? 0) % DEVSHARK_CONCEPT_TOPICS.length]!;
  let output: unknown, usage: { inputTokens: number; outputTokens: number } | null;
  try { ({ output, usage } = await model.invoke({ system: DEVSHARK_CONCEPT_SYSTEM, prompt: devsharkConceptPrompt(topic, (titles.data ?? []).map((row) => String(row.title))), schema: DevsharkConceptOutputSchema, name: 'devshark_concept', signal: input.signal, maxOutputTokens: MAX_OUTPUT_TOKENS })); }
  catch { return { status: 'refused', code: 'concept-model-failed' }; }
  // An unknown cost counts in full, like DNESKAi's guard.
  const costUsd = usage ? (usage.inputTokens * model.pricing.inputPerMillionUsd + usage.outputTokens * model.pricing.outputPerMillionUsd) / 1_000_000 : reserve;
  const parsed = DevsharkConceptOutputSchema.safeParse(output);
  const made = parsed.success ? devsharkConceptDeck(parsed.data) : { code: 'concept-output-invalid' };
  // A refused output still cost money: it is stored as a rejected concept so the daily ceiling counts it.
  const row = 'deck' in made
    ? { title: parsed.data!.title.trim(), deck: made.deck, caption: parsed.data!.caption.trim(), status: 'draft' }
    : { title: `Refused: ${topic}`.slice(0, 160), deck: { schemaVersion: 'devshark-deck/1', cover: 'light', slides: [] }, caption: made.code, status: 'rejected', decided_at: input.now.toISOString() };
  const { error } = await db.from('marketing_devshark_drafts').insert({ user_id: owner, project_id: project, origin: 'generated', cost_usd: Number(costUsd.toFixed(6)), ...row });
  if (error) throw new Error('devshark-draft-write-failed');
  return 'deck' in made ? { status: 'generated', costUsd } : { status: 'refused', code: made.code, costUsd };
}
