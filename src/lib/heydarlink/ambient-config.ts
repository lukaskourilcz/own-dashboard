import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HEYDARLINK_AMBIENT_SHOTS } from './ambient-shots';

/**
 * Settings of the HeyDarlink ambient pipeline (moved from Quorum on 8 November 2026). One shot per persona per day,
 * rendered natively in each of its aspects (4:5 feed 1080×1350, 9:16 story 1080×1920), graded per persona, gated
 * and uploaded to HeyDarlink's `POST /api/photo-library/ambient`.
 */
export const AMBIENT_ASPECTS = ['4:5', '9:16'] as const;
export type AmbientAspect = (typeof AMBIENT_ASPECTS)[number];
export const AMBIENT_PERSONAS = ['nina', 'fatimah', 'teresa', 'michaela'] as const;
export type AmbientPersona = (typeof AMBIENT_PERSONAS)[number];
export const AMBIENT_SIZES: Record<AmbientAspect, { width: number; height: number }> = { '4:5': { width: 1080, height: 1350 }, '9:16': { width: 1080, height: 1920 } };

export const AMBIENT_FAL = {
  host: 'fal.run', model: 'fal-ai/flux/dev', img2imgModel: 'fal-ai/flux/dev/image-to-image', steps: 28,
  outputHosts: ['fal.media', 'v3.fal.media', 'v3b.fal.media'], usdPerMegapixel: 0.025,
} as const;
export const AMBIENT_GATE = {
  /** Claude Sonnet 5.5 checks every frame; about 1,600 input tokens for a 1024 px picture and the instructions. */
  model: 'claude-sonnet-5-5', pricing: { inputPerMillionUsd: 2, outputPerMillionUsd: 10 }, reserveUsd: 0.006,
  nearDuplicateDistance: 8, maxBytes: 8_000_000, maxCropFraction: 0.2, historyDays: 90,
} as const;
export const AMBIENT_CAPS = { dailyUsdDefault: 1, dailyUsdMax: 5, perFrameUsdMax: 0.12, maxAttemptsPerFrame: 2, shotsPerPersonaPerDay: 1 } as const;

const REQUIRED_PHRASES = ['no people', 'no faces', 'no text', 'no logos'];
const ShotSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,60}$/u),
  pillar: z.enum(['views', 'food', 'drinks', 'interiors', 'flatlay', 'city', 'sunset', 'outfit', 'books', 'flowers']),
  prompt: z.string().min(40).max(900),
  aspects: z.array(z.enum(AMBIENT_ASPECTS)).min(1),
  stockSeed: z.object({ query: z.string().min(3).max(80), strength: z.number().min(0.75).max(0.95) }).optional(),
}).refine((shot) => REQUIRED_PHRASES.every((phrase) => shot.prompt.toLowerCase().includes(phrase)), { message: `every prompt must contain: ${REQUIRED_PHRASES.join(', ')}` });
export type AmbientShot = z.infer<typeof ShotSchema>;
const GradeSchema = z.object({
  contrast: z.number().min(0.7).max(1.4), lift: z.number().min(-30).max(30), warmth: z.number().min(-1).max(1),
  saturation: z.number().min(0.6).max(1.4), grain: z.number().min(0).max(0.06), vignette: z.number().min(0).max(0.12),
});
export type AmbientGrade = z.infer<typeof GradeSchema>;
const PersonaSchema = z.object({ home: z.string(), grade: GradeSchema, shots: z.array(ShotSchema).min(4) });
const ShotListSchema = z.object({ negative: z.string(), personas: z.object({ nina: PersonaSchema, fatimah: PersonaSchema, teresa: PersonaSchema, michaela: PersonaSchema }) });
export type AmbientShotList = z.infer<typeof ShotListSchema>;

/** The validated shot list; shot ids are unique across personas. */
export function ambientShotList(raw: unknown = HEYDARLINK_AMBIENT_SHOTS): AmbientShotList {
  const list = ShotListSchema.parse(raw);
  const ids = AMBIENT_PERSONAS.flatMap((key) => list.personas[key].shots.map((shot) => shot.id));
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`shot id ${duplicate} appears twice`);
  return list;
}

