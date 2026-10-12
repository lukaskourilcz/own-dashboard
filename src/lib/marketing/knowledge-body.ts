/** Bound UTF-8 bytes while reading, before allocating an untrusted export body. */
export async function readKnowledgeBody(request: Request, limit = 1_100_000): Promise<string> {
  const claimed = request.headers.get("content-length");
  if (claimed && Number(claimed) > limit) throw new Error("capture-too-large");
  const reader = request.body?.getReader(); if (!reader) return "";
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("capture-too-large"); }
    parts.push(next.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
