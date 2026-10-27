import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseUptimeKumaEvent } from '@/lib/cron-heartbeat';
import { bearerMatches } from '@/lib/cron-auth';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';
import { rateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordUptimeKumaEvent } from '@/lib/uptime-kuma';

/** Kuma's default webhook, authenticated only through its additional headers.
 * Query credentials are refused; server-to-server callers need no Origin.
 * Unverifiable/test/maintenance bodies
 * remain ignored 200s; an unconfirmed database transition is a separate 503.
 * A configured receiver represents one Kuma installation for its owner.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 25;
const headers = { 'cache-control': 'private, no-store' };

export async function POST(request: Request) {
  const expected = process.env.UPTIME_KUMA_WEBHOOK_TOKEN;
  const owner = process.env.DASHBOARD_OWNER_ID;
  const unavailable = () => NextResponse.json(
    { error: 'Heartbeat recording unconfirmed.' }, { status: 503, headers },
  );
  try {
    if (!expected?.trim() || !z.uuid().safeParse(owner).success) {
      return NextResponse.json(
        { error: 'Heartbeat monitoring is not configured.' }, { status: 503, headers },
      );
    }
    if (!bearerMatches(request.headers.get('authorization'), expected)) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403, headers });
    }
    const signal = AbortSignal.any([AbortSignal.timeout(20_000), request.signal]);
    try {
      const limited = await awaitWithSignal(rateLimit(owner!, {
        key: 'uptime-kuma-webhook', limit: 60, windowSec: 60,
      }), signal);
      signal.throwIfAborted();
      if (!limited.ok) {
        return NextResponse.json({ error: 'Too many heartbeat events.' }, {
          status: 429, headers: { ...headers, 'retry-after': String(limited.retryAfter) },
        });
      }
      let body: unknown;
      try {
        body = JSON.parse(await boundedResponseText(request, 65_536, signal));
      } catch {
        if (signal.aborted) return unavailable();
        return NextResponse.json({ ok: true, ignored: 'unreadable body' }, { headers });
      }
      const event = parseUptimeKumaEvent(body);
      if (!event) {
        return NextResponse.json({ ok: true, ignored: 'unverifiable monitor event' }, { headers });
      }
      signal.throwIfAborted();
      const receipt = await recordUptimeKumaEvent(createAdminClient(signal), owner!, event, signal);
      return NextResponse.json({
        ok: true,
        monitor: event.monitor,
        state: receipt.status === 0 ? 'down' : 'up',
        outcome: receipt.outcome,
      }, { headers });
    } catch {
      return unavailable();
    }
  } finally {
    // Refusals before body admission must also release an unconsumed producer.
    if (request.body && !request.body.locked && !request.bodyUsed) {
      void request.body.cancel().catch(() => undefined);
    }
  }
}
