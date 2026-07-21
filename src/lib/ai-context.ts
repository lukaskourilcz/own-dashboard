type SerializeAiContextOptions = {
  maxLongTextChars?: number;
  maxStringChars?: number;
};

/**
 * Serialize model context while keeping identifiers and short metadata intact.
 * Long free-text fields share a fixed budget so one large note, listing, or
 * scraped page cannot silently expand a request beyond the documented bound.
 */
export function serializeAiContext(
  value: unknown,
  options: SerializeAiContextOptions = {},
): string {
  let remaining = options.maxLongTextChars ?? 100_000;
  const perString = options.maxStringChars ?? 4_000;

  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== "string" || item.length <= 500) return item;
    if (remaining <= 0) return "[content omitted: context limit reached]";

    const available = Math.min(perString, remaining);
    const suffix = item.length > available ? " …[truncated]" : "";
    if (available <= suffix.length) {
      remaining = 0;
      return "[content omitted: context limit reached]";
    }
    const body = item.slice(0, Math.max(0, available - suffix.length));
    remaining -= body.length + suffix.length;
    return `${body}${suffix}`;
  });
}
