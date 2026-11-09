import { parseContentRevision, type ContentRevision } from './contracts';
import { dneskaiCaptionWithKeyword, dneskaiPublicText } from './dneskai-caption';

/**
 * DNESKAi on Threads (owner decision, 7 November 2026). Every Instagram post of the plan also goes to Threads, and
 * Threads gets one evening post of its own. A Threads post is a twin of the Instagram revision: the same rendered
 * slides, sources and schedule. Its text is limited to 500 characters and carries no topic tag or comment-to-DM keyword.
 */
export const THREADS_TEXT_MAX = 500;
const TRAILING_HASHTAGS = /(?:^|[ \t]+)(?:#[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*(?:[ \t]+|$))+$/u;
const INLINE_HASHTAG = /(?<![\p{L}\p{M}\p{N}_/#])#(?=[\p{L}\p{N}_])/gu;

/** Drop tag lists and keep the words of inline hashtags as plain text. */
export function stripThreadsHashtags(caption: string): string {
  return caption.split(/\r?\n/).map((line) =>
    line.trimEnd().replace(TRAILING_HASHTAGS, '').replace(INLINE_HASHTAG, ''),
  ).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Cuts text to `max` characters at the last sentence or word end that fits, with an ellipsis when it cut. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, Math.max(0, max - 1));
  const sentence = Math.max(room.lastIndexOf('. '), room.lastIndexOf('! '), room.lastIndexOf('? '), room.lastIndexOf('\n'));
  if (sentence >= max * 0.6) return room.slice(0, sentence + 1).trimEnd();
  const word = room.lastIndexOf(' ');
  return `${(word > 0 ? room.slice(0, word) : room).trimEnd().replace(/[,;:–-]$/, '')}…`;
}

/**
 * Threads uses the first written paragraph. The rest of the story is on the slides.
 */
export function dneskaiThreadsText(caption: string): string {
  const text = stripThreadsHashtags(dneskaiPublicText(dneskaiCaptionWithKeyword(caption, null)));
  return shorten(text.split(/\n{2,}/)[0] ?? '', THREADS_TEXT_MAX);
}

export type DneskaiThreadsAccount = { remote_account_id: string; handle: string };

/**
 * The Threads twin of an Instagram revision at `scheduledAt`: same deck, slides, sources and trace, the Threads
 * account, the Threads text, a carousel of the slides (a Reel goes to Threads as its slides) or one image, and no
 * keyword reply, Reel track or Instagram co-authors.
 */
export function dneskaiThreadsTwin(instagram: ContentRevision, account: DneskaiThreadsAccount, scheduledAt: string = instagram.scheduledAt): ContentRevision {
  if (instagram.account.platform !== 'instagram' || instagram.brand !== 'dneskai') throw new Error('threads-twin-source-invalid');
  const { engagement: _engagement, audio: _audio, collaborators: _collaborators, ...rest } = instagram;
  void _engagement; void _audio; void _collaborators;
  const images = instagram.assets.filter((asset) => asset.mimeType === 'image/jpeg');
  if (!images.length || images.length !== instagram.assets.length) throw new Error('threads-twin-assets-invalid');
  return parseContentRevision({
    ...rest,
    account: { id: account.remote_account_id, platform: 'threads', handle: account.handle.replace(/^@/, '') },
    caption: dneskaiThreadsText(instagram.caption) || stripThreadsHashtags(instagram.title),
    format: images.length >= 2 ? 'carousel' : 'post',
    scheduledAt,
  });
}
