/**
 * The code-written lines of a DNESKAi caption, browser-safe so the Design Lab and the server share them. The model
 * writes the caption's paragraphs; code appends the keyword line (#158), the AI disclosure and the hashtags.
 */

/**
 * The AI disclosure every DNESKAi caption ends its text with. It states how the post was made, names no source and
 * does not claim a legal requirement.
 */
export const DNESKAI_AI_DISCLOSURE = 'Text připravil jazykový model. Výběr a schválení: redakce DNESKAi.';

// Explicit audience imperatives, rather than mentions of comments or instructions to follow a product's steps.
// Bounded clauses keep a distant, unrelated mention from changing the meaning of an ordinary instruction.
const COMMENT_CALL = /\b(?:o?komentuj(?:te)?\b|(?:napis(?:te)?|pridej(?:te)?|zanech(?:te)?|vloz(?:te)?|rekni|reknete|podel(?:te)?\s+se)\b[^.!?\n]{0,100}\bkomentar\w*|(?:leave|write|add|post)\s+(?:us\s+)?(?:a\s+|your\s+)?comment\b)/u;
const FOLLOW_CALL = /\b(?:sleduj(?:te)?\s+(?:nas\b|me\b|@|dneskai\b|(?:nas\w*|tento|tuhle|toto)\s+(?:profil|ucet|strank)\w*)|(?:nas|me)\s+sleduj(?:te)?\b|(?:zacni|zacnete|nezapomen(?:te)?)\s+sledovat\s+(?:nas\b|me\b|@|(?:nas\w*|tento)\s+(?:profil|ucet)\w*)|nezapomen(?:te)?\s+(?:nas|me)\s+sledovat\b|(?:dej(?:te)?|dat)\s+(?:(?:nam|mi)\s+)?follow\b|follow\s+(?:us\b|me\b|our\b|@))/u;

/** A deterministic check for explicit Czech/English audience calls; editorial review still checks meaning. */
export function dneskaiHasAudienceCall(text: string): boolean {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('cs').replace(/[^\S\n]+/gu, ' ');
  return COMMENT_CALL.test(plain) || FOLLOW_CALL.test(plain);
}

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
