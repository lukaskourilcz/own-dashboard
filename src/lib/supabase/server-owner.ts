import 'server-only';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { createClient } from './server';
export class ServerOwnerUnavailableError extends Error {
    constructor() {
        super('Owner session unavailable');
        this.name = 'ServerOwnerUnavailableError';
    }
}
/** One verified server identity; a cached user accompanying an auth error never authorizes work. */
export async function readVerifiedServerContext(parent: AbortSignal): Promise<{ownerId:string;db:Awaited<ReturnType<typeof createClient>>} | null> {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(10000)]);
    const transport = new AbortController();
    const original = AbortSignal.any([parent, transport.signal]);
    try {
        signal.throwIfAborted();
        // Failed auth retires its transport. Once verified, later queries keep
        // the original request lifetime rather than the completed auth phase.
        const session = await awaitWithSignal(createClient(original), signal);
        signal.throwIfAborted();
        const { data, error } = await awaitWithSignal(session.auth.getUser(), signal);
        signal.throwIfAborted();
        if (error) {
            if ([400, 401, 403].includes(error.status ?? 0)) {
                transport.abort();
                return null;
            }
            throw new ServerOwnerUnavailableError();
        }
        if (!data.user) {
            transport.abort();
            return null;
        }
        return {ownerId:z.uuid().parse(data.user.id),db:session};
    }
    catch {
        transport.abort();
        if (parent.aborted)
            throw new DOMException('Request aborted', 'AbortError');
        throw new ServerOwnerUnavailableError();
    }
}

/** Reuse the same verified session boundary when only its owner id is needed. */
export async function readVerifiedServerOwner(parent: AbortSignal): Promise<string | null> {
    return (await readVerifiedServerContext(parent))?.ownerId ?? null;
}
