import type { ClientOpportunity } from "@/lib/types";

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
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}

export function opportunityMetrics(rows: ClientOpportunity[], platformId = "all") {
  const cohort = rows.filter(row => platformId === "all" || row.platform_id === platformId);
  const submitted = cohort.filter(row => Boolean(row.submitted_on));
  const replies = submitted.filter(row => Boolean(row.responded_on));
  return { saved: cohort.length, submitted: submitted.length, replies: replies.length,
    won: submitted.filter(row => row.status === "won").length,
    responseRate: submitted.length ? Math.round(replies.length / submitted.length * 100) : null };
}

/** Public deterministic data only; never seed private account profiles into preview. */
export const PREVIEW_PLATFORMS: FreelancePlatform[] = [{
  id: "preview-platform", user_id: "preview", name: "Upwork", url: "https://www.upwork.com/",
  search_url: "https://www.upwork.com/freelance-jobs/react-js/", registration_url: "https://www.upwork.com/",
  profile_url: null, kind: "marketplace", profile_status: "draft", profile_title: "React & TypeScript developer",
  profile_text: "React, TypeScript and Node.js application development.", services: "Application development\nTesting and maintenance",
  fee_notes: "Check fees before submitting a proposal.", notes: "", evidence_url: "https://www.upwork.com/freelance-jobs/react-js/", checked_on: null,
}];
