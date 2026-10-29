import { safeWebUrl } from "@/lib/web-url";

export function isGoogleLetterUrl(value: string): boolean {
  if (value === "") return true;
  const safe = safeWebUrl(value);
  if (!safe) return false;
  try {
    const url = new URL(safe);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ((url.hostname === "docs.google.com" && /^\/document\/d\/[\w-]+(?:\/|$)/.test(url.pathname)) ||
       (url.hostname === "drive.google.com" && /^\/file\/d\/[\w-]+(?:\/|$)/.test(url.pathname)));
  } catch { return false; }
}

export function readinessLabel(value: string | undefined, cs: boolean): string {
  if (value === "ready") return cs ? "Připraveno" : "Ready";
  if (value === "needs_review") return cs ? "Nejdřív zkontrolovat" : "Review first";
  return cs ? "Rozpracováno" : "Draft";
}

/** Text-only prepared drafts are just as usable as linked Google Docs. */
export function isPositionReady(position: { readiness?: string; cover_letter_url?: string | null }): boolean {
  return position.readiness === "ready" || (position.readiness !== "needs_review" && typeof position.cover_letter_url === "string" && !!position.cover_letter_url && isGoogleLetterUrl(position.cover_letter_url));
}

const responseKinds: Record<"cs" | "en", Readonly<Record<string, string>>> = {
  cs: { positive: "Kladná odpověď", negative: "Záporná odpověď", neutral: "Jiná odpověď" },
  en: { positive: "Positive reply", negative: "Negative reply", neutral: "Other reply" },
};

/** New progress events carry structured details; legacy notes stay readable. */
export function progressEventLabel(detail: string | null, cs: boolean): string {
  if (!detail) return "";
  try {
    const value: unknown = JSON.parse(detail);
    if (!value || typeof value !== "object" || Array.isArray(value)) return detail;
    const event = value as Record<string, unknown>;
    const kinds = responseKinds[cs ? "cs" : "en"];
    const parts = [typeof event.response_kind === "string" && Object.hasOwn(kinds,event.response_kind) ? kinds[event.response_kind] : null,
      typeof event.responded_on === "string" ? event.responded_on : null,
      typeof event.follow_up_at === "string" ? `${cs ? "Další kontakt" : "Follow-up"}: ${event.follow_up_at.slice(0, 10)}` : null,
      typeof event.notes === "string" ? event.notes : null].filter(Boolean);
    return parts.join(" · ") || (cs ? "Údaje o průběhu aktualizovány" : "Progress details updated");
  } catch { return detail; }
}
