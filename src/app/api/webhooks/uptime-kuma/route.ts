import { NextResponse } from "next/server";
import {
  parseUptimeKumaEvent,
  type UptimeKumaPayload,
} from "@/lib/cron-heartbeat";
import { bearerMatches } from "@/lib/cron-auth";
import { logCronRun } from "@/lib/cron-log";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Inbound receiver for an Uptime Kuma webhook notification.
 *
 * Kuma watches the push URLs the crons ping (see `src/lib/heartbeat.ts`) and
 * calls this route when a monitor goes down or recovers. The alert then lands
 * in the same Inbox action centre as everything else instead of only in an
 * email the owner may not read.
 *
 *   POST /api/webhooks/uptime-kuma
 *   Authorization: Bearer <UPTIME_KUMA_WEBHOOK_TOKEN>
 *   { "heartbeat": { "status": 0|1, "time": "...", "msg": "..." },
 *     "monitor": { "id": 3, "name": "Bank sync" }, "msg": "..." }
 *
 * The body shape is Kuma's, not ours, so every field is optional here and an
 * unusable payload is answered 200 rather than retried into a storm. Auth is
 * the shared token only, in the Authorization header (Kuma's webhook
 * notification sends it through its additional-headers field): Kuma is a
 * server-to-server caller with no Origin header, exactly like the cron-log
 * endpoint, so the CSRF check would reject every legitimate call. A `?token=`
 * query form is refused, because request logs keep the query string.
 *
 * No-ops with 503 until both UPTIME_KUMA_WEBHOOK_TOKEN and DASHBOARD_OWNER_ID
 * are configured, so a deploy without a monitoring stack still boots.
 */
export const dynamic = "force-dynamic";

const DOWN_KIND = "cron_heartbeat_down";
const UP_KIND = "cron_heartbeat_up";

export async function POST(request: Request) {
  const expected = process.env.UPTIME_KUMA_WEBHOOK_TOKEN;
  const owner = process.env.DASHBOARD_OWNER_ID;
  if (!expected?.trim() || !owner) {
    return NextResponse.json(
      { error: "Heartbeat monitoring is not configured." },
      { status: 503 },
    );
  }

  if (!bearerMatches(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // One monitor flapping must not be able to fill the notification table.
  const limited = await rateLimit(owner, {
    key: "uptime-kuma-webhook",
    limit: 60,
    windowSec: 60,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many heartbeat events." },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  let body: UptimeKumaPayload;
  try {
    body = (await request.json()) as UptimeKumaPayload;
  } catch {
    return NextResponse.json({ ok: true, ignored: "unreadable body" });
  }

  const event = parseUptimeKumaEvent(body);
  if (!event) {
    return NextResponse.json({ ok: true, ignored: "no monitor in payload" });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Heartbeat monitoring is not configured." },
      { status: 503 },
    );
  }

  try {
    if (event.down) {
      // An open alert for the same monitor already says this; a second row a
      // minute later would only make the Inbox noisier.
      const { data: open } = await admin
        .from("notifications")
        .select("id")
        .eq("user_id", owner)
        .eq("kind", DOWN_KIND)
        .eq("source_id", event.monitor)
        .is("dismissed_at", null)
        .limit(1);
      if ((open ?? []).length === 0) {
        await admin.from("notifications").insert({
          user_id: owner,
          kind: DOWN_KIND,
          source_type: "cron",
          source_id: event.monitor,
          title: `${event.monitor} stopped reporting`,
          body: event.message || "Its monitor received no heartbeat in time.",
          action_url: "/projects",
        });
      }
      // Surface it in the Home cron log too, where the owner already looks for
      // a failed run.
      await logCronRun({
        name: event.monitor,
        endpoint: "uptime-kuma",
        status: "failure",
        source: "external",
        detail: event.message,
        userId: owner,
      });
      return NextResponse.json({ ok: true, monitor: event.monitor, state: "down" });
    }

    // Recovery: only worth saying when something was said before. Resolving the
    // open alert is the point; a second notification without one would be an
    // announcement that nothing happened.
    const { data: open } = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", owner)
      .eq("kind", DOWN_KIND)
      .eq("source_id", event.monitor)
      .is("dismissed_at", null)
      .limit(1);
    const openIds = (open ?? []).map((row) => row.id as string);
    if (openIds.length === 0) {
      return NextResponse.json({ ok: true, monitor: event.monitor, state: "up" });
    }
    await admin
      .from("notifications")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("user_id", owner)
      .in("id", openIds);
    await admin.from("notifications").insert({
      user_id: owner,
      kind: UP_KIND,
      source_type: "cron",
      source_id: event.monitor,
      title: `${event.monitor} is reporting again`,
      body: event.message || "Its monitor received a heartbeat.",
      action_url: "/projects",
    });
    return NextResponse.json({ ok: true, monitor: event.monitor, state: "up" });
  } catch {
    // The monitor is reporting on us; a write failure here must not make Kuma
    // retry the same event forever.
    return NextResponse.json({ ok: true, ignored: "could not record event" });
  }
}
