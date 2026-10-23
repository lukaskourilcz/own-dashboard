/** Read only a bounded UTF-8 text prefix and cancel the remaining download.
 * The flag lets structured-document callers refuse partial JSON/metadata.
 */
export async function readTextPrefix(response: Response, maxCharacters: number): Promise<{ text: string; truncated: boolean }> {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new Error("Invalid text bound");
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        text += decoder.decode();
        return { text: text.slice(0, maxCharacters), truncated: text.length > maxCharacters };
      }
      // Four bytes per UTF-8 scalar plus a partial scalar from the last chunk.
      const byteBound = (maxCharacters - text.length + 1) * 4 + 4;
      text += decoder.decode(chunk.value.subarray(0, byteBound), { stream: true });
      if (text.length > maxCharacters || chunk.value.length > byteBound) {
        await reader.cancel();
        return { text: text.slice(0, maxCharacters), truncated: true };
      }
    }
  } finally { reader.releaseLock(); }
}
