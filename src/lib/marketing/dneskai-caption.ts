/**
 * The code-written lines of a DNESKAi caption, browser-safe so the Design Lab and the server share them. The model
 * writes the caption's paragraphs; code appends the keyword line (#158), the AI disclosure and the hashtags.
 */

/**
 * The AI disclosure older DNESKAi captions ended their text with. The owner removed it from every post on 8 November
 * 2026: new captions no longer carry it, and `dneskaiPublicText` drops it from stored ones when they are published.
 */
export const DNESKAI_AI_DISCLOSURE = 'Text připravil jazykový model. Výběr a schválení: redakce DNESKAi.';

/**
 * The one call to comment a DNESKAi caption may carry (#158, owner decision 3): written by code from the approved
 * keyword, never by the model. It carries no hashtag, so it never counts toward the ten-hashtag cap.
 */
export function dneskaiKeywordLine(keyword: string): string {
  return `Napište do komentáře „${keyword}“ a pošleme vám návod do zpráv.`;
}
const KEYWORD_LINE = /^Napište do komentáře „[A-Z0-9]{1,24}“ a pošleme vám návod do zpráv\.$/;

/**
 * The caption with exactly the keyword line for `keyword`, or with none for null. The line sits in its own paragraph
 * before the AI disclosure (or, without one, before the closing hashtag paragraph, else at the end). A caption that
 * already matches is returned unchanged, character for character, so an untouched post keeps its approval hash.
 */
export function dneskaiCaptionWithKeyword(caption: string, keyword: string | null): string {
  const paragraphs = caption.split(/\n{2,}/);
  const kept = paragraphs.filter((paragraph) => !KEYWORD_LINE.test(paragraph.trim()));
  const line = keyword ? dneskaiKeywordLine(keyword) : null;
  const current = paragraphs.filter((paragraph) => KEYWORD_LINE.test(paragraph.trim())).map((paragraph) => paragraph.trim());
  if ((line === null && current.length === 0) || (line !== null && current.length === 1 && current[0] === line)) return caption;
  if (line) {
    const disclosure = kept.findIndex((paragraph) => paragraph.trim() === DNESKAI_AI_DISCLOSURE);
    const last = kept.length - 1;
    const at = disclosure >= 0 ? disclosure : last > 0 && kept[last]!.trim().startsWith('#') ? last : kept.length;
    kept.splice(at, 0, line);
  }
  return kept.join('\n\n');
}

const DNESKAI_BRAND_TAG = 'dneskai';
const TAG = /#([\p{L}\p{N}_]+)/gu;
const TAG_PARAGRAPH = /^(?:#[\p{L}\p{N}_]+\s*)+$/u;

/**
 * The topic of a DNESKAi post: its first hashtag that is not the brand's own, the most specific one by the caption
 * rules (product, company, field). Null when the caption has none.
 */
export function dneskaiTopic(caption: string): string | null {
  for (const match of caption.matchAll(TAG)) if (match[1]!.toLowerCase() !== DNESKAI_BRAND_TAG) return match[1]!.slice(0, 50);
  return null;
}

/**
 * What a DNESKAi post sends as its public text (owner decision, 8 November 2026): the stored caption without the AI
 * disclosure. On Threads the closing hashtag paragraph is not shown either; its topic goes out as the post's
 * `topic_tag`, so Threads shows "dneskai › <topic>" instead of a hashtag line.
 */
export function dneskaiPublicText(caption: string, platform: 'instagram' | 'threads'): { text: string; topicTag: string | null } {
  const paragraphs = caption.split(/\n{2,}/).filter((paragraph) => paragraph.trim() !== DNESKAI_AI_DISCLOSURE);
  if (platform === 'instagram') return { text: paragraphs.join('\n\n').trim(), topicTag: null };
  const topicTag = dneskaiTopic(paragraphs.filter((paragraph) => TAG_PARAGRAPH.test(paragraph.trim())).join(' '));
  return { text: paragraphs.filter((paragraph) => !TAG_PARAGRAPH.test(paragraph.trim())).join('\n\n').trim(), topicTag };
}
