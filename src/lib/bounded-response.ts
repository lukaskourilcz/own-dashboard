import { awaitWithSignal } from "@/lib/abortable";

/** Complete UTF-8 response text under the caller's deadline and a byte cap.
 * Refused bodies are discarded without awaiting an uncooperative producer. */
export async function boundedResponseText(response: Response, maximum: number, signal: AbortSignal): Promise<string> {
  const discard = () => { if (response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); };
  if (!Number.isSafeInteger(maximum) || maximum < 1 || signal.aborted) { discard(); throw new Error("Response unavailable"); }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) { discard(); throw new Error("Response unavailable"); }
  if (response.bodyUsed || response.body?.locked) { discard(); throw new Error("Response unavailable"); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response unavailable");
  const chunks: Uint8Array[] = []; let size = 0, complete = false;
  try {
    for (;;) {
      const part = await awaitWithSignal(reader.read(), signal); signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) throw new Error("Response unavailable");
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); complete = true; return text;
  } catch {
    if (signal.aborted) throw new DOMException("Response aborted", "AbortError");
    throw new Error("Response unavailable");
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
