"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  BriefcaseBusiness,
  Bookmark,
  Check,
  ExternalLink,
  Files,
  FileText,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Star,
  Target,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  SimpleSelect,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import { useDateLocale, useDict, useLang } from "@/lib/i18n";
import { useCvLinks } from "@/lib/use-prefs";
import { jobSourceLabel } from "@/lib/jobs/meta";
import { JobSources } from "@/components/panels/job-sources";
import { compareByFit, matchListing, type JobMatch } from "@/lib/jobs/match";
import { applicationStats } from "@/lib/jobs/stats";
import { BUILTIN_TEMPLATES, fillTemplate } from "@/lib/jobs/template";
import type {
  CoverLetterTemplate,
  JobApplication,
  JobApplicationEvent,
  JobApplicationStatus,
  JobListing,
  JobRole,
  JobScrapeRun,
  JobUserState,
  JobUserStateValue,
  SavedJobPosition,
  Updater,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { isCareerRelevant, isPrague, careerSeniority } from "@/lib/jobs/filter";
import { CareerCompanies } from "./career-companies";
import { CareerProgressDialog } from "./career-progress-dialog";
import { isGoogleLetterUrl, readinessLabel, progressEventLabel } from "@/lib/jobs/pipeline";
import { CareerLetterHelper } from "./career-letter-helper";
import type { Availability } from "@/lib/jobs/availability";
import type { LetterLanguage } from "@/lib/jobs/letter-helper";

// Fit-level → badge tone. Warmer/greener = stronger match.
const FIT_TONE: Record<JobMatch["level"], string> = {
  strong: "bg-success/10 text-foreground border-success/30",
  good: "bg-primary/10 text-primary border-primary/25",
  partial: "bg-warning/10 text-foreground border-warning/25",
  weak: "bg-surface-muted text-foreground-muted border-border",
  unknown: "bg-surface text-foreground-subtle border-border",
};

// A listing counts as a "strong fit" (for the quick filter) at this score.
const STRONG_FIT_MIN = 50;

const STATUSES: JobApplicationStatus[] = [
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];

type Props = {
  isPreview?: boolean;
  listings: JobListing[];
  userStates: JobUserState[];
  setUserStates: Updater<JobUserState[]>;
  savedPositions: SavedJobPosition[];
  setSavedPositions: Updater<SavedJobPosition[]>;
  applications: JobApplication[];
  setApplications: Updater<JobApplication[]>;
  events: JobApplicationEvent[];
  setEvents: Updater<JobApplicationEvent[]>;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  lastRun: JobScrapeRun | null;
  userId: string;
};

/** Today's date as the YYYY-MM-DD value a date input expects. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function JobsPanel({
  isPreview = false,
  listings,
  userStates,
  setUserStates,
  savedPositions,
  setSavedPositions,
  applications,
  setApplications,
  events,
  setEvents,
  templates,
  setTemplates,
  lastRun,
  userId,
}: Props) {
  const t = useDict();
  const { cs: cvCs, en: cvEn } = useCvLinks();
  const { lang } = useLang();
  const [view, setView] = useState<
    "open" | "saved" | "ready" | "applied" | "letters" | "companies"
  >("open");
  const relevantListings = useMemo(
    () => listings.filter(isCareerRelevant),
    [listings],
  );

  // Listings the user already applied to, by listing id and by URL (manual
  // logs may match a scraped offer only by its link).
  const appliedListingIds = useMemo(
    () =>
      new Set(
        applications.map((a) => a.listing_id).filter((x): x is string => !!x),
      ),
    [applications],
  );
  const appliedUrls = useMemo(
    () =>
      new Set(applications.map((a) => a.url).filter((x): x is string => !!x)),
    [applications],
  );

  const [applyFor, setApplyFor] = useState<JobListing | null>(null);
  const [savedFor, setSavedFor] = useState<SavedJobPosition | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  return (
    <div className="min-w-0">
      <PageHeader
        title={t.jobs.title}
        description={t.jobs.description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {(cvCs || cvEn) && (
              <div className="flex items-center">
                {cvCs && (
                  <Tooltip content={t.jobs.cvCzech}>
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-sm"
                      className="text-base text-foreground-muted"
                    >
                      <a
                        href={cvCs}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t.jobs.cvCzech}
                      >
                        <span aria-hidden>🇨🇿</span>
                      </a>
                    </Button>
                  </Tooltip>
                )}
                {cvEn && (
                  <Tooltip content={t.jobs.cvEnglish}>
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-sm"
                      className="text-base text-foreground-muted"
                    >
                      <a
                        href={cvEn}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t.jobs.cvEnglish}
                      >
                        <span aria-hidden>🇬🇧</span>
                      </a>
                    </Button>
                  </Tooltip>
                )}
              </div>
            )}
            <div className="flex max-w-full flex-wrap rounded-md border border-border bg-surface p-0.5">
              {(["open", "saved", "ready", "applied", "letters", "companies"] as const).map(
                (v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={cn(
                      "min-h-11 rounded px-3 py-1.5 text-sm font-medium transition-colors focus-ring",
                      view === v
                        ? "bg-accent text-foreground"
                        : "text-foreground-muted hover:text-foreground",
                    )}
                  >
                    {v === "open"
                      ? t.jobs.openTab
                      : v === "saved"
                        ? t.jobs.savedTab
                      : v === "ready"
                        ? lang === "cs" ? "Přihlášky k odeslání" : "Applications to send"
                      : v === "applied"
                        ? t.jobs.appliedTab
                        : v === "letters"
                          ? lang === "cs"
                            ? "Dopisy"
                            : "Cover letters"
                          : lang === "cs"
                            ? "Kariérní odkazy"
                            : "Career links"}
                    {(v === "saved" || v === "ready" || v === "applied") && (
                      <span className="ml-2 text-sm text-foreground-muted">
                        {v === "applied" ? applications.length : savedPositions.filter(row => v === "ready" ? !!row.cover_letter_url : !row.cover_letter_url).length}
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>
          </div>
        }
      />

      {view === "companies" ? (
        <CareerCompanies userId={userId} isPreview={isPreview} />
      ) : view === "letters" ? (
        <LetterWorkspace
          templates={templates}
          setTemplates={setTemplates}
          userId={userId}
          applications={applications}
        />
      ) : view === "saved" || view === "ready" ? (
        <SavedPositionsView
          key={view}
          readyOnly={view === "ready"}
          positions={savedPositions.filter(row => view === "ready" ? !!row.cover_letter_url : !row.cover_letter_url)}
          setPositions={setSavedPositions}
          userId={userId}
          onPrepare={(position, listing) => {
            setSavedFor(position);
            setApplyFor(listing);
            setApplyOpen(true);
          }}
        />
      ) : view === "open" ? (
        <OpenPositionsView
          isPreview={isPreview}
          listings={relevantListings}
          userStates={userStates}
          setUserStates={setUserStates}
          appliedListingIds={appliedListingIds}
          appliedUrls={appliedUrls}
          lastRun={lastRun}
          userId={userId}
          savedPositions={savedPositions}
          setSavedPositions={setSavedPositions}
        />
      ) : (
        <AppliedView
          applications={applications}
          setApplications={setApplications}
          events={events}
          setEvents={setEvents}
          templates={templates}
          setTemplates={setTemplates}
          userId={userId}
        />
      )}

      <ApplyDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        listing={applyFor}
        templates={templates}
        setTemplates={setTemplates}
        setApplications={setApplications}
        setEvents={setEvents}
        userId={userId}
        savedPosition={savedFor}
        setSavedPositions={setSavedPositions}
        onApplied={() => setSavedFor(null)}
      />
    </div>
  );
}

/* ========================================================================= *
 * Open positions                                                            *
 * ========================================================================= */

function OpenPositionsView({
  isPreview,
  listings,
  userStates,
  setUserStates,
  appliedListingIds,
  appliedUrls,
  lastRun,
  userId,
  savedPositions,
  setSavedPositions,
}: {
  isPreview: boolean;
  listings: JobListing[];
  userStates: JobUserState[];
  setUserStates: Updater<JobUserState[]>;
  appliedListingIds: Set<string>;
  appliedUrls: Set<string>;
  lastRun: JobScrapeRun | null;
  userId: string;
  savedPositions: SavedJobPosition[];
  setSavedPositions: Updater<SavedJobPosition[]>;
}) {
  const t = useDict();
  const locale = useDateLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();
  const confirm = useConfirmation();
  const savedListingIds = useMemo(
    () => new Set(savedPositions.map((position) => position.listing_id).filter(Boolean)),
    [savedPositions],
  );
  const savedUrls = useMemo(
    () => new Set(savedPositions.map((position) => position.url)),
    [savedPositions],
  );

  const { lang } = useLang();
  const cs = lang === "cs";
  const [detailId, setDetailId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [workplace, setWorkplace] = useState("all");
  const [seniority, setSeniority] = useState("all");
  const sourceSync = useQuery({
    queryKey: [...qk.jobSourceSync, userId],
    queryFn: async () => {
      if (isPreview) return true;
      const last = Date.parse(lastRun?.finished_at ?? "");
      if (lastRun?.ok && lastRun.sources?.["ashby-apify"] && lastRun.sources?.curated && Number.isFinite(last) && Date.now() - last < 4 * 60 * 60 * 1000)
        return true;
      const response = await fetch("/api/jobs/refresh", { method: "POST" });
      if (response.ok) {
        await qc.invalidateQueries({ queryKey: qk.jobListings, exact: true });
        await qc.invalidateQueries({ queryKey: qk.jobLastRun });
      }
      return response.ok;
    },
    retry: false,
    staleTime: 4 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const availability = useQuery({
    queryKey: [...qk.jobAvailability, userId],
    queryFn: async () => {
      if (isPreview)
        return {
          states: Object.fromEntries(
            listings.map((l) => [l.id, "open" as const]),
          ),
          checkedAt: new Date().toISOString(),
          candidates: listings.length,
          remaining: 0,
        };
      const response = await fetch("/api/jobs/available", {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<{
        states: Record<string, Availability>;
        checkedAt: string;
        candidates: number;
        remaining: number;
      }>;
    },
    enabled: !sourceSync.isPending,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const moreChecks = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/jobs/available", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkedIds: Object.keys(availability.data?.states ?? {}),
        }),
      });
      if (!response.ok) throw new Error("Availability check failed");
      return response.json() as Promise<NonNullable<typeof availability.data>>;
    },
    onSuccess: (result) =>
      qc.setQueryData([...qk.jobAvailability, userId], {
        ...result,
        states: { ...availability.data?.states, ...result.states },
      }),
    onError: () =>
      toast.err(
        cs
          ? "Další nabídky se nepodařilo ověřit."
          : "Could not check the next listings.",
      ),
  });
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | JobRole>("all");
  const [source, setSource] = useState<string>("all");
  const [sortMode, setSortMode] = useState<
    "fit" | "fit-asc" | "newest" | "remote" | "location"
  >("fit");
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [strongFitOnly, setStrongFitOnly] = useState(false);
  const [shortlistedOnly, setShortlistedOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const stateByListing = useMemo(() => {
    const m = new Map<string, JobUserState>();
    for (const s of userStates) m.set(s.listing_id, s);
    return m;
  }, [userStates]);

  // Compare every listing to the tech stack once. Keyed by id so the row and
  // the insight card share one computation.
  const matchById = useMemo(() => {
    const m = new Map<string, JobMatch>();
    for (const l of listings) m.set(l.id, matchListing(l));
    return m;
  }, [listings]);

  const sources = useMemo(
    () => [...new Set(listings.map((l) => l.source))].sort(),
    [listings],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const rows = listings.filter((l) => {
      if (
        sourceSync.isPending ||
        availability.isFetching ||
        availability.isError ||
        availability.data?.states[l.id] !== "open"
      )
        return false;
      if (workplace === "prague" && !isPrague(l.location)) return false;
      if (workplace === "remote" && !l.remote) return false;
      if (seniority !== "all" && careerSeniority(l) !== seniority) return false;
      const st = stateByListing.get(l.id)?.state;
      if (st === "deleted") return false;
      if (shortlistedOnly && st !== "shortlisted") return false;
      if (priorityOnly && l.role === "software") return false;
      if (role !== "all" && l.role !== role) return false;
      if (source !== "all" && l.source !== source) return false;
      if (strongFitOnly) {
        const s = matchById.get(l.id)?.score;
        if (s == null || s < STRONG_FIT_MIN) return false;
      }
      const duplicateKey = `${l.company?.trim().toLowerCase()}|${l.title.trim().toLowerCase()}|${l.location?.trim().toLowerCase()}`;
      if (seen.has(duplicateKey)) return false;
      seen.add(duplicateKey);
      if (!q) return true;
      return `${l.title}\n${l.company ?? ""}\n${l.location ?? ""}\n${l.tags.join(" ")}`
        .toLowerCase()
        .includes(q);
    });
    const isShortlisted = (l: JobListing) =>
      stateByListing.get(l.id)?.state === "shortlisted";
    if (sortMode === "newest") {
      // Shortlisted first, then newest finds.
      return rows.sort((a, b) => {
        const sa = isShortlisted(a) ? 0 : 1;
        const sb = isShortlisted(b) ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return (b.posted_at ?? b.first_seen_at).localeCompare(
          a.posted_at ?? a.first_seen_at,
        );
      });
    }
    const empty: JobMatch = {
      score: null,
      level: "unknown",
      matched: [],
      missing: [],
      matchedWeight: 0,
    };
    const byFit = (a: JobListing, b: JobListing) =>
      compareByFit(
        {
          listing: a,
          match: matchById.get(a.id) ?? empty,
          shortlisted: isShortlisted(a),
        },
        {
          listing: b,
          match: matchById.get(b.id) ?? empty,
          shortlisted: isShortlisted(b),
        },
      );
    if (sortMode === "fit-asc") {
      return rows.sort((a, b) => {
        const aScore = matchById.get(a.id)?.score ?? Number.POSITIVE_INFINITY;
        const bScore = matchById.get(b.id)?.score ?? Number.POSITIVE_INFINITY;
        return aScore - bScore || a.title.localeCompare(b.title);
      });
    }
    if (sortMode === "remote") {
      return rows.sort(
        (a, b) => Number(b.remote) - Number(a.remote) || byFit(a, b),
      );
    }
    if (sortMode === "location") {
      return rows.sort(
        (a, b) =>
          (a.location ?? "").localeCompare(b.location ?? "") || byFit(a, b),
      );
    }
    return rows.sort(byFit);
  }, [
    listings,
    stateByListing,
    matchById,
    query,
    role,
    source,
    sortMode,
    priorityOnly,
    strongFitOnly,
    shortlistedOnly,
    sourceSync.isPending,
    availability.data,
    availability.isFetching,
    availability.isError,
    workplace,
    seniority,
  ]);

  // Set / replace / clear the per-listing triage state. Non-optimistic —
  // the returned row lands in the cache, then an invalidate reconciles.
  const stateMutation = useMutation({
    mutationFn: async (vars: {
      listing: JobListing;
      next: JobUserStateValue | null;
      existing: JobUserState | undefined;
    }) => {
      if (vars.next === null) {
        if (!vars.existing) return null;
        const { error } = await supabase
          .from("job_user_state")
          .delete()
          .eq("id", vars.existing.id);
        if (error) throw error;
        return null;
      }
      const { data, error } = await supabase
        .from("job_user_state")
        .upsert(
          {
            user_id: userId,
            listing_id: vars.listing.id,
            state: vars.next,
          },
          { onConflict: "user_id,listing_id" },
        )
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as JobUserState;
    },
    onSuccess: (row, vars) => {
      setUserStates((prev) => {
        const rest = prev.filter((s) => s.listing_id !== vars.listing.id);
        return row ? [...rest, row] : rest;
      });
      void qc.invalidateQueries({ queryKey: qk.jobUserStates });
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  function toggleState(listing: JobListing, kind: JobUserStateValue) {
    const existing = stateByListing.get(listing.id);
    const next = existing?.state === kind ? null : kind;
    stateMutation.mutate({ listing, next, existing });
  }

  const saveMutation = useMutation({
    mutationFn: async (listing: JobListing) => {
      const { data, error } = await supabase
        .from("saved_job_positions")
        .upsert(
          {
            user_id: userId,
            listing_id: listing.id,
            title: listing.title,
            company: listing.company,
            url: listing.url,
            source: listing.source,
            location: listing.location,
            description: listing.description,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,url" },
        )
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as SavedJobPosition;
    },
    onSuccess: (position) => {
      setSavedPositions((current) => [
        position,
        ...current.filter((row) => row.id !== position.id),
      ]);
      toast.ok(t.jobs.positionSaved);
      void qc.invalidateQueries({ queryKey: qk.savedJobPositions });
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  const deleteMutation = useMutation({
    mutationFn: async (rows: JobListing[]) => {
      const { data, error } = await supabase
        .from("job_user_state")
        .upsert(
          rows.map((listing) => ({
            user_id: userId,
            listing_id: listing.id,
            state: "deleted" as const,
          })),
          { onConflict: "user_id,listing_id" },
        )
        .select();
      if (error) throw error;
      return (data ?? []) as JobUserState[];
    },
    onSuccess: (rows) => {
      const deletedIds = new Set(rows.map((row) => row.listing_id));
      setUserStates((current) => [
        ...current.filter((row) => !deletedIds.has(row.listing_id)),
        ...rows,
      ]);
      setSelected(new Set());
      toast.ok(t.jobs.listingDeleted);
      void qc.invalidateQueries({ queryKey: qk.jobUserStates });
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  async function deleteListings(rows: JobListing[]) {
    if (rows.length === 0) return;
    const approved = await confirm({
      title: t.jobs.deleteListingsTitle,
      description: t.jobs.deleteListingsDescription(rows.length),
      confirmLabel: t.jobs.deleteSelected(rows.length),
      cancelLabel: t.common.cancel,
      destructive: true,
    });
    if (approved) deleteMutation.mutate(rows);
  }

  async function refresh() {
    if (isPreview) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/jobs/refresh", { method: "POST" });
      if (res.status === 429) {
        toast.err(t.jobs.refreshRateLimited);
        return;
      }
      if (!res.ok) {
        toast.err(t.jobs.refreshErr);
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.jobListings }),
        qc.invalidateQueries({ queryKey: qk.jobLastRun }),
        // Re-pull owner state; permanent deletion tombstones must survive
        // scraper refreshes and continue excluding those listings.
        qc.invalidateQueries({ queryKey: qk.jobUserStates }),
      ]);
      toast.ok(t.jobs.refreshOk);
    } catch {
      toast.err(t.jobs.refreshErr);
    } finally {
      setRefreshing(false);
    }
  }

  const lastRunAt = lastRun?.finished_at ?? lastRun?.started_at ?? null;
  const failedSources = Object.entries(lastRun?.sources ?? {}).filter(
    ([, o]) => o.error,
  );

  return (
    <div className="min-w-0">
      <div className="mb-4 border-l-2 border-primary pl-4 text-sm leading-relaxed">
        <p className="font-medium">React · TypeScript · Next.js · Node.js</p>
        <p className="text-foreground-muted">
          {cs
            ? "Frontend a fullstack. Praha nebo práce na dálku z Česka. Junior, medior i senior."
            : "Frontend and fullstack. Prague or remote from Czechia. Junior, medior and senior."}
        </p>
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        <SimpleSelect
          value={workplace}
          onValueChange={setWorkplace}
          className="w-full sm:w-48"
          aria-label={cs ? "Místo práce" : "Work location"}
          options={[
            { value: "all", label: cs ? "Praha i remote" : "Prague + remote" },
            { value: "prague", label: "Praha" },
            { value: "remote", label: "Remote" },
          ]}
        />
        <SimpleSelect
          value={seniority}
          onValueChange={setSeniority}
          className="w-full sm:w-48"
          aria-label={cs ? "Seniorita" : "Seniority"}
          options={[
            { value: "all", label: cs ? "Všechny úrovně" : "All levels" },
            { value: "junior", label: "Junior" },
            { value: "medior", label: "Medior" },
            { value: "senior", label: "Senior" },
            { value: "unspecified", label: cs ? "Neuvedeno" : "Not specified" },
          ]}
        />
      </div>
      {/* toolbar */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
            <Input
              aria-label={t.jobs.searchPlaceholder}
              placeholder={t.jobs.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 pl-8 text-sm"
            />
          </div>
          <SimpleSelect
            value={role}
            onValueChange={(v) => setRole(v as "all" | JobRole)}
            className="h-9 w-auto min-w-32 text-xs"
            aria-label={t.jobs.roleAll}
            options={[
              { value: "all", label: t.jobs.roleAll },
              { value: "frontend", label: t.jobs.roleFrontend },
              { value: "fullstack", label: t.jobs.roleFullstack },
              { value: "software", label: t.jobs.roleSoftware },
            ]}
          />
          <SimpleSelect
            value={source}
            onValueChange={setSource}
            className="h-9 w-auto min-w-32 text-xs"
            aria-label={t.jobs.sourceAll}
            options={[
              { value: "all", label: t.jobs.sourceAll },
              ...sources.map((s) => ({ value: s, label: jobSourceLabel(s) })),
            ]}
          />
          <SimpleSelect
            value={sortMode}
            onValueChange={(v) => setSortMode(v as typeof sortMode)}
            className="h-9 w-auto min-w-32 text-xs"
            aria-label={t.jobs.sortLabel}
            options={[
              { value: "fit", label: t.jobs.sortBestFit },
              { value: "fit-asc", label: t.jobs.sortLowestFit },
              { value: "newest", label: t.jobs.sortNewest },
              { value: "remote", label: t.jobs.sortRemote },
              { value: "location", label: t.jobs.sortLocation },
            ]}
          />
          <FilterToggle
            active={priorityOnly}
            onClick={() => setPriorityOnly((v) => !v)}
            icon={Target}
            label={t.jobs.priorityOnly}
          />
          <FilterToggle
            active={strongFitOnly}
            onClick={() => setStrongFitOnly((v) => !v)}
            icon={Check}
            label={t.jobs.strongFitOnly}
          />
          <FilterToggle
            active={shortlistedOnly}
            onClick={() => setShortlistedOnly((v) => !v)}
            icon={Star}
            label={t.jobs.shortlistedOnly}
          />
          {selected.size > 0 && (
            <>
              <span className="text-xs font-medium text-foreground-muted">
                {t.jobs.selectedListings(selected.size)}
              </span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  void deleteListings(
                    listings.filter((listing) => selected.has(listing.id)),
                  )
                }
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t.jobs.deleteSelected(selected.size)}
              </Button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
          {failedSources.length > 0 && (
            <Tooltip
              content={`${t.jobs.sourceErrors}: ${failedSources
                .map(([s]) => jobSourceLabel(s))
                .join(", ")}`}
            >
              <span className="inline-flex items-center text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
            </Tooltip>
          )}
          <span className="whitespace-nowrap">
            {t.jobs.lastChecked}:{" "}
            {lastRunAt
              ? formatDistanceToNow(new Date(lastRunAt), {
                  addSuffix: true,
                  locale,
                })
              : t.jobs.never}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            {refreshing ? t.jobs.checking : t.jobs.checkNow}
          </Button>
        </div>
      </div>

      {(sourceSync.isError || sourceSync.data === false) && (
        <p className="my-3 text-sm text-warning">
          {cs
            ? "Nové nabídky se nepodařilo načíst. Ověřuji dostupnost dříve uložených pozic."
            : "New listings could not be fetched. Checking availability of previously saved positions."}
        </p>
      )}
      <JobSources lastRun={lastRun} />

      <div className="my-4 text-sm" role="status">
        {isPreview ? (
          cs ? (
            "Ukázková data. Dostupnost se zde neověřuje."
          ) : (
            "Demo data. Availability is not checked here."
          )
        ) : sourceSync.isPending ? (
          cs ? (
            "Načítám aktuální nabídky ze zdrojů…"
          ) : (
            "Fetching current listings from sources…"
          )
        ) : availability.isFetching ? (
          cs ? (
            "Ověřuji dostupnost nabídek…"
          ) : (
            "Checking listing availability…"
          )
        ) : availability.isError ? (
          <span className="text-warning">
            {cs
              ? "Dostupnost se nepodařilo ověřit. Starší nabídky jsou skryté."
              : "Availability could not be checked. Older listings are hidden."}{" "}
            <Button
              variant="outline"
              onClick={() => void availability.refetch()}
            >
              {cs ? "Zkusit znovu" : "Try again"}
            </Button>
          </span>
        ) : cs ? (
          "Zobrazují se jen nabídky s ověřenou stránkou. Uzavřené, nedostupné a dosud neověřené nabídky jsou skryté."
        ) : (
          "Only listings with a verified page are shown. Closed, unavailable and unchecked listings are hidden."
        )}
      </div>
      {!!availability.data?.remaining && !availability.isFetching && (
        <Button
          variant="outline"
          className="mb-4"
          disabled={moreChecks.isPending}
          onClick={() => moreChecks.mutate()}
        >
          {moreChecks.isPending
            ? cs
              ? "Ověřuji…"
              : "Checking…"
            : cs
              ? `Ověřit další nabídky (${availability.data.remaining})`
              : `Check more listings (${availability.data.remaining})`}
        </Button>
      )}
      {listings.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={BriefcaseBusiness}
            title={t.jobs.noListingsYet}
            description={t.jobs.noListingsDescription}
            action={
              <Button size="sm" onClick={refresh} disabled={refreshing}>
                <RefreshCw
                  className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
                />
                {refreshing ? t.jobs.checking : t.jobs.checkNow}
              </Button>
            }
            className="py-16"
          />
        </Card>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t.jobs.noMatches}
          description={t.jobs.noMatchesDescription}
          className="py-16"
        />
      ) : (
        <>
          <p className="mb-2 text-[11px] text-foreground-subtle tabular">
            {visible.length} {t.jobs.listingsShown}
          </p>
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,2fr)_minmax(360px,3fr)]">
            <div className="min-w-0 divide-y divide-border rounded-md border border-border bg-surface">
              {visible.map((l) => (
                <ListingRow
                  key={l.id}
                  listing={l}
                  match={matchById.get(l.id)}
                  state={stateByListing.get(l.id)?.state}
                  applied={
                    appliedListingIds.has(l.id) || appliedUrls.has(l.url)
                  }
                  saved={savedListingIds.has(l.id) || savedUrls.has(l.url)}
                  selected={selected.has(l.id)}
                  onSelect={() =>
                    setSelected((old) => {
                      const next = new Set(old);
                      if (next.has(l.id)) next.delete(l.id);
                      else next.add(l.id);
                      return next;
                    })
                  }
                  onShortlist={() => toggleState(l, "shortlisted")}
                  onDelete={() => void deleteListings([l])}
                  onApply={() => saveMutation.mutate(l)}
                  onDetail={() => {
                    setDetailId(l.id);
                    if (window.matchMedia("(max-width: 1279px)").matches)
                      setMobileDetail(true);
                  }}
                  active={(detailId ?? visible[0]?.id) === l.id}
                />
              ))}
            </div>
            <div className="hidden min-w-0 xl:block">
              {(() => {
                const detail =
                  visible.find((l) => l.id === detailId) ?? visible[0];
                return detail ? (
                  <CareerJobDetails
                    listing={detail}
                    saved={savedListingIds.has(detail.id) || savedUrls.has(detail.url)}
                    onApply={() => saveMutation.mutate(detail)}
                  />
                ) : null;
              })()}
            </div>
            <Dialog open={mobileDetail} onOpenChange={setMobileDetail}>
              <DialogContent className="w-[calc(100%-2rem)] max-w-3xl">
                <DialogTitle>
                  {cs ? "Podrobnosti pozice" : "Position details"}
                </DialogTitle>
                {(() => {
                  const detail = visible.find((l) => l.id === detailId);
                  return detail ? (
                    <CareerJobDetails
                      listing={detail}
                      saved={savedListingIds.has(detail.id) || savedUrls.has(detail.url)}
                      onApply={() => {
                        setMobileDetail(false);
                        saveMutation.mutate(detail);
                      }}
                    />
                  ) : null;
                })()}
              </DialogContent>
            </Dialog>
          </div>
        </>
      )}
    </div>
  );
}

function FilterToggle({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Star;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-ring",
        active
          ? "border-border-strong bg-accent text-foreground"
          : "border-border bg-surface text-foreground-muted hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/* --------------------------- Fit score + skills -------------------------- */

/** The fit-score pill next to a listing's role badge. */
function FitBadge({ match }: { match: JobMatch }) {
  const t = useDict();
  const label =
    match.score === null
      ? t.jobs.fitUnknown
      : `${match.score}% ${t.jobs.fitSuffix}`;
  const tip =
    match.score === null
      ? t.jobs.fitUnknownHint
      : t.jobs.fitHint(match.matched.length, match.missing.length);
  return (
    <Tooltip content={tip}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] font-semibold tabular",
          FIT_TONE[match.level],
        )}
      >
        <Target className="h-2.5 w-2.5" />
        {label}
      </span>
    </Tooltip>
  );
}

/** A single skill chip — green when it's in the stack, muted when it's a gap. */
function SkillChip({ label, kind }: { label: string; kind: "have" | "gap" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-[7px] py-[3px] text-[10px] font-medium",
        kind === "have"
          ? "border-success/30 bg-success/10 text-foreground"
          : "border-border bg-surface-muted text-foreground-muted line-through decoration-foreground-subtle/40",
      )}
    >
      {label}
    </span>
  );
}

function ListingRow({
  listing,
  match,
  state,
  applied,
  saved,
  selected,
  onSelect,
  onShortlist,
  onDelete,
  onApply,
  onDetail,
  active,
}: {
  listing: JobListing;
  match: JobMatch | undefined;
  state: JobUserStateValue | undefined;
  applied: boolean;
  saved: boolean;
  selected: boolean;
  onSelect: () => void;
  onShortlist: () => void;
  onDelete: () => void;
  onApply: () => void;
  onDetail: () => void;
  active: boolean;
}) {
  const t = useDict();
  return (
    <article className={cn("min-w-0 p-4", active && "bg-accent/50")}>
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
          aria-label={listing.title}
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onDetail}
            aria-pressed={active}
            className="focus-ring min-h-11 break-words text-left text-base font-semibold hover:underline"
          >
            {listing.title}
          </button>
          <p className="text-sm text-foreground-muted">
            {listing.company} · {listing.location}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {match && <FitBadge match={match} />}
            <span className="text-sm">
              {listing.seniority ||
                (careerSeniority(listing) === "unspecified"
                  ? "—"
                  : careerSeniority(listing))}
              {listing.salary ? ` · ${listing.salary}` : ""}
            </span>
          </div>
          <p className="mt-2 text-sm text-foreground-muted">
            {jobSourceLabel(listing.source)}
            {saved ? ` · ${t.jobs.savedBadge}` : ""}
            {applied ? ` · ${t.jobs.appliedBadge}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onShortlist}
          aria-pressed={state === "shortlisted"}
          aria-label={
            state === "shortlisted" ? t.jobs.unshortlist : t.jobs.shortlist
          }
        >
          <Star
            className="h-4 w-4"
            fill={state === "shortlisted" ? "currentColor" : "none"}
          />
          {t.jobs.shortlist}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label={t.jobs.deleteListing}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button size="sm" className="ml-auto" onClick={onApply} disabled={saved || applied}>
          <Bookmark className="h-4 w-4" />
          {saved ? t.jobs.savedBadge : t.jobs.savePosition}
        </Button>
      </div>
    </article>
  );
}

function savedToListing(position: SavedJobPosition): JobListing {
  return {
    id: position.listing_id ?? position.id,
    source: position.source ?? "manual",
    external_id: position.id,
    title: position.title,
    company: position.company,
    url: position.url,
    location: position.location,
    role: "software",
    remote: /remote|europe|worldwide/i.test(position.location ?? ""),
    salary: null,
    tags: [],
    seniority: null,
    description: position.description,
    posted_at: null,
    first_seen_at: position.saved_at,
    last_seen_at: position.updated_at,
  };
}

function SavedPositionsView({
  readyOnly,
  positions,
  setPositions,
  userId,
  onPrepare,
}: {
  readyOnly: boolean;
  positions: SavedJobPosition[];
  setPositions: Updater<SavedJobPosition[]>;
  userId: string;
  onPrepare: (position: SavedJobPosition, listing: JobListing) => void;
}) {
  const t = useDict();
  const { lang } = useLang();
  const cs = lang === "cs";
  const toast = useToast();
  const locale = useDateLocale();
  const qc = useQueryClient();
  const supabase = createClient();
  const [form, setForm] = useState({ url: "", title: "", company: "", location: "", description: "" });
  const [showFields, setShowFields] = useState(false);
  const [search, setSearch] = useState("");
  const visible = positions.filter(row => `${row.company} ${row.title}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  function importUrl(url: string) {
    setShowFields(true);
    enrich.mutate(url);
  }

  const enrich = useMutation({
    mutationFn: async (url: string) => {
      const response = await fetch("/api/jobs/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const result = (await response.json()) as Partial<typeof form> & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "enrich-failed");
      return result;
    },
    onSuccess: (result) => setForm((current) => ({ ...current, ...result })),
    onError: () => toast.err(t.jobs.urlImportFailed),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("saved_job_positions")
        .upsert({
          user_id: userId,
          title: form.title.trim(),
          company: form.company.trim() || null,
          url: form.url.trim(),
          source: "manual",
          location: form.location.trim() || null,
          description: form.description.trim() || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,url" })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as SavedJobPosition;
    },
    onSuccess: (position) => {
      setPositions((current) => [position, ...current.filter((row) => row.id !== position.id)]);
      setForm({ url: "", title: "", company: "", location: "", description: "" });
      setShowFields(false);
      toast.ok(t.jobs.positionSaved);
      void qc.invalidateQueries({ queryKey: qk.savedJobPositions });
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("saved_job_positions").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      setPositions((current) => current.filter((position) => position.id !== id));
      void qc.invalidateQueries({ queryKey: qk.savedJobPositions });
    },
    onError: () => toast.err(t.jobs.couldNotDelete),
  });

  return (
    <div className="space-y-4">
      {!readyOnly && <Card className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">{t.jobs.saveByUrl}</h2>
          <p className="mt-1 text-sm text-foreground-muted">{t.jobs.saveByUrlDescription}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="url"
            value={form.url}
            onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
            onPaste={(event) => {
              const url = event.clipboardData.getData("text").trim();
              if (url) queueMicrotask(() => importUrl(url));
            }}
            placeholder="https://…"
            aria-label={t.jobs.link}
          />
          <Button type="button" variant="outline" onClick={() => importUrl(form.url)} disabled={!form.url.trim() || enrich.isPending}>
            {enrich.isPending ? t.jobs.importing : t.jobs.importFromUrl}
          </Button>
        </div>
        {showFields && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="saved-job-title">{t.jobs.position}</Label><Input id="saved-job-title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label htmlFor="saved-job-company">{t.jobs.company}</Label><Input id="saved-job-company" value={form.company} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="saved-job-location">{cs ? "Lokalita" : "Location"}</Label><Input id="saved-job-location" value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="saved-job-description">{cs ? "Popis pozice" : "Job description"}</Label><Textarea id="saved-job-description" rows={6} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></div>
            <div className="flex justify-end"><Button type="button" onClick={() => save.mutate()} disabled={!form.url.trim() || !form.title.trim() || save.isPending}><Bookmark className="h-4 w-4" />{t.jobs.savePosition}</Button></div>
          </div>
        )}
      </Card>}
      <Input value={search} onChange={event=>setSearch(event.target.value)} aria-label={cs?"Hledat přihlášku":"Search applications"} placeholder={cs?"Firma nebo pozice":"Company or position"} className="max-w-sm"/>

      {visible.length === 0 ? (
        <EmptyState icon={Bookmark} title={t.jobs.noSavedPositions} description={t.jobs.noSavedPositionsDescription} className="py-16" />
      ) : (
        <div className="divide-y divide-border rounded-md border border-border bg-surface">
          {visible.map((position) => (
            <article key={position.id} className="flex flex-col gap-3 p-4">
              <div className="min-w-0 flex-1">
                <a href={position.url} target="_blank" rel="noopener noreferrer" className="break-words text-base font-semibold hover:underline focus-ring rounded-sm">{position.title}</a>
                <p className="mt-1 text-sm text-foreground-muted">{[position.company, position.location].filter(Boolean).join(" · ")}</p>
                <p className="mt-1 text-sm text-foreground-muted">{readinessLabel(position.readiness,cs)}</p>
                {position.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground-muted">{position.notes}</p>}
                <p className="mt-1 text-xs text-foreground-subtle">{cs ? "Uloženo" : "Saved"} {formatDistanceToNow(new Date(position.saved_at), { addSuffix: true, locale })}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm"><a href={position.url} target="_blank" rel="noopener noreferrer">{cs?"Inzerát":"Job posting"}<ExternalLink className="h-4 w-4"/></a></Button>
                {position.cover_letter_url && isGoogleLetterUrl(position.cover_letter_url) && <Button asChild variant="outline" size="sm"><a href={position.cover_letter_url} target="_blank" rel="noopener noreferrer">{cs?"Dopis na Google Drive":"Cover letter on Google Drive"}<ExternalLink className="h-4 w-4"/></a></Button>}
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(position.id)} aria-label={cs ? "Odebrat uloženou pozici" : "Remove saved position"}><Trash2 className="h-4 w-4" /></Button>
                <Button size="sm" onClick={() => onPrepare(position, savedToListing(position))}><FileText className="h-4 w-4" />{readyOnly ? (cs?"Zkontrolovat / označit odeslání":"Review / mark as sent") : t.jobs.prepareApplication}</Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ========================================================================= *
 * Apply dialog — from a saved position or as a manual log                   *
 * ========================================================================= */

/** Compact fit breakdown shown atop the apply dialog, so the cover letter can
 * lean on the skills that match and consciously address the gaps. */
function ApplyFitSummary({ listing }: { listing: JobListing }) {
  const t = useDict();
  const match = useMemo(() => matchListing(listing), [listing]);
  if (match.matched.length === 0 && match.missing.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-muted/40 p-3">
      <div className="flex items-center gap-2">
        <FitBadge match={match} />
        <span className="text-[11px] text-foreground-muted">
          {t.jobs.fitHint(match.matched.length, match.missing.length)}
        </span>
      </div>
      {match.matched.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
            {t.jobs.fitYouHave}
          </p>
          <div className="flex flex-wrap gap-1">
            {match.matched.map((s) => (
              <SkillChip key={s.name} label={s.name} kind="have" />
            ))}
          </div>
        </div>
      )}
      {match.missing.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
            {t.jobs.fitGaps}
          </p>
          <div className="flex flex-wrap gap-1">
            {match.missing.map((name) => (
              <SkillChip key={name} label={name} kind="gap" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ApplyDialog({
  open,
  onOpenChange,
  listing,
  templates,
  setTemplates,
  setApplications,
  userId,
  savedPosition,
  setSavedPositions,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  listing: JobListing | null;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  setApplications: Updater<JobApplication[]>;
  setEvents: Updater<JobApplicationEvent[]>;
  userId: string;
  savedPosition: SavedJobPosition | null;
  setSavedPositions: Updater<SavedJobPosition[]>;
  onApplied: () => void;
}) {
  const t = useDict();
  const cs = useLang().lang === "cs";
  const [requestId, setRequestId] = useState("");
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();

  const [form, setForm] = useState({
    title: "",
    company: "",
    url: "",
    appliedOn: todayIso(),
    coverLetter: "",
    coverLetterUrl: "",
    readiness: "draft",
    notes: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  // Reset the form whenever the dialog opens for a (different) job.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = listing?.id ?? "manual";
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setRequestId(savedPosition?.id ?? crypto.randomUUID());
    setForm({
      title: listing?.title ?? "",
      company: listing?.company ?? "",
      url: listing?.url ?? "",
      appliedOn: todayIso(),
      coverLetter: savedPosition?.cover_letter ?? "",
      coverLetterUrl: savedPosition?.cover_letter_url ?? "",
      readiness: savedPosition?.readiness ?? "draft",
      notes: savedPosition?.notes ?? "",
    });
    setFormError(null);
  }
  if (!open && seededFor !== null) setSeededFor(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!isGoogleLetterUrl(form.coverLetterUrl)) throw new Error("Invalid Google Drive URL");
      const { data, error } = await supabase.rpc("record_job_application", {
        p_request_id: requestId, p_saved_id: savedPosition?.id ?? null,
        p_payload: {
          title: form.title.trim(), company: form.company.trim(), url: form.url.trim(),
          listing_id: savedPosition ? savedPosition.listing_id : listing?.id ?? null,
          source: listing?.source ?? "manual", location: listing?.location ?? null,
          cover_letter: form.coverLetter,
          cover_letter_url: form.coverLetterUrl.trim() || null,
          applied_on: form.appliedOn, notes: form.notes.trim(),
        },
      });
      if (error || !data) throw error ?? new Error("no-data");
      return { app: data as JobApplication, savedRemoved: !!savedPosition };
    },
    onSuccess: ({ app, savedRemoved }) => {
      setApplications((prev) => [app, ...prev.filter(row => row.id !== app.id)]);

      if (savedPosition && savedRemoved) {
        setSavedPositions((prev) => prev.filter((position) => position.id !== savedPosition.id));
        void qc.invalidateQueries({ queryKey: qk.savedJobPositions });
      }
      toast.ok(t.jobs.applicationSaved);
      void qc.invalidateQueries({ queryKey: qk.jobApplications });
      void qc.invalidateQueries({ queryKey: qk.jobApplicationEvents });
      onOpenChange(false);
      onApplied();
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!savedPosition) return null;
      if (!isGoogleLetterUrl(form.coverLetterUrl)) throw new Error("Invalid Google Drive URL");
      const { data, error } = await supabase
        .from("saved_job_positions")
        .update({
          title: form.title.trim(),
          company: form.company.trim() || null,
          url: form.url.trim(),
          cover_letter: form.coverLetter,
          cover_letter_url: form.coverLetterUrl.trim() || null,
          readiness: form.readiness,
          notes: form.notes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", savedPosition.id)
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as SavedJobPosition;
    },
    onSuccess: (position) => {
      if (!position) return;
      setSavedPositions((current) => current.map((row) => row.id === position.id ? position : row));
      toast.ok(t.jobs.draftSaved);
      void qc.invalidateQueries({ queryKey: qk.savedJobPositions });
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setFormError(t.jobs.positionRequired);
      return;
    }
    if (!isGoogleLetterUrl(form.coverLetterUrl)) {
      setFormError(cs ? "Vložte odkaz na dokument na Google Drive." : "Enter a Google Drive document link.");
      return;
    }
    createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-5xl">
        <DialogTitle>
          {listing ? t.jobs.applyTitle : t.jobs.logManualTitle}
        </DialogTitle>
        {listing && (
          <p className="mt-1 truncate text-xs text-foreground-muted">
            {[listing.title, listing.company].filter(Boolean).join(" — ")} (
            {jobSourceLabel(listing.source)})
          </p>
        )}
        {listing && <ApplyFitSummary listing={listing} />}
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="job-app-title">{t.jobs.position}</Label>
              <Input
                id="job-app-title"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder={t.jobs.positionPlaceholder}
                maxLength={200}
                autoFocus={!listing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-app-company">{t.jobs.company}</Label>
              <Input
                id="job-app-company"
                value={form.company}
                onChange={(e) =>
                  setForm((f) => ({ ...f, company: e.target.value }))
                }
                placeholder={t.jobs.companyPlaceholder}
                maxLength={200}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="job-app-url">{t.jobs.link}</Label>
              <Input
                id="job-app-url"
                type="url"
                value={form.url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, url: e.target.value }))
                }
                placeholder="https://…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-app-date">{t.jobs.appliedOn}</Label>
              <Input
                id="job-app-date"
                type="date"
                value={form.appliedOn}
                max={todayIso()}
                onChange={(e) =>
                  setForm((f) => ({ ...f, appliedOn: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5"><Label htmlFor="cover-letter-drive">{cs?"Dopis na Google Drive":"Cover letter on Google Drive"}</Label><Input id="cover-letter-drive" type="url" value={form.coverLetterUrl} onChange={event=>setForm(current=>({...current,coverLetterUrl:event.target.value}))} placeholder="https://docs.google.com/document/d/…"/>
          {form.coverLetterUrl && isGoogleLetterUrl(form.coverLetterUrl) && <a className="inline-flex min-h-11 items-center text-sm underline focus-ring" href={form.coverLetterUrl} target="_blank" rel="noopener noreferrer">{cs?"Otevřít dokument":"Open document"}</a>}</div>
          {savedPosition && <SimpleSelect value={form.readiness} onValueChange={readiness=>setForm(current=>({...current,readiness}))} aria-label={cs?"Připravenost přihlášky":"Application readiness"} options={["draft","ready","needs_review"].map(value=>({value,label:readinessLabel(value,cs)}))}/>}
          <p className="text-sm text-foreground-muted">{cs?"Po odeslání přihlášky na webu firmy zde potvrďte datum. Tlačítko níže pouze uloží záznam o odeslání.":"After applying on the employer website, confirm the date here. The button below only records that you sent the application."}</p>
          <CoverLetterField
            description={listing?.description ?? undefined}
            value={form.coverLetter}
            onChange={(v) => setForm((f) => ({ ...f, coverLetter: v }))}
            templates={templates}
            setTemplates={setTemplates}
            vars={{
              position: form.title,
              company: form.company,
              source: listing ? jobSourceLabel(listing.source) : null,
            }}
            userId={userId}
          />

          <div className="space-y-1.5">
            <Label htmlFor="job-app-notes">{t.jobs.notes}</Label>
            <Textarea
              id="job-app-notes"
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
              placeholder={t.jobs.notesPlaceholder}
              rows={2}
              className="text-xs"
            />
          </div>

          {formError && <p className="text-xs text-destructive">{formError}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                {t.jobs.cancel}
              </Button>
            </DialogClose>
            {savedPosition && (
              <Button type="button" variant="outline" size="sm" onClick={() => saveDraftMutation.mutate()} disabled={saveDraftMutation.isPending}>
                {saveDraftMutation.isPending ? t.jobs.saving : t.jobs.saveDraft}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              <Check className="h-3.5 w-3.5" />
              {createMutation.isPending
                ? t.jobs.saving
                : t.jobs.saveApplication}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Cover letter textarea + template loader + "save as template". Shared by
 * the apply dialog and the letter editor on existing applications.
 */
function CoverLetterField({
  value,
  onChange,
  templates,
  setTemplates,
  vars,
  userId,
  id = "job-cover-letter",
  description,
}: {
  value: string;
  onChange: (v: string) => void;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  vars: {
    position?: string | null;
    company?: string | null;
    source?: string | null;
  };
  userId: string;
  id?: string;
  description?: string;
}) {
  const t = useDict();
  const { lang } = useLang();
  const [letterLanguage, setLetterLanguage] = useState<LetterLanguage>(lang);
  const [draftName, setDraftName] = useState("");
  const locale = useDateLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();

  function loadTemplate(key: string) {
    if (!key) return;
    let body: string | null = null;
    if (key.startsWith("builtin:")) {
      const tpl = BUILTIN_TEMPLATES.find((b) => `builtin:${b.id}` === key);
      body = tpl ? tpl.body[letterLanguage] : null;
    } else {
      const tpl = templates.find((x) => `tpl:${x.id}` === key);
      body = tpl?.body ?? null;
    }
    if (body == null) return;
    if (value.trim() && !window.confirm(t.jobs.overwriteLetterConfirm)) return;
    onChange(
      fillTemplate(body, {
        ...vars,
        date: format(new Date(), "PPP", { locale }),
      }),
    );
  }

  const saveTemplateMutation = useMutation({
    mutationFn: async (vars2: { name: string; body: string }) => {
      const { data, error } = await supabase
        .from("cover_letter_templates")
        .insert({ user_id: userId, name: vars2.name, body: vars2.body })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as CoverLetterTemplate;
    },
    onSuccess: (tpl) => {
      setTemplates((prev) => [...prev, tpl]);
      toast.ok(t.jobs.templateSaved);
      void qc.invalidateQueries({ queryKey: qk.coverLetterTemplates });
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  function saveAsTemplate() {
    if (!value.trim()) return;
    const name =
      draftName.trim() ||
      `[${letterLanguage.toUpperCase()}] ${vars.company || (lang === "cs" ? "Firma" : "Company")} · ${vars.position || (lang === "cs" ? "Dopis" : "Letter")} · ${new Date().toISOString().slice(0, 10)}`;
    saveTemplateMutation.mutate({ name, body: value });
  }

  return (
    <div className="space-y-4">
      <CareerLetterHelper
        key={description ?? id}
        position={vars.position ?? ""}
        company={vars.company ?? ""}
        description={description}
        value={value}
        onChange={onChange}
        language={letterLanguage}
        onLanguageChange={setLetterLanguage}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{t.jobs.coverLetter}</Label>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Select
            value=""
            onValueChange={(v) => {
              if (v) loadTemplate(v);
            }}
          >
            <SelectTrigger
              className="h-7 w-auto min-w-36 text-[11px]"
              aria-label={t.jobs.loadTemplate}
            >
              <SelectValue placeholder={t.jobs.loadTemplate} />
            </SelectTrigger>
            <SelectContent>
              {templates.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{t.jobs.savedTemplatesGroup}</SelectLabel>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={`tpl:${tpl.id}`}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>{t.jobs.builtinTemplatesGroup}</SelectLabel>
                {BUILTIN_TEMPLATES.map((b) => (
                  <SelectItem key={b.id} value={`builtin:${b.id}`}>
                    {b.name[lang]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={150}
            className="w-full sm:w-52"
            aria-label={
              lang === "cs" ? "Název uloženého dopisu" : "Saved letter name"
            }
            placeholder={
              lang === "cs"
                ? "Název dopisu (volitelné)"
                : "Letter name (optional)"
            }
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 text-sm"
            onClick={saveAsTemplate}
            disabled={!value.trim() || saveTemplateMutation.isPending}
          >
            <Plus className="h-3 w-3" />
            {t.jobs.saveAsTemplate}
          </Button>
        </div>
      </div>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.jobs.coverLetterPlaceholder}
        rows={9}
        className="text-base leading-relaxed"
      />
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={!value.trim()}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              toast.ok(lang === "cs" ? "Dopis zkopírován" : "Letter copied");
            } catch {
              toast.err(
                lang === "cs"
                  ? "Kopírování selhalo. Vyberte text ručně."
                  : "Copy failed. Select the text manually.",
              );
            }
          }}
        >
          {lang === "cs" ? "Kopírovat dopis" : "Copy letter"}
        </Button>
        <span className="self-center text-sm text-foreground-muted">
          {value.trim().split(/\s+/).filter(Boolean).length}{" "}
          {lang === "cs" ? "slov" : "words"}
        </span>
      </div>
    </div>
  );
}

/* ========================================================================= *
 * Applied view — stats, applications with status history, templates        *
 * ========================================================================= */

function AppliedView({
  applications,
  setApplications,
  events,
  setEvents,
  templates,
  setTemplates,
  userId,
}: {
  applications: JobApplication[];
  setApplications: Updater<JobApplication[]>;
  events: JobApplicationEvent[];
  setEvents: Updater<JobApplicationEvent[]>;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  userId: string;
}) {
  const t = useDict();
  const cs = useLang().lang === "cs";
  const [search, setSearch] = useState("");
  const [since, setSince] = useState("");
  const [responseFilter, setResponseFilter] = useState("all");
  const [progressFor, setProgressFor] = useState<JobApplication | null>(null);
  const cohort = useMemo(()=>applications.filter(row=>(!since || row.applied_on >= since) && `${row.company} ${row.title}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())),[applications,since,search]);
  const visible = cohort.filter(row=>responseFilter === "all" || (responseFilter === "responded" ? !!row.responded_on : !row.responded_on));
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();
  const confirm = useConfirmation();

  const stats = useMemo(() => applicationStats(cohort), [cohort]);
  const [letterFor, setLetterFor] = useState<JobApplication | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const statusMutation = useMutation({
    mutationFn: async (vars: {
      app: JobApplication;
      status: JobApplicationStatus;
    }) => {
      const { data, error } = await supabase.rpc("update_job_application_progress", {
        p_id: vars.app.id, p_status: vars.status, p_responded_on: vars.app.responded_on ?? null,
        p_response_kind: vars.app.response_kind ?? null, p_follow_up_at: vars.app.next_follow_up_at ?? null,
        p_notes: vars.app.notes ?? "",
      });
      if (error || !data) throw error ?? new Error("no-data");
      return { app: data as JobApplication };
    },
    onSuccess: ({ app }) => {
      setApplications((prev) => prev.map((a) => (a.id === app.id ? app : a)));

      toast.ok(t.jobs.statusUpdated);
      void qc.invalidateQueries({ queryKey: qk.jobApplications });
      void qc.invalidateQueries({ queryKey: qk.jobApplicationEvents });
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("job_applications")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.jobApplications });
      const prev = qc.getQueryData<JobApplication[]>(qk.jobApplications);
      setApplications((old) => old.filter((a) => a.id !== id));
      setEvents((old) => old.filter((e) => e.application_id !== id));
      return { prev };
    },
    onSuccess: () => toast.ok(t.jobs.applicationDeleted),
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) setApplications(ctx.prev);
      toast.err(t.jobs.couldNotDelete);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.jobApplications });
      void qc.invalidateQueries({ queryKey: qk.jobApplicationEvents });
    },
  });

  async function removeApplication(app: JobApplication) {
    if (
      await confirm({
        title: t.jobs.deleteApplication,
        description: t.jobs.deleteApplicationConfirm,
        confirmLabel: t.common.delete,
        cancelLabel: t.common.cancel,
        destructive: true,
      })
    )
      deleteMutation.mutate(app.id);
  }

  const statusLabel: Record<JobApplicationStatus, string> = {
    applied: t.jobs.statusApplied,
    interviewing: t.jobs.statusInterviewing,
    offer: t.jobs.statusOffer,
    rejected: t.jobs.statusRejected,
    withdrawn: t.jobs.statusWithdrawn,
  };

  return (
    <div>
      {/* stats strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            [t.jobs.statsTotal, stats.total],
            [t.jobs.statsLast7, stats.last7],
            [t.jobs.statsLast30, stats.last30],
            [t.jobs.statsActive, stats.active],
            [cs?"Odpovědi":"Responses", stats.responses],
            [cs?"Podíl odpovědí":"Response rate", stats.responseRate === null ? "—" : `${stats.responseRate}%`],
            [cs?"Medián dnů do odpovědi":"Median days to response", stats.medianResponseDays ?? "—"],
            [cs?"K připomenutí":"Follow-ups due", stats.overdueFollowUps],
          ] as const
        ).map(([label, value]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-subtle">
              {label}
            </p>
            <p className="mt-1 text-xl font-semibold tabular">{value}</p>
          </Card>
        ))}
      </div>

      <p className="mb-3 text-sm text-foreground-muted">{cs?"Statistiky vycházejí z vybraného období a hledání. Podíl odpovědí počítá přihlášky se zaznamenanou skutečnou odpovědí; u čerstvých přihlášek může být zatím nižší.":"Metrics use the selected period and search. Response rate counts applications with a recorded substantive response; recent applications have had less time to receive one."}</p>
      <div className="mb-4 flex flex-wrap items-end gap-3"><Input value={search} onChange={event=>setSearch(event.target.value)} className="max-w-sm" aria-label={cs?"Hledat odeslané přihlášky":"Search sent applications"} placeholder={cs?"Firma nebo pozice":"Company or position"}/>
      <div><Label htmlFor="applications-since">{cs?"Odesláno od":"Applied since"}</Label><Input id="applications-since" type="date" value={since} onChange={event=>setSince(event.target.value)}/></div>
      <SimpleSelect value={responseFilter} onValueChange={setResponseFilter} aria-label={cs?"Filtrovat odpovědi":"Filter responses"} options={[{value:"all",label:cs?"Všechny přihlášky":"All applications"},{value:"responded",label:cs?"S odpovědí":"With response"},{value:"waiting",label:cs?"Bez odpovědi":"Without response"}]}/></div>
      {/* toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setTemplatesOpen(true)}
        >
          <Files className="h-3.5 w-3.5" />
          {t.jobs.manageTemplates}
        </Button>
      </div>

      {visible.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={Send}
            title={t.jobs.noApplicationsYet}
            description={t.jobs.noApplicationsDescription}
            className="py-16"
          />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-border">
            {visible.map((app) => (
              <ApplicationRow
                key={app.id}
                app={app}
                events={events.filter((e) => e.application_id === app.id)}
                statusLabel={statusLabel}
                onStatus={(status) => statusMutation.mutate({ app, status })}
                onProgress={() => setProgressFor(app)}
                onLetter={() => setLetterFor(app)}
                onDelete={() => removeApplication(app)}
              />
            ))}
          </ul>
        </Card>
      )}

      {progressFor && <CareerProgressDialog key={progressFor.id} app={progressFor} onClose={()=>setProgressFor(null)} setApplications={setApplications}/>}
      <LetterDialog
        app={letterFor}
        onClose={() => setLetterFor(null)}
        templates={templates}
        setTemplates={setTemplates}
        setApplications={setApplications}
        userId={userId}
      />
      <TemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        templates={templates}
        setTemplates={setTemplates}
        userId={userId}
      />
    </div>
  );
}

function ApplicationRow({
  app,
  events,
  statusLabel,
  onStatus,
  onProgress,
  onLetter,
  onDelete,
}: {
  app: JobApplication;
  events: JobApplicationEvent[];
  statusLabel: Record<JobApplicationStatus, string>;
  onStatus: (s: JobApplicationStatus) => void;
  onProgress: () => void;
  onLetter: () => void;
  onDelete: () => void;
}) {
  const t = useDict();
  const cs = useLang().lang === "cs";
  const locale = useDateLocale();
  const [historyOpen, setHistoryOpen] = useState(false);

  const appliedDate = new Date(`${app.applied_on}T00:00:00`);
  const subtitle = [app.company, app.source ? jobSourceLabel(app.source) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {app.url ? (
              <a
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="max-w-full truncate text-sm font-medium hover:underline focus-ring rounded-sm"
                title={app.title}
              >
                {app.title}
              </a>
            ) : (
              <span className="truncate text-sm font-medium" title={app.title}>
                {app.title}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-foreground-muted">
            {subtitle}
          </p>
          <p className="mt-0.5 text-[11px] text-foreground-subtle">
            {t.jobs.appliedOnLabel} {format(appliedDate, "PPP", { locale })} (
            {formatDistanceToNow(appliedDate, { addSuffix: true, locale })})
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <SimpleSelect
            value={app.status}
            onValueChange={(v) => onStatus(v as JobApplicationStatus)}
            className="h-7 w-auto min-w-28 text-[11px]"
            aria-label={t.jobs.statusLabel}
            options={STATUSES.map((s) => ({ value: s, label: statusLabel[s] }))}
          />
          <Tooltip content={t.jobs.coverLetterAction}>
            <button
              type="button"
              onClick={onLetter}
              aria-label={t.jobs.coverLetterAction}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t.jobs.history}>
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-label={t.jobs.history}
              aria-expanded={historyOpen}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-ring",
                historyOpen
                  ? "bg-accent text-foreground"
                  : "text-foreground-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <History className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t.jobs.deleteApplication}>
            <button
              type="button"
              onClick={onDelete}
              aria-label={t.jobs.deleteApplication}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-destructive focus-ring"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {app.cover_letter_url && isGoogleLetterUrl(app.cover_letter_url) && <Button asChild size="sm" variant="outline"><a href={app.cover_letter_url} target="_blank" rel="noopener noreferrer">{cs?"Dopis na Google Drive":"Cover letter on Google Drive"}<ExternalLink className="h-4 w-4"/></a></Button>}
        <Button size="sm" variant="outline" onClick={onProgress}>{cs?"Odpověď / další postup":"Response / follow-up"}</Button>
        <span className="text-sm text-foreground-muted">{app.responded_on ? `${cs?"První odpověď":"First response"}: ${format(new Date(`${app.responded_on}T00:00:00`),"PP",{locale})}` : cs?"Zatím bez zaznamenané odpovědi":"No response recorded yet"}</span>
        {app.next_follow_up_at && <span className="text-sm text-foreground-muted">{cs?"Připomenout":"Follow up"}: {format(new Date(app.next_follow_up_at),"PP",{locale})}</span>}
      </div>
      {historyOpen && (
        <ul className="mt-2 space-y-1 border-l-2 border-border pl-3">
          {events.length === 0 && (
            <li className="text-[11px] text-foreground-subtle">—</li>
          )}
          {events.map((e) => (
            <li key={e.id} className="text-[11px] text-foreground-muted">
              <span className="font-medium text-foreground">
                {e.kind === "applied"
                  ? t.jobs.eventApplied
                  : e.kind === "status"
                    ? `${t.jobs.eventStatus} ${
                        statusLabel[e.detail as JobApplicationStatus] ??
                        e.detail ??
                        ""
                      }`
                    : `${t.jobs.eventNote}: ${progressEventLabel(e.detail, cs)}`}
              </span>{" "}
              · {format(new Date(e.created_at), "PPp", { locale })}
            </li>
          ))}
        </ul>
      )}

      {app.notes && (
        <p className="mt-2 whitespace-pre-wrap text-[11px] text-foreground-muted">
          {app.notes}
        </p>
      )}
    </li>
  );
}

/* ========================================================================= *
 * Cover letter editor for an existing application                           *
 * ========================================================================= */

function LetterDialog({
  app,
  onClose,
  templates,
  setTemplates,
  setApplications,
  userId,
}: {
  app: JobApplication | null;
  onClose: () => void;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  setApplications: Updater<JobApplication[]>;
  userId: string;
}) {
  const t = useDict();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();

  const [letter, setLetter] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (app && seededFor !== app.id) {
    setSeededFor(app.id);
    setLetter(app.cover_letter);
  }
  if (!app && seededFor !== null) setSeededFor(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!app) throw new Error("no-app");
      const { data, error } = await supabase
        .from("job_applications")
        .update({
          cover_letter: letter,
          updated_at: new Date().toISOString(),
        })
        .eq("id", app.id)
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as JobApplication;
    },
    onSuccess: (row) => {
      setApplications((prev) => prev.map((a) => (a.id === row.id ? row : a)));
      toast.ok(t.jobs.letterSaved);
      void qc.invalidateQueries({ queryKey: qk.jobApplications });
      onClose();
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  return (
    <Dialog open={app !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{t.jobs.coverLetter}</DialogTitle>
        {app && (
          <p className="mt-1 truncate text-xs text-foreground-muted">
            {[app.title, app.company].filter(Boolean).join(" — ")}
          </p>
        )}
        <div className="mt-3 space-y-3">
          <CoverLetterField
            id="job-letter-editor"
            value={letter}
            onChange={setLetter}
            templates={templates}
            setTemplates={setTemplates}
            vars={{
              position: app?.title,
              company: app?.company,
              source: app?.source ? jobSourceLabel(app.source) : null,
            }}
            userId={userId}
          />
          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                {t.jobs.cancel}
              </Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              <Check className="h-3.5 w-3.5" />
              {saveMutation.isPending ? t.jobs.saving : t.jobs.save}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ========================================================================= *
 * Templates manager                                                         *
 * ========================================================================= */

function TemplatesDialog({
  open,
  onOpenChange,
  templates,
  setTemplates,
  userId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  userId: string;
}) {
  const t = useDict();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();
  const confirm = useConfirmation();

  const [editing, setEditing] = useState<CoverLetterTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", body: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const formOpen = creating || editing !== null;

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setForm({ name: "", body: "" });
    setFormError(null);
  }

  function openEdit(tpl: CoverLetterTemplate) {
    setCreating(false);
    setEditing(tpl);
    setForm({ name: tpl.name, body: tpl.body });
    setFormError(null);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setFormError(null);
  }

  const saveMutation = useMutation({
    mutationFn: async (vars: {
      id: string | null;
      name: string;
      body: string;
    }) => {
      if (vars.id) {
        const { data, error } = await supabase
          .from("cover_letter_templates")
          .update({
            name: vars.name,
            body: vars.body,
            updated_at: new Date().toISOString(),
          })
          .eq("id", vars.id)
          .select()
          .single();
        if (error || !data) throw error ?? new Error("no-data");
        return data as CoverLetterTemplate;
      }
      const { data, error } = await supabase
        .from("cover_letter_templates")
        .insert({ user_id: userId, name: vars.name, body: vars.body })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as CoverLetterTemplate;
    },
    onSuccess: (tpl, vars) => {
      setTemplates((prev) =>
        vars.id ? prev.map((x) => (x.id === tpl.id ? tpl : x)) : [...prev, tpl],
      );
      toast.ok(t.jobs.templateSaved);
      void qc.invalidateQueries({ queryKey: qk.coverLetterTemplates });
      closeForm();
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("cover_letter_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.coverLetterTemplates });
      const prev = qc.getQueryData<CoverLetterTemplate[]>(
        qk.coverLetterTemplates,
      );
      setTemplates((old) => old.filter((x) => x.id !== id));
      return { prev };
    },
    onSuccess: () => toast.ok(t.jobs.templateDeleted),
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) setTemplates(ctx.prev);
      toast.err(t.jobs.couldNotDelete);
    },
    onSettled: () =>
      qc.invalidateQueries({ queryKey: qk.coverLetterTemplates }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const body = form.body.trim();
    if (!name) {
      setFormError(t.jobs.nameRequired);
      return;
    }
    if (!body) {
      setFormError(t.jobs.bodyRequired);
      return;
    }
    saveMutation.mutate({ id: editing?.id ?? null, name, body });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" showClose={false}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle>{t.jobs.templatesTitle}</DialogTitle>
            <p className="mt-1 text-xs text-foreground-muted">
              {t.jobs.templatesDescription}
            </p>
          </div>
          {!formOpen && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              {t.jobs.newTemplate}
            </Button>
          )}
        </div>

        {formOpen ? (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">{t.jobs.templateName}</Label>
              <Input
                id="tpl-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder={t.jobs.templateNamePlaceholder}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-body">{t.jobs.templateBody}</Label>
              <Textarea
                id="tpl-body"
                value={form.body}
                onChange={(e) =>
                  setForm((f) => ({ ...f, body: e.target.value }))
                }
                placeholder={t.jobs.templateBodyPlaceholder}
                rows={10}
                className="text-base leading-relaxed"
              />
              <p className="text-[11px] text-foreground-subtle">
                {t.jobs.placeholdersHint}
              </p>
            </div>
            {formError && (
              <p className="text-xs text-destructive">{formError}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeForm}
              >
                {t.jobs.cancel}
              </Button>
              <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                <Check className="h-3.5 w-3.5" />
                {saveMutation.isPending ? t.jobs.saving : t.jobs.save}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-4">
            {templates.length === 0 ? (
              <p className="py-6 text-center text-xs text-foreground-muted">
                {t.jobs.noTemplatesYet}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {templates.map((tpl) => (
                  <li
                    key={tpl.id}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{tpl.name}</p>
                      <p className="truncate text-[11px] text-foreground-subtle">
                        {tpl.body.replace(/\s+/g, " ").slice(0, 90)}
                      </p>
                    </div>
                    <Tooltip content={t.jobs.editTemplate}>
                      <button
                        type="button"
                        onClick={() => openEdit(tpl)}
                        aria-label={t.jobs.editTemplate}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </Tooltip>
                    <Tooltip content={t.jobs.deleteTemplate}>
                      <button
                        type="button"
                        onClick={() =>
                          void confirm({
                            title: t.jobs.deleteTemplate,
                            description: t.jobs.deleteTemplateConfirm,
                            confirmLabel: t.common.delete,
                            cancelLabel: t.common.cancel,
                            destructive: true,
                          }).then((approved) => {
                            if (approved) deleteMutation.mutate(tpl.id);
                          })
                        }
                        aria-label={t.jobs.deleteTemplate}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-destructive focus-ring"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  {t.jobs.cancel}
                </Button>
              </DialogClose>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LetterWorkspace({
  templates,
  setTemplates,
  applications,
  userId,
}: {
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  applications: JobApplication[];
  userId: string;
}) {
  const { lang } = useLang();
  const cs = lang === "cs";
  const [position, setPosition] = useState("");
  const [company, setCompany] = useState("");
  const [letter, setLetter] = useState("");
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]">
      <section className="min-w-0 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span>{cs ? "Pozice" : "Position"}</span>
            <Input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span>{cs ? "Firma" : "Company"}</span>
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
        </div>
        <CoverLetterField
          value={letter}
          onChange={setLetter}
          templates={templates}
          setTemplates={setTemplates}
          vars={{ position, company }}
          userId={userId}
        />
        <p className="text-sm text-foreground-muted">
          {cs
            ? "Rozpracovaný dopis uložte jako pojmenovanou šablonu. Odeslaný dopis připojte k žádosti v sekci Přihlášky."
            : "Save an unfinished letter as a named template. Record a sent letter with its application in Applications."}
        </p>
      </section>
      <aside className="min-w-0 space-y-4">
        <h2 className="text-base font-semibold">
          {cs ? "Předchozí dopisy" : "Previous letters"}
        </h2>
        {applications
          .filter((a) => a.cover_letter.trim())
          .map((a) => (
            <details key={a.id} className="border-b border-border pb-3">
              <summary className="cursor-pointer break-words text-sm font-medium">
                {a.company} · {a.title}
                <span className="block text-foreground-muted">
                  {a.applied_on}
                </span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
                {a.cover_letter}
              </p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  if (
                    !letter.trim() ||
                    window.confirm(
                      cs
                        ? "Nahradit aktuální návrh?"
                        : "Replace the current draft?",
                    )
                  )
                    setLetter(a.cover_letter);
                }}
              >
                {cs ? "Použít jako základ" : "Use as starting point"}
              </Button>
            </details>
          ))}
        {!applications.some((a) => a.cover_letter.trim()) && (
          <p className="text-sm text-foreground-muted">
            {cs
              ? "Uložené dopisy k žádostem se objeví zde."
              : "Letters saved with applications will appear here."}
          </p>
        )}
      </aside>
    </div>
  );
}

function CareerJobDetails({
  listing: detail,
  onApply,
  saved,
}: {
  listing: JobListing;
  onApply: () => void;
  saved: boolean;
}) {
  const { lang } = useLang();
  const cs = lang === "cs";
  const t = useDict();
  return (
    <section
      className="min-w-0 rounded-md border border-border bg-surface p-5"
      aria-label={cs ? "Podrobnosti pozice" : "Position details"}
    >
      <p className="mb-2 text-sm text-foreground-muted">
        {detail.company} · {detail.location}
      </p>
      <h2 className="break-words text-xl font-semibold">{detail.title}</h2>
      <p className="mt-2 text-sm text-foreground-muted">
        {detail.salary || (cs ? "Mzda neuvedena" : "Salary not specified")}
      </p>
      <div className="my-4 flex flex-wrap gap-2">
        <Button onClick={onApply} disabled={saved}>
          <Bookmark className="h-4 w-4" />
          {saved ? t.jobs.savedBadge : t.jobs.savePosition}
        </Button>
        <Button asChild variant="outline">
          <a href={detail.url} target="_blank" rel="noopener noreferrer">
            {t.jobs.openOriginal}
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </div>
      <ApplyFitSummary listing={detail} />
      <p className="my-3 text-sm text-foreground-muted">
        {cs
          ? "Shoda technologií není pravděpodobnost přijetí. Ověřte požadovanou praxi a podmínky práce na dálku."
          : "Technology overlap is not a hiring probability. Check experience requirements and remote eligibility."}
      </p>
      <h3 className="mb-2 font-medium">
        {cs ? "Popis pozice" : "Job description"}
      </h3>
      <p className="whitespace-pre-wrap break-words text-base leading-relaxed">
        {detail.description ||
          (cs
            ? "Zdroj neposkytl popis. Otevřete inzerát a vložte text do průvodce dopisem."
            : "This source did not provide a description. Open the posting and paste it into the letter helper.")}
      </p>
      <p className="mt-4 text-sm text-foreground-muted">
        {jobSourceLabel(detail.source)} ·{" "}
        {cs
          ? "Dostupnost ověřena při načtení"
          : "Availability checked on this visit"}
      </p>
    </section>
  );
}
