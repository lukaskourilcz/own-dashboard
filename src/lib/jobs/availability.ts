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

export function pageAvailability(
  status: number,
  html: string,
  title: string,
  now = Date.now(),
): Availability {
  if (status === 404 || status === 410) return "closed";
  if (status !== 200) return "unknown";
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  if (
    /no longer accepting applications|position (?:has been |is )?(?:filled|closed)|job (?:is |has )?(?:expired|closed)|this (?:job|position|vacancy) is no longer|nabídka (?:již )?není aktivní|pozice (?:je|byla) (?:již )?obsazena|inzerát (?:již )?není aktuální/i.test(
      text,
    )
  )
    return "closed";
  for (const match of html.matchAll(/"validThrough"\s*:\s*"([^"]+)"/g)) {
    const expiry = Date.parse(match[1]);
    if (Number.isFinite(expiry) && expiry < now) return "closed";
  }
  if (/captcha|verify you are human|access denied|just a moment/i.test(text))
    return "unknown";
  const words = title.toLowerCase().match(/[a-zá-ž0-9]{3,}/g) ?? [];
  const matchesTitle =
    words.length > 0 &&
    words.filter((w) => text.toLowerCase().includes(w)).length / words.length >=
      0.8;
  const applicationSignal =
    /"@type"\s*:\s*"JobPosting"|apply (?:now|for|to|here)|submit (?:your )?application|odpovědět|mám zájem|reagovat na|přihlásit se|zažádat|podat žádost|zaujala vás tato nabídka|ozvěte se(?: nám)?/i.test(
      html,
    );
  return matchesTitle && applicationSignal ? "open" : "unknown";
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
      return pageAvailability(response.status, html, job.title);
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
