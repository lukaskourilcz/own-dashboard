import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectUnlessCron } from "@/lib/cron-auth";
import { logCronRun } from "@/lib/cron-log";
import { heartbeatUrlForJob, pingHeartbeat } from "@/lib/heartbeat";
import { createAdminClient } from "@/lib/supabase/admin";
import { focusDayKey } from "@/lib/date-keys";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { awaitWithSignal } from "@/lib/abortable";
import { renewalEmail, renewalEventIdentity, sendRenewalEmail } from "@/lib/renewal-email";

/** Existing 07:00 UTC maintenance job. Dates use the owner's saved timezone,
 * defaulting to Prague; no billing provider is queried or renewal inferred.
 * Missing email configuration stays disabled. No new email rollout. */
export const maxDuration = 60;
const headers = { "cache-control": "private, no-store" };
const subscription = z.object({
  id: z.uuid(), user_id: z.uuid(), name: z.string().min(1).max(200),
  amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/)]).transform(Number).pipe(z.number().finite().nonnegative()),
  currency: z.enum(SUPPORTED_CURRENCIES), next_billing_date: z.iso.date(), is_active: z.literal(true),
  amount_confirmed_on: z.iso.date().nullable(), started_on: z.iso.date().nullable(), ended_on: z.iso.date().nullable(),
});

export async function GET(request: Request) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const credential = process.env.RESEND_API_KEY;
  if (!credential) return NextResponse.json({ ok: true, skipped: "Email delivery is not configured." }, { headers });
  const owner = process.env.DASHBOARD_OWNER_ID;
  if (!z.uuid().safeParse(owner).success) return NextResponse.json({ error: "Renewal notifications unavailable." }, { status: 503, headers });
  const signal = AbortSignal.any([AbortSignal.timeout(40_000), request.signal]);
  try {
    const admin = createAdminClient(signal);
    const prefs = await awaitWithSignal(admin.from("user_preferences").select("user_id,notifications_renewals,language,timezone").eq("user_id", owner!).abortSignal(signal).maybeSingle(), signal);
    if (prefs.error || (prefs.data && prefs.data.user_id !== owner)) throw Error("Preferences unavailable");
    const preference = z.object({ notifications_renewals: z.boolean().nullish(), language: z.enum(["en", "cs"]).nullish(), timezone: z.string().max(100).nullish() }).parse(prefs.data ?? {});
    if (preference.notifications_renewals === false) return NextResponse.json({ ok: true, scanned: 0, sent: 0, skipped: "Renewal notifications are disabled." }, { headers });
    const timeZone = preference.timezone ?? "Europe/Prague";
    new Intl.DateTimeFormat("en", { timeZone }).format();
    const today = focusDayKey(new Date(), timeZone);
    const inThreeDays = new Date(Date.parse(`${today}T12:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
    const result = await awaitWithSignal(admin.from("subscriptions")
      .select("id,user_id,name,amount,currency,next_billing_date,is_active,amount_confirmed_on,started_on,ended_on", { count: "exact" })
      .eq("user_id", owner!).in("next_billing_date", [today, inThreeDays]).eq("is_active", true).limit(101).abortSignal(signal), signal);
    const rows = z.array(subscription).max(100).parse(result.data);
    if (result.error || result.count !== rows.length || new Set(rows.map(row => row.id)).size !== rows.length
      || rows.some(row => row.user_id !== owner || ![today, inThreeDays].includes(row.next_billing_date))) throw Error("Subscriptions unavailable");
    let sent = 0, failed = 0, skipped = 0;
    if (rows.length) {
      const [profile, prior] = await awaitWithSignal(Promise.all([
        admin.from("profiles").select("id,email").eq("id", owner!).abortSignal(signal).maybeSingle(),
        admin.from("notification_log").select("user_id,kind,ref_id", { count: "exact" }).eq("user_id", owner!).eq("sent_on", today)
          .in("ref_id", rows.map(row => row.id)).limit(501).abortSignal(signal),
      ]), signal);
      if (profile.error || prior.error || !profile.data || profile.data.id !== owner || !Array.isArray(prior.data)
        || prior.data.length > 500 || prior.count !== prior.data.length || prior.data.some(row => row.user_id !== owner)) throw Error("Delivery context unavailable");
      const recipient = z.email().parse(profile.data.email);
      const alreadySent = new Set(prior.data.map(row => `${row.kind}|${row.ref_id}`));
      for (let index = 0; index < rows.length; index++) {
        if (signal.aborted) { failed += rows.length - index; break; }
        const row = rows[index], dueToday = row.next_billing_date === today;
        if ((row.started_on && row.started_on > today) || (row.ended_on && row.ended_on < today)) { skipped++; continue; }
        const kind = dueToday ? "subscription_renewal_0d" : "subscription_renewal_3d";
        if (alreadySent.has(`${kind}|${row.id}`)) { skipped++; continue; }
        const identity = renewalEventIdentity(owner!, row.id, kind, row.next_billing_date);
        try {
          const mail = renewalEmail({ name: row.name, amount: row.amount, currency: row.currency, date: row.next_billing_date, today: dueToday,
            confirmed: Boolean(row.amount_confirmed_on), lang: preference.language ?? "cs" });
          const messageId = await awaitWithSignal(sendRenewalEmail({ from: process.env.RESEND_FROM ?? "onboarding@resend.dev", to: recipient, ...mail }, identity.key, credential, signal), signal);
          const payload = { id: identity.id, user_id: owner!, kind, ref_id: row.id, sent_on: today,
            meta: { amount: row.amount, currency: row.currency, date: row.next_billing_date, provider_message_id: messageId } };
          // Concurrent successful sends share the provider key and one local id.
          const saved = await awaitWithSignal(admin.from("notification_log").upsert(payload, { onConflict: "id", ignoreDuplicates: true })
            .select("id,user_id,kind,ref_id,sent_on").abortSignal(signal).maybeSingle(), signal);
          if (saved.error) throw Error("Sent log unconfirmed");
          const receipt = saved.data ? saved : await awaitWithSignal(admin.from("notification_log").select("id,user_id,kind,ref_id,sent_on").eq("id", identity.id).eq("user_id", owner!).abortSignal(signal).maybeSingle(), signal);
          const recorded = receipt.data;
          if (receipt.error || !recorded || (["id", "user_id", "kind", "ref_id", "sent_on"] as const).some(key => recorded[key] !== payload[key])) throw Error("Sent log unconfirmed");
          sent++;
        } catch { failed++; }
      }
    }
    if (!signal.aborted) {
      await logCronRun({ name: "Renewal warnings", endpoint: "/api/cron/renewal-warnings", source: "vercel", status: failed ? "failure" : "success",
        detail: `scanned ${rows.length}, sent ${sent}, skipped ${skipped}, failed ${failed}` }, signal);
      if (!failed) await pingHeartbeat(heartbeatUrlForJob("renewal-warnings"), signal);
    }
    return NextResponse.json({ ok: failed === 0, scanned: rows.length, sent, skipped, failed }, { status: failed ? 502 : 200, headers });
  } catch {
    return NextResponse.json({ error: "Renewal notifications could not be confirmed." }, { status: 503, headers });
  }
}
