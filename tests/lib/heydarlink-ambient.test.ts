import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import sharp from 'sharp';
import { AMBIENT_PERSONAS, ambientFalUsd, ambientShotList, heydarlinkAmbientSettings, pickAmbientShots } from '@/lib/heydarlink/ambient-config';
import { ambientDuplicateGate, ambientFormatGate, ambientVerdictFromContent, ambientVerdictReasons, parseAmbientVerdict, readAmbientFormat } from '@/lib/heydarlink/ambient-gates';
import { gradeAmbientFrame } from '@/lib/heydarlink/ambient-grade';
import { ambientIngestForm, ambientSha256, uploadAmbientFrame } from '@/lib/heydarlink/ambient-ingest';
import { ambientHamming, ambientPhash } from '@/lib/heydarlink/ambient-phash';

const env = { HEYDARLINK_AMBIENT_ENABLED: 'true', MARKETING_AI_CONSENT: 'true', HEYDARLINK_INGEST_URL: 'https://heydarlink.example/api/photo-library/ambient', HEYDARLINK_INGEST_TOKEN: 't', FAL_API_KEY: 'f', ANTHROPIC_API_KEY: 'a' };
const gradient = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#7a8899' } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g"><stop offset="0" stop-color="#203040"/><stop offset="1" stop-color="#e0c080"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width / 3}" cy="${height / 2}" r="${width / 6}" fill="#ffffff"/></svg>`) }]).jpeg().toBuffer();

describe('HeyDarlink ambient shot list (moved from Quorum, 8 November 2026)', () => {
  it('holds ten valid shots per persona with unique ids that say no people, faces, text or logos', () => {
    const list = ambientShotList();
    for (const persona of AMBIENT_PERSONAS) {
      expect(list.personas[persona].shots).toHaveLength(10);
      for (const shot of list.personas[persona].shots) expect(shot.id.startsWith(persona)).toBe(true);
    }
    expect(() => ambientShotList({ ...list, personas: { ...list.personas, nina: { ...list.personas.nina, shots: [{ ...list.personas.nina.shots[0]!, prompt: 'A plain café table by a window with a latte, morning light, candid iPhone photo.' }, ...list.personas.nina.shots.slice(1)] } } })).toThrow();
  });

  it('never repeats a shot until the list has run, and is stable for the same day', () => {
    const shots = ambientShotList().personas.nina.shots;
    const first = pickAmbientShots({ shots, used: [], count: 3, date: '2026-11-08', persona: 'nina' });
    expect(pickAmbientShots({ shots, used: [], count: 3, date: '2026-11-08', persona: 'nina' }).picked.map((shot) => shot.id)).toEqual(first.picked.map((shot) => shot.id));
    const next = pickAmbientShots({ shots, used: first.used, count: 7, date: '2026-11-09', persona: 'nina' });
    expect(new Set([...first.picked, ...next.picked].map((shot) => shot.id)).size).toBe(10);
    expect(next.used).toEqual([]);
  });

  it('prices fal per megapixel rounded up: one megapixel per attempt at either aspect', () => {
    expect(ambientFalUsd('4:5')).toBeCloseTo(0.025);
    expect(ambientFalUsd('9:16')).toBeCloseTo(0.025);
  });

  it('stays idle until it is switched on, has consent, its keys and the ingest token', () => {
    expect(heydarlinkAmbientSettings({})).toEqual({ idle: 'ambient-disabled' });
    expect(heydarlinkAmbientSettings({ ...env, MARKETING_AI_CONSENT: 'false' })).toEqual({ idle: 'generation-consent-required' });
    expect(heydarlinkAmbientSettings({ ...env, HEYDARLINK_INGEST_TOKEN: '' })).toEqual({ idle: 'ambient-ingest-missing' });
    expect(heydarlinkAmbientSettings({ ...env, FAL_API_KEY: '' })).toEqual({ idle: 'ambient-fal-key-missing' });
    expect(heydarlinkAmbientSettings({ ...env, ANTHROPIC_API_KEY: '' })).toEqual({ idle: 'ambient-gate-key-missing' });
    expect(heydarlinkAmbientSettings(env)).toMatchObject({ falKey: 'f', pexelsKey: null, dailyUsd: 1 });
  });
});

