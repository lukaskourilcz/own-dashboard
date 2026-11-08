import 'server-only';
import sharp from 'sharp';
import { AMBIENT_FAL, AMBIENT_SIZES, ambientSeed, type AmbientAspect, type AmbientShot } from './ambient-config';

/**
 * fal FLUX dev renders every HeyDarlink ambient frame natively at its aspect. A shot with a `stockSeed` first takes a
 * Pexels photo of the landmark (portrait, no person in its description) and sends it to FLUX image-to-image at
 * strength 0.8 or more: the geometry stays, the pixels are new. Stock is never posted as it is.
 */
export type AmbientRender = { bytes: Uint8Array; model: string; seed: number; flaggedNsfw: boolean; sourceRef: string | null };
export class AmbientRenderError extends Error { constructor(readonly code: string) { super(code); } }

const PERSON_WORDS = /\b(man|men|woman|women|people|person|girl|boy|child|children|kid|face|portrait|couple|tourist|crowd|selfie|model)s?\b/iu;
const MAX_IMAGE_BYTES = 15_000_000;
const timeout = (ms: number, signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

async function readBytes(response: Response, max: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > max) throw new AmbientRenderError('ambient-download-too-large');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > max) throw new AmbientRenderError('ambient-download-too-large');
  return bytes;
}

/** A Pexels seed for a landmark shot, or null: no key, no result, or every candidate shows a person. */
export async function ambientStockSeed(shot: AmbientShot, aspect: AmbientAspect, input: { pexelsKey: string | null; date: string; fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<{ bytes: Uint8Array; strength: number; ref: string } | null> {
  if (!shot.stockSeed || !input.pexelsKey) return null;
  const fetcher = input.fetchImpl ?? fetch;
  try {
    const search = await fetcher(`https://api.pexels.com/v1/search?${new URLSearchParams({ query: shot.stockSeed.query, orientation: 'portrait', per_page: '15' })}`, { headers: { Authorization: input.pexelsKey }, redirect: 'error', signal: timeout(20_000, input.signal) });
    if (!search.ok) return null;
    const payload = (await search.json()) as { photos?: Array<{ id?: unknown; alt?: unknown; src?: { large2x?: unknown } }> };
    const usable = (payload.photos ?? []).flatMap((photo) => typeof photo.src?.large2x === 'string' && !PERSON_WORDS.test(typeof photo.alt === 'string' ? photo.alt : '')
      ? [{ url: photo.src.large2x, ref: `pexels:${String(photo.id)}` }] : []);
    if (!usable.length) return null;
    const chosen = usable[ambientSeed(input.date, shot.id) % usable.length]!;
    if (new URL(chosen.url).hostname !== 'images.pexels.com') return null;
    const image = await fetcher(chosen.url, { redirect: 'error', signal: timeout(30_000, input.signal) });
    if (!image.ok) return null;
    const { width, height } = AMBIENT_SIZES[aspect];
    const bytes = await sharp(await readBytes(image, MAX_IMAGE_BYTES)).rotate().resize(width, height, { fit: 'cover', kernel: 'lanczos3' }).jpeg({ quality: 88 }).toBuffer();
    return { bytes, strength: shot.stockSeed.strength, ref: chosen.ref };
  } catch { return null; }
}

/** One fal render. Throws `AmbientRenderError` on any failure; the caller records it and moves on. */
export async function renderAmbientFrame(input: { falKey: string; prompt: string; aspect: AmbientAspect; seed: number; stock?: { bytes: Uint8Array; strength: number; ref: string } | null; fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<AmbientRender> {
  const fetcher = input.fetchImpl ?? fetch;
  const size = AMBIENT_SIZES[input.aspect];
  const model = input.stock ? AMBIENT_FAL.img2imgModel : AMBIENT_FAL.model;
  const body: Record<string, unknown> = {
    // FLUX has no negative prompt input; the positive prompt already says what to leave out.
    prompt: input.prompt, image_size: { width: size.width, height: size.height }, num_inference_steps: AMBIENT_FAL.steps,
    seed: input.seed, num_images: 1, enable_safety_checker: true, output_format: 'jpeg',
    ...(input.stock ? { image_url: `data:image/jpeg;base64,${Buffer.from(input.stock.bytes).toString('base64')}`, strength: input.stock.strength } : {}),
  };
  let response: Response;
  try {
    response = await fetcher(`https://${AMBIENT_FAL.host}/${model}`, { method: 'POST', redirect: 'error', signal: timeout(120_000, input.signal),
      headers: { Authorization: `Key ${input.falKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new AmbientRenderError('ambient-fal-unreachable'); }
  if (!response.ok) throw new AmbientRenderError(`ambient-fal-http-${response.status}`);
  const payload = (await response.json().catch(() => null)) as { images?: Array<{ url?: unknown }>; seed?: unknown; has_nsfw_concepts?: unknown[] } | null;
  const url = typeof payload?.images?.[0]?.url === 'string' ? payload.images[0].url : '';
  if (!url) throw new AmbientRenderError('ambient-fal-no-image');
  const host = new URL(url).hostname;
  if (!(AMBIENT_FAL.outputHosts as readonly string[]).some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) throw new AmbientRenderError('ambient-fal-output-host');
  let image: Response;
  try { image = await fetcher(url, { redirect: 'error', signal: timeout(60_000, input.signal) }); } catch { throw new AmbientRenderError('ambient-fal-download-failed'); }
  if (!image.ok || !(image.headers.get('content-type') ?? '').startsWith('image/')) throw new AmbientRenderError('ambient-fal-download-failed');
  return { bytes: await readBytes(image, MAX_IMAGE_BYTES), model, seed: typeof payload?.seed === 'number' ? payload.seed : input.seed,
    flaggedNsfw: payload?.has_nsfw_concepts?.[0] === true, sourceRef: input.stock?.ref ?? null };
}
