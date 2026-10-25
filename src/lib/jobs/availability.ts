import { awaitWithSignal } from "@/lib/abortable";
import type { JobListing } from "@/lib/types";

export type Availability = "open" | "closed" | "unknown";
const LISTING_TIMEOUT_MS = 15_000;
const HOSTS = [
  "thehub.io", "finn.no", "arbeidsplassen.nav.no",
  "careers.sixrobotics.com", "careers.attensi.com", "careers.monil.com",
  "careers.aize.io", "careers.spond.com", "careers.noisolation.com",
  "aidn.teamtailor.com", "flowcase.teamtailor.com", "sanity.io", "jobs.dnv.com",
  "careers.falkor.com", "job-boards.eu.greenhouse.io",
  "startupjobs.cz",
  "jobs.cz",
  "prace.cz",
  "remoteok.com",
  "remotive.com",
  "arbeitnow.com",
  "jobicy.com",
  "weworkremotely.com",
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.eu.lever.co",
  "jobs.ashbyhq.com",
  "linkedin.com",
  "cz.linkedin.com",
  "popronsystems.cz",
];

/** Only known public job hosts; no credentials, custom ports or redirects to arbitrary hosts. */
export function isJobUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      HOSTS.some((h) => u.hostname === h || u.hostname === `www.${h}`)
    );
  } catch {
    return false;
  }
}

const normalizedTitle = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
function expiryInstant(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const datePart = value.slice(0, 10), start = Date.parse(datePart);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || !Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== datePart) return null;
  if (value === datePart) {
    // A date without a zone must not expire at server midnight. Wait until
    // that date has ended even in UTC-12; it supplies no precise instant.
    return start + 36 * 60 * 60 * 1000;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}
function structuredJobEvidence(html: string, title: string, listingUrl?: string) {
  const expiries = new Set<number | null>();
  let visited = 0, scripts = 0, malformedExpiry = false;
  const incomplete = () => ({ matched: false, ambiguous: true, expiry: null });
  if (!listingUrl || !isJobUrl(listingUrl)) return { matched: false, ambiguous: false, expiry: null };
  const registered = new URL(listingUrl); registered.hash = "";
  for (const match of html.matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (++scripts > 40) return incomplete();
    let parsed: unknown;
    try { parsed = JSON.parse(match[1]); } catch { continue; }
    const queue: unknown[] = [parsed];
    while (queue.length) {
      if (++visited > 500) return incomplete();
      const node = queue.pop();
      if (Array.isArray(node)) {
        if (node.length + queue.length + visited > 500) return incomplete();
        queue.push(...node); continue;
      }
      if (!node || typeof node !== "object") continue;
      const row = node as Record<string, unknown>;
      if (row["@graph"] !== undefined) queue.push(row["@graph"]);
      const types = Array.isArray(row["@type"]) ? row["@type"] : [row["@type"]];
      if (!types.some(type => type === "JobPosting" || type === "https://schema.org/JobPosting" || type === "http://schema.org/JobPosting")
        || typeof row.title !== "string" || normalizedTitle(row.title) !== normalizedTitle(title) || typeof row.url !== "string") continue;
      let url: URL;
      try { url = new URL(row.url, listingUrl); } catch { continue; }
      url.hash = "";
      if (!isJobUrl(url.href) || url.href !== registered.href) continue;
      const expiry = expiryInstant(row.validThrough);
      if (row.validThrough !== undefined && expiry === null) malformedExpiry = true;
      expiries.add(expiry);
    }
  }
  return { matched: expiries.size > 0, ambiguous: malformedExpiry || expiries.size > 1, expiry: expiries.size === 1 ? [...expiries][0] : null };
}

