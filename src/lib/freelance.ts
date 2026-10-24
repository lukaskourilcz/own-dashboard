import type { ClientOpportunity } from "@/lib/types";
import { safeWebUrl } from "@/lib/web-url";

export type FreelancePlatform = {
  id: string; user_id: string; name: string; url: string; search_url: string;
  registration_url: string | null; profile_url: string | null;
  resources_url?: string | null;
  kind: "marketplace" | "services" | "directory" | "leads" | "vetted";
  profile_status: "draft" | "needs_login" | "needs_verification" | "terms_pending" | "published" | "paused";
  profile_title: string; profile_text: string; services: string; fee_notes: string; notes: string;
  evidence_url: string | null; checked_on: string | null;
};

export function httpsUrl(value: string | null | undefined): string | undefined {
  const url = safeWebUrl(value);
  return url?.startsWith("https://") ? url : undefined;
}

export function opportunityMetrics(rows: ClientOpportunity[], platformId = "all") {
  let saved = 0, submitted = 0, replies = 0, won = 0;
  for (const row of rows) {
    if (platformId !== "all" && row.platform_id !== platformId) continue;
    saved++;
    if (!row.submitted_on) continue;
    submitted++;
    if (row.responded_on) replies++;
    if (row.status === "won") won++;
  }
  return { saved, submitted, replies, won, responseRate: submitted ? Math.round(replies / submitted * 100) : null };
}

/** Public deterministic data only; never seed private account profiles into preview. */
export const PREVIEW_PLATFORMS: FreelancePlatform[] = [{
  id: "preview-platform", user_id: "preview", name: "Upwork", url: "https://www.upwork.com/",
  search_url: "https://www.upwork.com/freelance-jobs/react-js/", registration_url: "https://www.upwork.com/",
  profile_url: null, kind: "marketplace", profile_status: "draft", profile_title: "React & TypeScript developer",
  profile_text: "React, TypeScript and Node.js application development.", services: "Application development\nTesting and maintenance",
  fee_notes: "Check fees before submitting a proposal.", notes: "", evidence_url: "https://www.upwork.com/freelance-jobs/react-js/", checked_on: null,
}];
