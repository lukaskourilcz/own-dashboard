import { NextResponse } from "next/server";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { boundedResponseText } from "@/lib/bounded-response";
import { readCareerRecords } from "@/lib/career-records";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { isCareerRelevant, isOsloRelevant } from "@/lib/jobs/filter";
import { isCzechJobSource } from "@/lib/jobs/meta";
import { EMPLOYER_BOARDS, fetchEmployerBoard } from "@/lib/jobs/employer-sources";
import { nativeListingMatches, verifyListings, type Availability } from "@/lib/jobs/availability";
import type { ScrapedJob } from "@/lib/jobs/types";
import type { JobListing } from "@/lib/types";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number) => NextResponse.json({
  error: status === 401 ? "unauthorized" : status === 409 ? "owner-changed" : status === 400 ? "invalid-request" : "jobs-availability-unavailable",
}, { status, headers });
const inputSchema = z.strictObject({ checkedIds: z.array(z.uuid()).max(10_000).default([]) })
  .refine(input => new Set(input.checkedIds).size === input.checkedIds.length);
const preferenceSchema = z.strictObject({ show_czech_career: z.boolean() });
const stateSchema = z.record(z.uuid(), z.enum(["open", "closed", "unknown"]));

/** On-demand, read-only checks. A complete candidate snapshot establishes the
 * remainder; a bounded verification window never masquerades as all records. */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  const expectedOwner = request.headers.get("x-own-dashboard-owner");
  if (expectedOwner !== null && !z.uuid().safeParse(expectedOwner).success) return fail(400);
  const lifetime = new AbortController();
  const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(55_000)]);
  const phase = (ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  try {
    signal.throwIfAborted();
    const start = Date.now();
    if (!Number.isFinite(start)) return fail(503);
    let input: z.infer<typeof inputSchema>;
    try {
      const declared = request.headers.get("content-length");
      if (!request.body && declared !== null && declared !== "0") return fail(400);
      if (request.body && !/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return fail(400);
      input = inputSchema.parse(request.body ? JSON.parse(await boundedResponseText(request, 512 * 1024, phase(5_000))) : {});
    } catch { return fail(signal.aborted ? 503 : 400); }
    signal.throwIfAborted();
    const authSignal = phase(8_000);
    const supabase = await awaitWithSignal(createClient(signal), authSignal);
    const auth = await awaitWithSignal(supabase.auth.getUser(), authSignal);
    authSignal.throwIfAborted();
    if (auth.error) return fail([400, 401, 403].includes(auth.error.status ?? 0) ? 401 : 503);
    const user = auth.data.user;
    if (!user || !z.uuid().safeParse(user.id).success) return fail(401);
    const ownerId = user.id;
    if (expectedOwner !== null && expectedOwner !== ownerId) return fail(409);

    const quotaSignal = phase(5_000);
    const quota = await awaitWithSignal(rateLimit(ownerId, { key: "jobs-availability", limit: 20, windowSec: 600 }), quotaSignal);
    quotaSignal.throwIfAborted();
    if (!quota.ok) {
      if (!Number.isSafeInteger(quota.retryAfter) || quota.retryAfter < 1 || quota.retryAfter > 600) return fail(503);
      return NextResponse.json({ error: "Please wait before checking again" }, { status: 429, headers: { ...headers, "Retry-After": String(quota.retryAfter) } });
    }
    const preferenceSignal = phase(5_000);
    const [snapshot, includeCzech] = await Promise.all([
      readCareerRecords(supabase, "job_listings", { ownerId: ownerId, signal }),
      (async () => {
        const result = await awaitWithSignal(supabase.from("user_preferences").select("show_czech_career").eq("user_id", ownerId)
          .retry(false).abortSignal(preferenceSignal).maybeSingle(), preferenceSignal);
        preferenceSignal.throwIfAborted();
        if (result.error) throw new Error("Career preference unavailable");
        return result.data === null ? false : preferenceSchema.parse(result.data).show_czech_career;
      })(),
    ]);
    signal.throwIfAborted();
    const alreadyChecked = new Set(input.checkedIds);
    const allCandidates = snapshot.data.filter(job => isCareerRelevant(job) &&
      (includeCzech || (!isCzechJobSource(job.source) && isOsloRelevant(job))));
    const candidates = allCandidates.filter(job => !alreadyChecked.has(job.id));
    const boards = EMPLOYER_BOARDS.map(board => ({ ...board }));
    const nativeIds = new Set<string>(boards.map(board => board.id));
    const nativeGroups = new Map<string, JobListing[]>();
    const direct: JobListing[] = [];
    for (const job of candidates) {
      if (!nativeIds.has(job.source)) direct.push(job);
      else {
        const group = nativeGroups.get(job.source);
        if (group) group.push(job); else nativeGroups.set(job.source, [job]);
      }
    }
    const states: Record<string, Availability> = Object.create(null);
    const probeSignal = phase(25_000);
    await awaitWithSignal(Promise.all([
      ...boards.map(async board => {
        const stored = nativeGroups.get(board.id);
        if (!stored?.length) return;
        try {
          const feed = await awaitWithSignal(fetchEmployerBoard(board, probeSignal), probeSignal);
          probeSignal.throwIfAborted();
          const current = new Map<string, ScrapedJob | null>();
          for (const job of feed) current.set(job.externalId, current.has(job.externalId) || job.source !== board.id ? null : job);
          for (const job of stored) states[job.id] = nativeListingMatches(job, current.get(job.external_id)) ? "open" : "unknown";
        } catch {
          probeSignal.throwIfAborted();
          for (const job of stored) states[job.id] = "unknown";
        }
      }),
      (async () => {
        const result = stateSchema.parse(await awaitWithSignal(verifyListings(direct, undefined, probeSignal), probeSignal));
        probeSignal.throwIfAborted();
        const allowed = new Set(direct.slice(0, 100).map(job => job.id));
        if (Object.keys(result).some(id => !allowed.has(id))) throw new Error("Invalid availability evidence");
        Object.assign(states, result);
      })(),
    ]), probeSignal);
    probeSignal.throwIfAborted();
    const end = Date.now();
    if (!Number.isFinite(end) || end < start) return fail(503);
    return NextResponse.json({
      ownerId: ownerId, states, checkedAt: new Date(end).toISOString(), candidates: allCandidates.length,
      remaining: candidates.filter(job => !Object.hasOwn(states, job.id)).length,
    }, { headers });
  } catch { return fail(503); }
  finally { lifetime.abort(); }
}
