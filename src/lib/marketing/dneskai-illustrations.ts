import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';

/**
 * The DNESKAi illustration library (owner request, 9 November 2026: every slide carries a photograph). Pexels pictures,
 * which may be stored and reused commercially without a credit (`docs/dneskai-illustration-library.md`), are searched
 * per topic of the DNESKAi set, stored once in the private bucket `dneskai-illustrations` and tagged by Claude vision,
 * which also flags what a DNESKAi post must never show (a readable brand or logo, text, a person as the subject). The
 * library tick (`/api/marketing/dneskai/illustrations/tick`) adds a few pictures a call until the target is reached,
 * under a daily cap on the paid look.
 */
type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;

export const DNESKAI_ILLUSTRATION_BUCKET = 'dneskai-illustrations';
export const DNESKAI_ILLUSTRATION_TARGET = 400;
/** Pictures a topic holds at most, so every topic of the set is covered before any one fills up. */
export const DNESKAI_ILLUSTRATION_PER_TOPIC = 30;
export const DNESKAI_ILLUSTRATION_DAILY_USD = 2;
/** The shorter side a library picture needs, so a full-bleed slide may crop and zoom it up to 1.6× without the render refusing it. */
export const DNESKAI_ILLUSTRATION_MIN_SIDE = 1300;
const LOOK = { model: 'claude-sonnet-5-5', inputPerMillionUsd: 2, outputPerMillionUsd: 10, reserveUsd: 0.006 } as const;

/** The DNESKAi topic set with the searches that illustrate it (English: Pexels searches in English). */
export const DNESKAI_ILLUSTRATION_TOPICS: ReadonlyArray<{ topic: string; queries: readonly string[] }> = [
  { topic: 'ai', queries: ['artificial intelligence abstract', 'neural network technology', 'robot hand technology'] },
  { topic: 'chips', queries: ['computer chip macro', 'semiconductor wafer', 'circuit board close up'] },
  { topic: 'phones', queries: ['smartphone on desk', 'mobile phone screen hands', 'smartphone app'] },
  { topic: 'banking', queries: ['online banking payment', 'credit card payment terminal', 'coins and banknotes'] },
  { topic: 'startups', queries: ['startup team meeting', 'laptop coworking space', 'whiteboard planning'] },
  { topic: 'prague', queries: ['prague city', 'prague skyline', 'czech republic city street'] },
  { topic: 'office', queries: ['modern office interior', 'office desk computer', 'open plan office'] },
  { topic: 'datacenter', queries: ['data center server room', 'server racks', 'network cables'] },
  { topic: 'work', queries: ['person working laptop', 'developer coding', 'remote work home office'] },
  { topic: 'crypto', queries: ['cryptocurrency coin', 'blockchain abstract', 'stock market chart screen'] },
  { topic: 'energy', queries: ['solar panels', 'wind turbines', 'power lines electricity'] },
  { topic: 'cars', queries: ['electric car charging', 'electric vehicle', 'car dashboard'] },
  { topic: 'space', queries: ['rocket launch', 'satellite earth orbit', 'night sky stars'] },
  { topic: 'health', queries: ['medical technology', 'doctor tablet hospital', 'laboratory research'] },
  { topic: 'education', queries: ['students studying laptop', 'university lecture hall', 'books library study'] },
  { topic: 'policy', queries: ['parliament building', 'european union flags', 'government building columns'] },
];

const PexelsSchema = z.object({ photos: z.array(z.object({
  id: z.number(), url: z.string().url(), photographer: z.string().default(''), alt: z.string().nullable().optional(),
  width: z.number(), height: z.number(), src: z.object({ large2x: z.string().url(), original: z.string().url() }),
})).default([]) });

export const IllustrationLookSchema = z.object({
  tags: z.array(z.string().min(2).max(40)).min(3).max(14),
  description: z.string().min(5).max(300),
  brand_or_logo: z.boolean(), readable_text: z.boolean(), person_as_subject: z.boolean(), looks_like_stock_photo_ok: z.boolean(),
});
export type IllustrationLook = z.infer<typeof IllustrationLookSchema>;
const LOOK_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tags', 'description', 'brand_or_logo', 'readable_text', 'person_as_subject', 'looks_like_stock_photo_ok'],
  properties: {
    tags: { type: 'array', items: { type: 'string' } }, description: { type: 'string' },
    brand_or_logo: { type: 'boolean' }, readable_text: { type: 'boolean' }, person_as_subject: { type: 'boolean' }, looks_like_stock_photo_ok: { type: 'boolean' },
  },
} as const;
const LOOK_SYSTEM = [
  'You tag one stock photograph for the illustration library of a Czech tech news account.',
  'tags: 4 to 12 lowercase English words or short phrases naming what is shown and what news topics it could illustrate (for example "server room", "data center", "cloud", "ai").',
  'description: one plain sentence describing the picture.',
  'brand_or_logo: true if any company name, brand mark or logo can be recognised (a bank, a phone maker, an app).',
  'readable_text: true only if prominent words or numbers a reader would notice can be read (a sign, a headline, a screen full of legible text); tiny markings, part numbers or blurred text do not count.',
  'person_as_subject: true if a person is the main subject or a face is clearly recognisable; hands or a distant figure are fine.',
  'looks_like_stock_photo_ok: true if it is a sharp, natural photograph fit for a news slide, false for an illustration, collage or a poor picture.',
].join('\n');

