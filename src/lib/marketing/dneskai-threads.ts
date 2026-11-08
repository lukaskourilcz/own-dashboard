import { parseContentRevision, type ContentRevision } from './contracts';
import { DNESKAI_AI_DISCLOSURE, dneskaiTopic, dneskaiTopicName } from './dneskai-caption';

/**
 * DNESKAi on Threads (owner decision, 7 November 2026). Every Instagram post of the plan also goes to Threads, and
 * Threads gets one evening post of its own. A Threads post is a twin of the Instagram revision: the same rendered
 * slides, the same sources and schedule, and its own text, because Threads takes 500 characters, one topic tag and
 * no comment-to-DM keyword.
 */
export const THREADS_TEXT_MAX = 500;
/** The topic when a caption has no hashtag of its own. */
export const DNESKAI_THREADS_FALLBACK_TOPIC = 'UmelaInteligence';
const KEYWORD_LINE = /^Napište do komentáře „[A-Z0-9]{1,24}“ a pošleme vám návod do zpráv\.$/;
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

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
 * The Threads text of an Instagram caption (owner decisions, 8 November 2026): only the caption's first written
 * paragraph (no hashtags, AI disclosure or keyword line), shortened to fit, then the post's topic as one hashtag. The
 * topic is the deck's `topic` (the name as people write it, `FioBanka`), else the caption's first hashtag after
 * #dneskai with a capital letter. The publisher sends that hashtag as the Threads `topic_tag`, not as text. The rest
 * of the story is on the slides. Always at most 500 characters.
 */
export function dneskaiThreadsText(caption: string, topic?: string | null): string {
  const paragraphs = caption.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const body = paragraphs
    .filter((paragraph) => paragraph !== DNESKAI_AI_DISCLOSURE && !KEYWORD_LINE.test(paragraph))
    .map((paragraph) => paragraph.replace(HASHTAG, '$1').replace(/[ \t]{2,}/g, ' ').trim())
    .filter(Boolean)[0] ?? '';
  const tail = `#${dneskaiTopicName(topic ?? '') ?? dneskaiTopicName(dneskaiTopic(caption) ?? '') ?? DNESKAI_THREADS_FALLBACK_TOPIC}`;
  const room = THREADS_TEXT_MAX - tail.length - 2;
  const text = body ? `${shorten(body, room)}\n\n${tail}` : tail;
  return text.slice(0, THREADS_TEXT_MAX);
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
    caption: dneskaiThreadsText(instagram.caption, instagram.deck?.topic),
    format: images.length >= 2 ? 'carousel' : 'post',
    scheduledAt,
  });
}
