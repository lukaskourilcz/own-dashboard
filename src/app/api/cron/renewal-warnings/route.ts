import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";

/**
 * Runs daily (Vercel Cron, 07:00 UTC ≈ 08:00 CET / 02:00 EST). Finds active
 * subscriptions billing in 3 days or today, sends one email per (user, kind,
 * ref) per day. notification_log dedupes so retried cron invocations don't
 * spam.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` where
 * CRON_SECRET is whatever you set in the project env. Reject anything else.
 *
 * No-op gracefully when env vars are missing — letting the deploy survive
 * before Resend is configured.
 */
export async function GET(request: Request) {
  // Auth: only run when called by Vercel Cron (or with the right secret).
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({
      ok: true,
      skipped: "RESEND_API_KEY not set; no emails sent.",
    });
  }
  const fromAddress = process.env.RESEND_FROM ?? "onboarding@resend.dev";

  const resend = new Resend(resendKey);
  const admin = createAdminClient();

  // Two windows: 3 days out (heads-up) and today (final warning).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const today3 = new Date(today);
  today3.setDate(today3.getDate() + 3);
  const todayStr = today.toISOString().slice(0, 10);
  const today3Str = today3.toISOString().slice(0, 10);

  // Pull every subscription billing today OR in 3 days. Service role bypasses
  // RLS so we get all users in one query.
  const { data: subs, error: subsErr } = await admin
    .from("subscriptions")
    .select("id, user_id, name, amount, currency, next_billing_date, is_active")
    .in("next_billing_date", [todayStr, today3Str])
    .eq("is_active", true);

  if (subsErr) {
    return NextResponse.json({ error: subsErr.message }, { status: 500 });
  }
  const rows = (subs ?? []) as Array<{
    id: string;
    user_id: string;
    name: string;
    amount: number;
    currency: string;
    next_billing_date: string;
    is_active: boolean;
  }>;
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, sent: 0 });
  }

  // Look up emails for the unique user ids. auth.admin.getUserById can't
  // batch, so we fetch profiles (we upsert email there on every dashboard
  // load) and fall back to the auth.users join only if missing.
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, display_name")
    .in("id", userIds);
  const emailByUser = new Map<string, { email: string | null; name: string | null }>(
    (profiles ?? []).map((p) => [
      p.id as string,
      {
        email: (p.email as string | null) ?? null,
        name: (p.display_name as string | null) ?? null,
      },
    ]),
  );

  // Honor per-user notification preferences.
  const { data: prefs } = await admin
    .from("user_preferences")
    .select("user_id, notifications_renewals")
    .in("user_id", userIds);
  const renewalsOff = new Set<string>(
    (prefs ?? [])
      .filter((p) => p.notifications_renewals === false)
      .map((p) => p.user_id as string),
  );

  // Dedupe: load today's notification_log rows for these subs so we don't
  // double-send on cron retries within the same UTC day.
  const { data: alreadySent } = await admin
    .from("notification_log")
    .select("user_id, kind, ref_id")
    .gte("sent_on", todayStr)
    .in(
      "user_id",
      userIds,
    );
  const sentKey = new Set<string>(
    (alreadySent ?? []).map(
      (r) => `${r.user_id}|${r.kind}|${r.ref_id}`,
    ),
  );

  let sent = 0;
  for (const sub of rows) {
    if (renewalsOff.has(sub.user_id)) continue;
    const target = emailByUser.get(sub.user_id);
    if (!target?.email) continue;

    const kind =
      sub.next_billing_date === todayStr
        ? "subscription_renewal_0d"
        : "subscription_renewal_3d";

    if (sentKey.has(`${sub.user_id}|${kind}|${sub.id}`)) continue;

    const when =
      sub.next_billing_date === todayStr ? "today" : "in 3 days";
    const subject =
      sub.next_billing_date === todayStr
        ? `${sub.name} renews today`
        : `${sub.name} renews in 3 days`;
    const amount = formatCurrency(sub.amount, sub.currency);
    const name = target.name?.split(/[\s@]/)[0] ?? "there";

    try {
      await resend.emails.send({
        from: fromAddress,
        to: target.email,
        subject,
        text: `Hi ${name},\n\n${sub.name} (${amount}) renews ${when} (${sub.next_billing_date}).\n\nIf you don't want this anymore, cancel it now to avoid the charge.\n\n— Your dashboard`,
      });
      await admin.from("notification_log").insert({
        user_id: sub.user_id,
        kind,
        ref_id: sub.id,
        meta: { amount, currency: sub.currency, date: sub.next_billing_date },
      });
      sent++;
    } catch (err) {
      console.error("[cron/renewal-warnings] send failed:", err);
      // Don't mark sent on failure — next cron tick retries.
    }
  }

  return NextResponse.json({ ok: true, scanned: rows.length, sent });
}