/** Whether the library may use a picture: tagged, and nothing a DNESKAi post must not show. */
export const illustrationUsable = (look: IllustrationLook) => !look.brand_or_logo && !look.readable_text && !look.person_as_subject && look.looks_like_stock_photo_ok;

export function dneskaiIllustrationSettings(env: Environment = process.env): { pexelsKey: string; anthropicKey: string; dailyUsd: number } | { idle: string } {
  if (env.DNESKAI_ILLUSTRATIONS_ENABLED !== 'true') return { idle: 'illustrations-disabled' };
  if (env.MARKETING_AI_CONSENT !== 'true') return { idle: 'generation-consent-required' };
  if (!env.PEXELS_API_KEY) return { idle: 'illustrations-pexels-key-missing' };
  if (!env.ANTHROPIC_API_KEY) return { idle: 'illustrations-look-key-missing' };
  const raw = Number(env.DNESKAI_ILLUSTRATIONS_DAILY_USD ?? DNESKAI_ILLUSTRATION_DAILY_USD);
  const dailyUsd = Number.isFinite(raw) && raw > 0 && raw <= 10 ? raw : DNESKAI_ILLUSTRATION_DAILY_USD;
  return { pexelsKey: env.PEXELS_API_KEY, anthropicKey: env.ANTHROPIC_API_KEY, dailyUsd };
}

const timeout = (ms: number, signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

/** Claude's look at one picture: tags and flags, or null when the answer is unusable; the cost always counts. */
export async function lookAtIllustration(input: { jpeg: Buffer; apiKey: string; fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<{ look: IllustrationLook | null; costUsd: number }> {
  try {
    const preview = await sharp(input.jpeg).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
    const response = await (input.fetchImpl ?? fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST', redirect: 'error', signal: timeout(45_000, input.signal),
      headers: { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: LOOK.model, max_tokens: 1000, system: LOOK_SYSTEM, thinking: { type: 'between_tools' },
        output_config: { format: { type: 'json_schema', schema: LOOK_SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: preview.toString('base64') } }, { type: 'text', text: 'Tag this photograph.' }] }] }),
    });
    const body = (await response.json().catch(() => null)) as { content?: Array<{ text?: unknown }>; usage?: { input_tokens?: unknown; output_tokens?: unknown } } | null;
    const usage = body?.usage;
    const costUsd = typeof usage?.input_tokens === 'number' && typeof usage?.output_tokens === 'number'
      ? (usage.input_tokens * LOOK.inputPerMillionUsd + usage.output_tokens * LOOK.outputPerMillionUsd) / 1_000_000 : LOOK.reserveUsd;
    if (!response.ok) return { look: null, costUsd };
    const text = (body?.content ?? []).map((block) => (typeof block.text === 'string' ? block.text : '')).join('');
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return { look: null, costUsd };
    const parsed = IllustrationLookSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return { look: parsed.success ? { ...parsed.data, tags: [...new Set(parsed.data.tags.map((tag) => tag.toLowerCase().trim()))] } : null, costUsd };
  } catch { return { look: null, costUsd: LOOK.reserveUsd }; }
}

export type IllustrationTickResult = { status: 'idle' | 'worked' | 'skipped'; code?: string; added: number; refused: number; costUsd: number };

