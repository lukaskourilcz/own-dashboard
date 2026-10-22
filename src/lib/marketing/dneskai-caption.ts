/**
 * The code-written lines of a DNESKAi caption, browser-safe so the Design Lab and the server share them. The model
 * writes the caption's paragraphs; code appends the keyword line (#158), the AI disclosure and the hashtags.
 */

/**
 * The AI disclosure every DNESKAi caption ends its text with. It states how the post was made, names no source and
 * does not claim a legal requirement.
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
