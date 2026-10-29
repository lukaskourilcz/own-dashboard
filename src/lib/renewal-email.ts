import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { brandConfig } from "@/lib/brand";
import { formatCurrency } from "@/lib/utils";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";

export function renewalEmail(input: { name: string; amount: number; currency: string; date: string; today: boolean; confirmed: boolean; lang: "en" | "cs" }) {
  const name = input.name.replace(/[\r\n\t]/g, " "), amount = formatCurrency(input.amount, input.currency);
  const when = input.lang === "cs" ? input.today ? "dnes" : "za 3 dny" : input.today ? "today" : "in 3 days";
  return input.lang === "cs" ? {
    subject: `${name}: obnova ${when}`,
    text: `Dobrý den,\n\n${name} má zadané datum obnovy ${when} (${input.date}). Evidovaná částka: ${amount}${input.confirmed ? "." : " (neověřeno podle faktury)."}\n\nPokud chcete předplatné změnit, zkontrolujte jeho nastavení u poskytovatele.\n\n— ${brandConfig.name}`,
  } : {
    subject: `${name}: renewal ${when}`,
    text: `Hello,\n\n${name} has a recorded renewal date ${when} (${input.date}). Recorded amount: ${amount}${input.confirmed ? "." : " (not checked against an invoice)."}\n\nTo change this subscription, check its settings with the provider.\n\n— ${brandConfig.name}`,
  };
}

/** Stable event identity for concurrent/daily retries, not a secret. Resend's
 * provider deduplication lasts 24 hours; the local sent log is separate. */
export function renewalEventIdentity(owner: string, subscription: string, kind: string, date: string) {
  const hash = createHash("sha256").update(JSON.stringify([owner, subscription, kind, date])).digest("hex");
  return { key: `renewal/${hash}`, id: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}` };
}

/** Fixed provider origin and metadata-only receipt; never echo its body/key. */
export async function sendRenewalEmail(payload: { from: string; to: string; subject: string; text: string }, key: string, credential: string, parent: AbortSignal): Promise<string> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(10_000)]); signal.throwIfAborted();
  const response = await awaitWithSignal(fetch("https://api.resend.com/emails", {
    method: "POST", redirect: "error", cache: "no-store", signal,
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(payload),
  }), signal);
  if (!response.ok) { if (response.body) void response.body.cancel().catch(() => undefined); throw Error("Renewal delivery unconfirmed"); }
  const prefix = await awaitWithSignal(readTextPrefix(response, 16_384), signal);
  if (prefix.truncated) throw Error("Renewal delivery unconfirmed");
  return z.object({ id: z.uuid() }).parse(JSON.parse(prefix.text)).id;
}
