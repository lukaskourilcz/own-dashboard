/** Browser links may use HTTP(S), but never credentials or control characters. */
export function safeWebUrl(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== "string" || value.length > maxLength || /\p{Cc}/u.test(value)) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
