import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import type { UptimeKumaEvent } from '@/lib/cron-heartbeat';

const receiptSchema = z.object({
  ownerId: z.uuid(),
  monitorId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  observedAt: z.iso.datetime({ offset: true }),
  status: z.union([z.literal(0), z.literal(1)]),
  outcome: z.enum(['recorded', 'unchanged', 'stale']),
}).strict();

/** One service-only transaction; never retry an uncertain transport outcome. */
export async function recordUptimeKumaEvent(
  client: SupabaseClient,
  ownerId: string,
  input: UptimeKumaEvent,
  signal: AbortSignal,
) {
  const event = {
    monitorId: input.monitorId,
    monitor: input.monitor,
    observedAt: input.observedAt,
    down: input.down,
  };
  signal.throwIfAborted();
  if (
    !z.uuid().safeParse(ownerId).success ||
    !Number.isSafeInteger(event.monitorId) || event.monitorId < 1 ||
    !event.monitor.trim() || event.monitor.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(event.monitor) ||
    typeof event.down !== 'boolean' ||
    !z.iso.datetime().safeParse(event.observedAt).success
  ) throw new Error('Heartbeat recording unconfirmed');

  const reply = await awaitWithSignal(client.rpc('record_uptime_kuma_event', {
    p_owner: ownerId,
    p_monitor_id: event.monitorId,
    p_name: event.monitor,
    p_observed_at: event.observedAt,
    p_status: event.down ? 0 : 1,
  }).retry(false).abortSignal(signal), signal);
  signal.throwIfAborted();
  const parsed = receiptSchema.safeParse(reply.data);
  if (reply.error || !parsed.success) throw new Error('Heartbeat recording unconfirmed');

  const receipt = parsed.data;
  const observed = Date.parse(receipt.observedAt), expected = Date.parse(event.observedAt);
  const status = event.down ? 0 : 1;
  if (
    receipt.ownerId !== ownerId || receipt.monitorId !== event.monitorId ||
    (receipt.outcome === 'stale'
      ? observed < expected
      : observed !== expected || receipt.status !== status)
  ) throw new Error('Heartbeat recording unconfirmed');
  return receipt;
}
