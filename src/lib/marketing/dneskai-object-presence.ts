import 'server-only';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import type { createAdminClient } from '@/lib/supabase/admin';
/** A typed Storage refusal is only a probe candidate. Confirm the exact owned private path before new rendering. */
export async function readDneskaiCacheObjectPresence(db: ReturnType<typeof createAdminClient>, ownerId: string, kind: 'slide' | 'reel', key: string, parent?: AbortSignal): Promise<'present' | 'absent'> {
    const signal = AbortSignal.any([AbortSignal.timeout(15000), ...(parent ? [parent] : [])]);
    try {
        z.uuid().parse(ownerId);
        z.enum(['slide', 'reel']).parse(kind);
        z.string().regex(/^[a-f0-9]{64}$/).parse(key);
        signal.throwIfAborted();
        const { data, error } = await awaitWithSignal(db.rpc('read_owned_dneskai_cache_object', { p_owner: ownerId, p_kind: kind, p_key: key }).retry(false).abortSignal(signal), signal);
        signal.throwIfAborted();
        if (error)
            throw new Error();
        return z.strictObject({ ownerId: z.literal(ownerId), kind: z.literal(kind), key: z.literal(key), state: z.enum(['present', 'absent']) }).parse(data).state;
    }
    catch {
        if (parent?.aborted)
            throw new DOMException('Request aborted', 'AbortError');
        throw new Error('Cache object unavailable');
    }
}
