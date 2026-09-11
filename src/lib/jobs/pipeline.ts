export function isGoogleLetterUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
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

/** New progress events carry structured details; legacy notes stay readable. */
export function progressEventLabel(detail: string | null, cs: boolean): string {
  if (!detail) return "";
  try {
    const value: unknown = JSON.parse(detail);
    if (!value || typeof value !== "object" || Array.isArray(value)) return detail;
    const event = value as Record<string, unknown>;
    const kinds: Record<string, string> = cs
      ? { positive: "Kladná odpověď", negative: "Záporná odpověď", neutral: "Jiná odpověď" }
      : { positive: "Positive reply", negative: "Negative reply", neutral: "Other reply" };
    const parts = [typeof event.response_kind === "string" ? kinds[event.response_kind] : null,
      typeof event.responded_on === "string" ? event.responded_on : null,
      typeof event.follow_up_at === "string" ? `${cs ? "Další kontakt" : "Follow-up"}: ${event.follow_up_at.slice(0, 10)}` : null,
      typeof event.notes === "string" ? event.notes : null].filter(Boolean);
    return parts.join(" · ") || (cs ? "Údaje o průběhu aktualizovány" : "Progress details updated");
  } catch { return detail; }
}
