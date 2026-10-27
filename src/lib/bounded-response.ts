import { awaitWithSignal } from "@/lib/abortable";
export class BoundedStreamError extends Error {
    constructor(readonly reason: 'size' | 'unavailable' = 'unavailable') {
        super('Stream unavailable');
        this.name = 'BoundedStreamError';
    }
}
/** Owned byte snapshot under one caller lifetime. Empty chunks count toward the allocation/work bound. */
export async function boundedStreamBytes(stream: ReadableStream<Uint8Array>, maximum: number, signal: AbortSignal, minimum = 0): Promise<Uint8Array> {
    const discard = () => {
        if (!stream.locked)
            void stream.cancel().catch(() => undefined);
    };
    if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(minimum) || minimum < 0 || minimum > maximum || stream.locked) {
        discard();
        throw new BoundedStreamError();
    }
    if (signal.aborted) {
        discard();
        throw new DOMException('Request aborted', 'AbortError');
    }
    const reader = stream.getReader(), chunks: Uint8Array[] = [];
    let size = 0, count = 0, complete = false;
    try {
        for (;;) {
            const part = await awaitWithSignal(reader.read(), signal);
            signal.throwIfAborted();
            if (part.done)
                break;
            if (!(part.value instanceof Uint8Array) || ++count > 65536)
                throw new BoundedStreamError();
            size += part.value.byteLength;
            if (size > maximum)
                throw new BoundedStreamError('size');
            if (part.value.byteLength)
                chunks.push(new Uint8Array(part.value));
        }
        if (size < minimum)
            throw new BoundedStreamError('size');
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        signal.throwIfAborted();
        complete = true;
        return bytes;
    }
    catch (error) {
        if (signal.aborted)
            throw new DOMException('Request aborted', 'AbortError');
        throw error instanceof BoundedStreamError ? error : new BoundedStreamError();
    }
    finally {
        if (!complete)
            void reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
/** Complete UTF-8 response text under the caller's deadline and a byte cap.
 * Refused bodies are discarded without awaiting an uncooperative producer. */
export async function boundedResponseText(response: Pick<Response, "body" | "bodyUsed" | "headers">, maximum: number, signal: AbortSignal): Promise<string> {
    const discard = () => {
        if (response.body && !response.body.locked)
            void response.body.cancel().catch(() => undefined);
    };
    if (!Number.isSafeInteger(maximum) || maximum < 1 || signal.aborted) {
        discard();
        throw new Error('Response unavailable');
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
        discard();
        throw new Error('Response unavailable');
    }
    if (response.bodyUsed || response.body?.locked || !response.body) {
        discard();
        throw new Error('Response unavailable');
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(await boundedStreamBytes(response.body, maximum, signal));
    }
    catch {
        if (signal.aborted)
            throw new DOMException('Response aborted', 'AbortError');
        throw new Error('Response unavailable');
    }
}
