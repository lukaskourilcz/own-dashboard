import type { JobListing } from "@/lib/types";

export type Availability = "open" | "closed" | "unknown";
const HOSTS = [
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

export async function checkListing(job: JobListing): Promise<Availability> {
  let url = job.url;
  try {
    for (let redirects = 0; redirects < 4; redirects++) {
      if (!isJobUrl(url)) return "unknown";
      const response = await fetch(url, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(4500),
        headers: {
          accept: "text/html",
          "user-agent": "OwnDashboard Career availability check",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) return "unknown";
        url = new URL(location, url).href;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        return pageAvailability(response.status, "", job.title);
      }
      // Bound downloaded bytes as well as wall time; job pages are untrusted input.
      const reader = response.body?.getReader();
      if (!reader) return "unknown";
      let html = "";
      let bytes = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 1_500_000) return "unknown";
          html += decoder.decode(part.value, { stream: true });
        }
      } finally {
        await reader.cancel();
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
  probe = checkListing,
) {
  const results: Record<string, Availability> = {};
  const start = Date.now();
  for (let i = 0; i < Math.min(listings.length, 100); i += 15) {
    if (Date.now() - start > 22000) break;
    const batch = listings.slice(i, i + 15);
    const states = await Promise.all(
      batch.map((j) => probe(j).catch(() => "unknown" as const)),
    );
    batch.forEach((j, n) => {
      results[j.id] = states[n];
    });
  }
  return results;
}
