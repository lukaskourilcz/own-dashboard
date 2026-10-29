import 'server-only';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import type { createAdminClient } from '@/lib/supabase/admin';
import { confirmMarketingAccountControl, MarketingAccountControlSchema, MarketingAccountSwitchSchema, type MarketingAccountControl, type MarketingAccountSwitch } from './account-control-contracts';
/** A single observed transaction; lost acknowledgements never trigger an automatic replay. */
export async function applyMarketingAccountControl(db: ReturnType<typeof createAdminClient>, ownerId: string, input: MarketingAccountControl, kind: MarketingAccountSwitch, parent?: AbortSignal) {
    const signal = AbortSignal.any([AbortSignal.timeout(15000), ...(parent ? [parent] : [])]);
    try {
        const owner = z.uuid().parse(ownerId), intent = MarketingAccountControlSchema.parse(input), control = MarketingAccountSwitchSchema.parse(kind);
        if (intent.ownerId !== owner)
            throw new Error();
        signal.throwIfAborted();
        const result = await awaitWithSignal(db.rpc('toggle_owned_marketing_account', { p_owner: owner, p_id: intent.accountId, p_expected_at: intent.expectedVersion, p_switch: control, p_enabled: intent.enabled }).retry(false).abortSignal(signal), signal);
        signal.throwIfAborted();
        if (result.error)
            throw new Error();
        return confirmMarketingAccountControl(result.data, intent, control);
    }
    catch {
        if (parent?.aborted)
            throw new DOMException('Request aborted', 'AbortError');
        throw new Error('Account control unavailable');
    }
}
