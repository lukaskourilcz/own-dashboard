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
export async function readVerifiedServerOwner(parent: AbortSignal): Promise<string | null> {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(10000)]);
    try {
        signal.throwIfAborted();
        const session = await awaitWithSignal(createClient(signal), signal);
        const { data, error } = await awaitWithSignal(session.auth.getUser(), signal);
        signal.throwIfAborted();
        if (error) {
            if ([400, 401, 403].includes(error.status ?? 0))
                return null;
            throw new ServerOwnerUnavailableError();
        }
        if (!data.user)
            return null;
        return z.uuid().parse(data.user.id);
    }
    catch {
        if (parent.aborted)
            throw new DOMException('Request aborted', 'AbortError');
        throw new ServerOwnerUnavailableError();
    }
}
