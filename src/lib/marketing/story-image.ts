import 'server-only';
import { createHash } from 'node:crypto';

/**
 * Instagram stories made from a post's cover slide (owner decision, 7 November 2026), for DNESKAi and devShark at no
 * model cost. The 4:5 cover sits full width in the middle of a 1080 × 1920 frame; the rest of the frame is the same
 * cover, enlarged, blurred and darkened, so no text is added and no new picture is needed. Deterministic: the same
 * cover bytes give the same story bytes.
 */
export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

export async function composeStoryFromCover(cover: Buffer): Promise<{ jpeg: Buffer; sha256: string; width: 1080; height: 1920 }> {
  const { default: sharp } = await import('sharp');
  const meta = await sharp(cover).metadata();
  if (meta.format !== 'jpeg' || !meta.width || !meta.height) throw new Error('story-cover-invalid');
  const background = await sharp(cover).resize(STORY_WIDTH, STORY_HEIGHT, { fit: 'cover' }).blur(40).modulate({ brightness: 0.55 }).toBuffer();
  const front = await sharp(cover).resize({ width: STORY_WIDTH }).toBuffer();
  const frontHeight = Math.round(meta.height * STORY_WIDTH / meta.width);
  const jpeg = await sharp(background).composite([{ input: front, left: 0, top: Math.round((STORY_HEIGHT - frontHeight) / 2) }])
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4', progressive: false }).toBuffer();
  const check = await sharp(jpeg).metadata();
  if (check.format !== 'jpeg' || check.width !== STORY_WIDTH || check.height !== STORY_HEIGHT) throw new Error('story-image-invalid');
  return { jpeg, sha256: createHash('sha256').update(jpeg).digest('hex'), width: STORY_WIDTH, height: STORY_HEIGHT };
}

/**
 * The render key a story is stored under: one story per cover. The `version` namespaces the key so a change of story
 * renderer stores under a fresh key and never reuses a story made by the old one. DNESKAi keeps the default;
 * devShark's native 1080×1920 story (8 November 2026) passes `devshark-story/2`.
 */
export function storyRenderKey(coverSha256: string, version = 'marketing-story/1'): string {
  if (!/^[a-f0-9]{64}$/.test(coverSha256)) throw new Error('story-cover-invalid');
  return createHash('sha256').update(`${version}\n${coverSha256}`).digest('hex');
}