/** fal bills per megapixel rounded up: 4:5 is two megapixels, 9:16 three. */
export const ambientFalUsd = (aspect: AmbientAspect) => Math.ceil((AMBIENT_SIZES[aspect].width * AMBIENT_SIZES[aspect].height) / 1_000_000) * AMBIENT_FAL.usdPerMegapixel;

type Environment = Record<string, string | undefined>;
export type AmbientSettings = { falKey: string; anthropicKey: string; ingestUrl: string; ingestToken: string; pexelsKey: string | null; dailyUsd: number; gateModel: string };
/**
 * Everything the step needs, or the reason it stays idle. Off unless HEYDARLINK_AMBIENT_ENABLED=true; Claude runs only
 * with MARKETING_AI_CONSENT=true, like every model call in OwnDashboard's marketing workflow. A missing ingest token
 * idles the step before anything is paid for.
 */
export function heydarlinkAmbientSettings(env: Environment = process.env): AmbientSettings | { idle: string } {
  if (env.HEYDARLINK_AMBIENT_ENABLED !== 'true') return { idle: 'ambient-disabled' };
  if (env.MARKETING_AI_CONSENT !== 'true') return { idle: 'generation-consent-required' };
  if (!env.HEYDARLINK_INGEST_URL || !env.HEYDARLINK_INGEST_TOKEN) return { idle: 'ambient-ingest-missing' };
  if (!env.FAL_API_KEY) return { idle: 'ambient-fal-key-missing' };
  if (!env.ANTHROPIC_API_KEY) return { idle: 'ambient-gate-key-missing' };
  const raw = Number(env.HEYDARLINK_AMBIENT_DAILY_USD ?? AMBIENT_CAPS.dailyUsdDefault);
  // A value over the maximum is a typo, not a decision: the default holds.
  const dailyUsd = Number.isFinite(raw) && raw >= 0 && raw <= AMBIENT_CAPS.dailyUsdMax ? raw : AMBIENT_CAPS.dailyUsdDefault;
  return { falKey: env.FAL_API_KEY, anthropicKey: env.ANTHROPIC_API_KEY, ingestUrl: env.HEYDARLINK_INGEST_URL, ingestToken: env.HEYDARLINK_INGEST_TOKEN,
    pexelsKey: env.PEXELS_API_KEY || null, dailyUsd, gateModel: env.HEYDARLINK_AMBIENT_GATE_MODEL?.trim() || AMBIENT_GATE.model };
}

/** Deterministic per frame and attempt, so a rerun asks for the same picture. */
export function ambientSeed(...parts: Array<string | number>): number {
  return createHash('sha256').update(parts.join(':')).digest().readUInt32BE(0) % 2_147_483_647;
}

/**
 * The day's shots for one persona, never repeating one until the persona's whole list has run. The order inside a
 * cycle is a shuffle keyed on the date and persona, so the four accounts never march through their lists together.
 */
export function pickAmbientShots(input: { shots: readonly AmbientShot[]; used: readonly string[]; count: number; date: string; persona: string }): { picked: AmbientShot[]; used: string[] } {
  const known = new Set(input.shots.map((shot) => shot.id));
  let used = input.used.filter((id) => known.has(id));
  const picked: AmbientShot[] = [];
  const count = Math.min(input.count, input.shots.length);
  let cycle = 0;
  while (picked.length < count) {
    const taken = new Set([...used, ...picked.map((shot) => shot.id)]);
    const rank = (shot: AmbientShot) => createHash('sha256').update(`${input.date}:${input.persona}:${cycle}:${shot.id}`).digest('hex');
    const fresh = input.shots.filter((shot) => !taken.has(shot.id)).sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
    if (!fresh.length) { used = []; cycle += 1; continue; }
    const take = fresh.slice(0, count - picked.length);
    picked.push(...take);
    used = [...used, ...take.map((shot) => shot.id)];
  }
  return { picked, used: used.length >= input.shots.length ? [] : used };
}