describe('HeyDarlink ambient gates', () => {
  it('rejects every flagged field and an off-brief frame, and refuses anything but the exact verdict', () => {
    const clean = { people: false, faces: false, body_parts: false, text_or_logos: false, nsfw: false, matches_brief: true };
    expect(ambientVerdictReasons(clean)).toEqual([]);
    expect(ambientVerdictReasons({ ...clean, body_parts: true, matches_brief: false })).toEqual(['vision:body_parts', 'vision:off-brief']);
    expect(parseAmbientVerdict(`Here: ${JSON.stringify(clean)}`)).toEqual(clean);
    expect(parseAmbientVerdict('{"people":false}')).toBeNull();
    // An extra key no longer rejects a complete verdict.
    expect(parseAmbientVerdict(JSON.stringify({ ...clean, extra: true }))).toEqual(clean);
    // The forced tool's input is read first; prose around it does not matter.
    expect(ambientVerdictFromContent([{ type: 'text', text: 'Looking at it.' }, { type: 'tool_use', name: 'record_verdict', input: clean }])).toEqual(clean);
    expect(ambientVerdictFromContent([{ type: 'tool_use', name: 'record_verdict', input: { people: 'no' } }])).toBeNull();
  });

  it('checks the exact size and format, and near duplicates by perceptual hash', async () => {
    const jpeg = await gradient(1080, 1350);
    expect(ambientFormatGate(jpeg, await readAmbientFormat(jpeg), '4:5')).toEqual([]);
    expect(ambientFormatGate(jpeg, await readAmbientFormat(jpeg), '9:16')).toEqual(['format:size-1080x1350']);
    const png = await sharp(jpeg).png().toBuffer();
    expect(ambientFormatGate(png, await readAmbientFormat(png), '4:5')).toContain('format:not-jpeg');
    const hash = await ambientPhash(jpeg);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(ambientHamming(hash, hash)).toBe(0);
    expect(ambientDuplicateGate(hash, [hash])).toBe('duplicate:phash-distance-0');
    expect(ambientDuplicateGate(hash, ['ffffffffffffffff'.split('').map((c, i) => (i % 2 ? c : '0')).join('')])).toBeNull();
  });

  it('grades to the exact size and refuses a crop over 20 %', async () => {
    const grade = ambientShotList().personas.teresa.grade;
    const story = await gradeAmbientFrame({ source: await gradient(1080, 1920), aspect: '9:16', grade, noiseSeed: 7 });
    expect(await readAmbientFormat(story)).toMatchObject({ width: 1080, height: 1920, format: 'jpeg' });
    await expect(gradeAmbientFrame({ source: await gradient(1024, 1024), aspect: '9:16', grade, noiseSeed: 7 })).rejects.toThrow();
  });
});

describe('HeyDarlink ingest', () => {
  const meta = { persona_key: 'nina' as const, aspect: '4:5' as const, pillar: 'food', shot_id: 'nina-cafe-latte', prompt: 'p', provider: 'fal', model: 'fal-ai/flux/dev', cost_usd: 0.056, seed: 5, phash: '0123456789abcdef', source_ref: null };

  it('sends the contract fields with the sha256 of the exact bytes', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const form = ambientIngestForm(jpeg, meta);
    expect(form.get('sha256')).toBe(ambientSha256(jpeg));
    expect(form.get('cost_usd')).toBe('0.056000');
    expect(form.get('source_ref')).toBeNull();
    expect((form.get('file') as File).name).toBe('nina-cafe-latte-4x5.jpg');
  });

  it('stores, reports duplicates, never retries a 4xx and never sends the token over plain HTTP', async () => {
    const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
    expect(await uploadAmbientFrame({ url: 'https://h.example/a', token: 't', jpeg, meta, fetchImpl: reply(200, { id: 'x' }) as never })).toEqual({ kind: 'stored', id: 'x' });
    expect(await uploadAmbientFrame({ url: 'https://h.example/a', token: 't', jpeg, meta, fetchImpl: reply(409, { code: 'DUPLICATE', id: 'y' }) as never })).toEqual({ kind: 'duplicate', id: 'y', code: 'DUPLICATE' });
    const unauthorized = reply(401, { error: 'Unauthorized' });
    expect(await uploadAmbientFrame({ url: 'https://h.example/a', token: 't', jpeg, meta, fetchImpl: unauthorized as never, sleep: async () => {} })).toMatchObject({ kind: 'failed', status: 401 });
    expect(unauthorized).toHaveBeenCalledTimes(1);
    const plain = vi.fn();
    expect(await uploadAmbientFrame({ url: 'http://h.example/a', token: 't', jpeg, meta, fetchImpl: plain as never })).toEqual({ kind: 'failed', status: 0, code: 'INVALID_URL' });
    expect(plain).not.toHaveBeenCalled();
  });
});

describe('plan frames named by a HeyDarlink posting-plan ref (8 November 2026)', () => {
  it('use their own prompt only when it carries the four no-people phrases', async () => {
    const { ambientPlanPrompt } = await import('@/lib/heydarlink/ambient-batch');
    expect(ambientPlanPrompt('Candid iPhone photo of a marina skyline at golden hour in Dubai. No people, no faces, no hands, no text, no logos, no watermark.')).toBe(true);
    expect(ambientPlanPrompt('Candid iPhone photo of a marina skyline at golden hour in Dubai, people strolling.')).toBe(false);
  });
});