/** One library call: the emptiest topic's next Pexels page, a few pictures stored and tagged while time and cap allow. */
export async function addDneskaiIllustrations(db: Database, env: Environment, input: { signal: AbortSignal; remainingMs: () => number; now?: () => Date; fetchImpl?: typeof fetch }): Promise<IllustrationTickResult> {
  const settings = dneskaiIllustrationSettings(env);
  if ('idle' in settings) return { status: 'skipped', code: settings.idle, added: 0, refused: 0, costUsd: 0 };
  const result: IllustrationTickResult = { status: 'idle', added: 0, refused: 0, costUsd: 0 };
  const now = input.now?.() ?? new Date();
  const rows = await db.from('dneskai_illustrations').select('topic,status,cost_usd,created_at,source_id').limit(5000);
  if (rows.error) throw new Error('illustrations-unavailable');
  const all = rows.data ?? [];
  if (all.filter((row) => row.status === 'ready').length >= DNESKAI_ILLUSTRATION_TARGET) return { ...result, code: 'illustrations-target-reached' };
  const since = now.getTime() - 86_400_000;
  let spent = all.filter((row) => Date.parse(row.created_at as string) >= since).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
  if (spent + LOOK.reserveUsd > settings.dailyUsd) return { ...result, code: 'illustrations-daily-cap' };
  // A topic is full with its ready pictures; refused ones only move its search on, up to four pages' worth.
  const counts = new Map(DNESKAI_ILLUSTRATION_TOPICS.map((entry) => [entry.topic, all.filter((row) => row.topic === entry.topic).length]));
  const ready = new Map(DNESKAI_ILLUSTRATION_TOPICS.map((entry) => [entry.topic, all.filter((row) => row.topic === entry.topic && row.status === 'ready').length]));
  const open = DNESKAI_ILLUSTRATION_TOPICS.filter((entry) => (ready.get(entry.topic) ?? 0) < DNESKAI_ILLUSTRATION_PER_TOPIC && (counts.get(entry.topic) ?? 0) < DNESKAI_ILLUSTRATION_PER_TOPIC * 4);
  if (!open.length) return { ...result, code: 'illustrations-topics-full' };
  const entry = open.reduce((a, b) => ((ready.get(a.topic) ?? 0) <= (ready.get(b.topic) ?? 0) ? a : b));
  const known = new Set(all.map((row) => String(row.source_id)));
  const have = counts.get(entry.topic) ?? 0;
  const query = entry.queries[have % entry.queries.length]!;
  const page = 1 + Math.floor(have / (entry.queries.length * 15));
  const fetcher = input.fetchImpl ?? fetch;
  let photos: z.infer<typeof PexelsSchema>['photos'];
  try {
    const response = await fetcher(`https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: '15', page: String(page), orientation: 'portrait' })}`,
      { headers: { Authorization: settings.pexelsKey }, redirect: 'error', signal: timeout(15_000, input.signal) });
    if (!response.ok) return { ...result, code: `illustrations-pexels-http-${response.status}` };
    photos = PexelsSchema.parse(await response.json()).photos;
  } catch { return { ...result, code: 'illustrations-pexels-unavailable' }; }
  for (const photo of photos) {
    if (input.remainingMs() < 15_000 || input.signal.aborted) break;
    const sourceId = `pexels:${photo.id}`;
    if (known.has(sourceId)) continue;
    if (spent + LOOK.reserveUsd > settings.dailyUsd) { result.code = 'illustrations-daily-cap'; break; }
    let jpeg: Buffer;
    try {
      // The original scaled by Pexels to 2048 px: `large2x` is often too small for a full-bleed slide once cropped.
      const url = new URL(photo.src.original);
      if (url.hostname !== 'images.pexels.com') continue;
      url.search = new URLSearchParams({ auto: 'compress', cs: 'tinysrgb', w: '2048', h: '2048', fit: 'max' }).toString();
      const image = await fetcher(url.toString(), { redirect: 'error', signal: timeout(25_000, input.signal) });
      if (!image.ok) continue;
      jpeg = await sharp(new Uint8Array(await image.arrayBuffer())).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      const size = await sharp(jpeg).metadata();
      if (Math.min(size.width ?? 0, size.height ?? 0) < DNESKAI_ILLUSTRATION_MIN_SIDE) continue;
    } catch { continue; }
    const sha256 = createHash('sha256').update(jpeg).digest('hex');
    const meta = await sharp(jpeg).metadata();
    const { look, costUsd } = await lookAtIllustration({ jpeg, apiKey: settings.anthropicKey, fetchImpl: input.fetchImpl, signal: input.signal });
    spent += costUsd; result.costUsd += costUsd;
    const usable = !!look && illustrationUsable(look);
    if (usable) {
      const stored = await db.storage.from(DNESKAI_ILLUSTRATION_BUCKET).upload(`${sha256}.jpg`, jpeg, { contentType: 'image/jpeg', upsert: true });
      if (stored.error) continue;
    }
    const { error } = await db.from('dneskai_illustrations').insert({
      source: 'pexels', source_id: sourceId, page_url: photo.url, photographer: photo.photographer.slice(0, 120), license: 'pexels',
      topic: entry.topic, query, sha256, width: meta.width ?? photo.width, height: meta.height ?? photo.height,
      alt: (photo.alt ?? '').slice(0, 300), tags: look?.tags ?? [], description: look?.description ?? null,
      flags: look ? { brand_or_logo: look.brand_or_logo, readable_text: look.readable_text, person_as_subject: look.person_as_subject, looks_like_stock_photo_ok: look.looks_like_stock_photo_ok } : { unreadable: true },
      status: usable ? 'ready' : 'refused', cost_usd: Number(costUsd.toFixed(6)),
    });
    if (error) continue;
    known.add(sourceId);
    if (usable) result.added++; else result.refused++;
  }
  result.status = result.added || result.refused ? 'worked' : 'idle';
  return result;
}