export function pageAvailability(
  status: number,
  html: string,
  title: string,
  now = Date.now(),
  listingUrl?: string,
): Availability {
  if (status === 404 || status === 410) return "closed";
  if (status !== 200) return "unknown";
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  if (!Number.isFinite(now) || /captcha|verify you are human|access denied|just a moment/i.test(text)) return "unknown";
  const structured = structuredJobEvidence(html, title, listingUrl);
  if (structured.ambiguous) return "unknown";
  if (structured.expiry !== null && structured.expiry < now) return "closed";
  const words = title.toLowerCase().match(/[a-zá-ž0-9]{3,}/g) ?? [];
  const matchesTitle =
    words.length > 0 &&
    words.filter((w) => text.toLowerCase().includes(w)).length / words.length >=
      0.8;
  const applicationSignal =
    /apply (?:now|for|to|here)|submit (?:your )?application|odpovědět|mám zájem|reagovat na|přihlásit se|zažádat|podat žádost|zaujala vás tato nabídka|ozvěte se(?: nám)?/i.test(
      text,
    );
  const closureSignal = /no longer accepting applications|position (?:has been |is )?(?:filled|closed)|job (?:is |has )?(?:expired|closed)|this (?:job|position|vacancy) is no longer|nabídka (?:již )?není aktivní|pozice (?:je|byla) (?:již )?obsazena|inzerát (?:již )?není aktuální/i.test(text);
  // Mixed apply/closed copy can describe recommendations or stale controls.
  if (closureSignal) return matchesTitle && !applicationSignal ? "closed" : "unknown";
  return matchesTitle && (applicationSignal || structured.matched) ? "open" : "unknown";
}

async function checkListing(job: JobListing, parent?: AbortSignal): Promise<Availability> {
  const signal = AbortSignal.any([AbortSignal.timeout(LISTING_TIMEOUT_MS), ...(parent ? [parent] : [])]);
  let url = job.url;
  try {
    for (let redirects = 0; redirects < 4; redirects++) {
      if (!isJobUrl(url)) return "unknown";
      signal.throwIfAborted();
      const pending = fetch(url, {
        redirect: "manual",
        cache: "no-store",
        signal,
        headers: {
          accept: "text/html",
          "user-agent": "OwnDashboard Career availability check",
        },
      });
      // An injected or stalled transport may settle after cancellation. Observe
      // it and release its late response without holding the caller open.
      void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => undefined); }).catch(() => undefined);
      const response = await awaitWithSignal(pending, signal);
      signal.throwIfAborted();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        void response.body?.cancel().catch(() => undefined);
        if (!location) return "unknown";
        url = new URL(location, url).href;
        continue;
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        return pageAvailability(response.status, "", job.title);
      }
      // Bound downloaded bytes as well as wall time; job pages are untrusted input.
      const reader = response.body?.getReader();
      if (!reader) return "unknown";
      let html = "";
      let bytes = 0;
      const decoder = new TextDecoder();
      const cancel = () => { void reader.cancel().catch(() => undefined); };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        signal.throwIfAborted();
        while (true) {
          const part = await awaitWithSignal(reader.read(), signal);
          signal.throwIfAborted();
          if (part.done) { html += decoder.decode(); break; }
          bytes += part.value.byteLength;
          if (bytes > 1_500_000) return "unknown";
          html += decoder.decode(part.value, { stream: true });
        }
      } finally {
        signal.removeEventListener("abort", cancel);
        cancel();
        reader.releaseLock();
      }
      return pageAvailability(response.status, html, job.title, Date.now(), job.url);
    }
  } catch {
    /* An outage is not evidence of closure. */
  }
  return "unknown";
}

export async function verifyListings(
  listings: JobListing[],
  probe: (job: JobListing, signal?: AbortSignal) => Promise<Availability> = checkListing,
  parent?: AbortSignal,
) {
  const results: Record<string, Availability> = {};
  const signal = AbortSignal.any([AbortSignal.timeout(22_000), ...(parent ? [parent] : [])]);
  const candidates = listings.slice(0, 100);
  for (let i = 0; i < candidates.length; i += 15) {
    if (signal.aborted) break;
    const batch = candidates.slice(i, i + 15);
    const states = await Promise.all(
      batch.map((job) => awaitWithSignal(Promise.resolve().then(() => { signal.throwIfAborted(); return probe(job, signal); }), signal).catch(() => "unknown" as const)),
    );
    batch.forEach((j, n) => {
      results[j.id] = states[n];
    });
  }
  return results;
}
