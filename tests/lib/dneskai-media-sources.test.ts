import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { DNESKAI_FAL_ILLUSTRATION_URL, DNESKAI_ILLUSTRATION_URL, dneskaiIllustrationUrl, dneskaiMediaSourceSwitches, falKey, generateDneskaiIllustration } from '@/lib/marketing/dneskai-media-sources';

/** The AI illustration step with fal (owner decision, 8 November 2026). Every key and image is synthetic. */
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const falAnswer = (url: string) => Response.json({ images: [{ url, width: 1920, height: 2400 }], seed: 7 });

describe('the DNESKAi illustration providers', () => {
  it('turns the step on with either provider key, and only behind its switch', () => {
    expect(dneskaiMediaSourceSwitches({ MARKETING_DNESKAI_GENERATED_ENABLED: 'true', FAL_API_KEY: 'test-fal' }).generated).toBe(true);
    expect(dneskaiMediaSourceSwitches({ MARKETING_DNESKAI_GENERATED_ENABLED: 'true', FAL_KEY: 'test-fal' }).generated).toBe(true);
    expect(dneskaiMediaSourceSwitches({ MARKETING_DNESKAI_GENERATED_ENABLED: 'true', GEMINI_API_KEY: 'test-gemini' }).generated).toBe(true);
    expect(dneskaiMediaSourceSwitches({ MARKETING_DNESKAI_GENERATED_ENABLED: 'true' }).generated).toBe(false);
    expect(dneskaiMediaSourceSwitches({ FAL_API_KEY: 'test-fal' }).generated).toBe(false);
    expect(falKey({ FAL_API_KEY: 'a', FAL_KEY: 'b' })).toBe('a');
  });

  it('names fal as the origin when its key is set, else Gemini', () => {
    expect(dneskaiIllustrationUrl({ FAL_API_KEY: 'test-fal', GEMINI_API_KEY: 'test-gemini' })).toBe(DNESKAI_FAL_ILLUSTRATION_URL);
    expect(dneskaiIllustrationUrl({ GEMINI_API_KEY: 'test-gemini' })).toBe(DNESKAI_ILLUSTRATION_URL);
    expect(DNESKAI_FAL_ILLUSTRATION_URL).toBe('https://fal.run/fal-ai/bytedance/seedream/v4.5/text-to-image');
  });

  it('asks fal for one inline 4:5 image with the key in its own header, and returns the bytes', async () => {
    const fetcher = vi.fn(async () => falAnswer(`data:image/png;base64,${png.toString('base64')}`));
    const bytes = await generateDneskaiIllustration('A calm editorial illustration.', { FAL_API_KEY: 'test-fal', GEMINI_API_KEY: 'test-gemini' }, { fetchImpl: fetcher as never });
    expect(Buffer.from(bytes!)).toEqual(png);
    const [target, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe(DNESKAI_FAL_ILLUSTRATION_URL);
    expect(init.headers).toMatchObject({ Authorization: 'Key test-fal' });
    expect(JSON.parse(String(init.body))).toEqual({ prompt: 'A calm editorial illustration.', image_size: { width: 1920, height: 2400 }, num_images: 1, sync_mode: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns null for a refused call, a hosted link instead of inline data, or a broken answer', async () => {
    const env = { FAL_API_KEY: 'test-fal' };
    expect(await generateDneskaiIllustration('p', env, { fetchImpl: (async () => new Response('', { status: 429 })) as never })).toBeNull();
    expect(await generateDneskaiIllustration('p', env, { fetchImpl: (async () => falAnswer('https://v3.fal.media/files/x.png')) as never })).toBeNull();
    expect(await generateDneskaiIllustration('p', env, { fetchImpl: (async () => Response.json({ images: [] })) as never })).toBeNull();
    expect(await generateDneskaiIllustration('p', env, { fetchImpl: (async () => { throw new Error('offline'); }) as never })).toBeNull();
  });

  it('falls back to Gemini without a fal key, and does nothing without any key', async () => {
    const fetcher = vi.fn(async () => Response.json({ output_image: { data: png.toString('base64') } }));
    expect(Buffer.from((await generateDneskaiIllustration('p', { GEMINI_API_KEY: 'test-gemini' }, { fetchImpl: fetcher as never }))!)).toEqual(png);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toContain('generativelanguage.googleapis.com');
    const none = vi.fn();
    expect(await generateDneskaiIllustration('p', {}, { fetchImpl: none as never })).toBeNull();
    expect(none).not.toHaveBeenCalled();
  });
});
