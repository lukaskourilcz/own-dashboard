"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Bot,
  BriefcaseBusiness,
  Check,
  Clipboard,
  ExternalLink,
  EyeOff,
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
  DialogDescription,
  DialogHeader,
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
  Updater,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLE_TONE: Record<JobRole, string> = {
  frontend: "bg-accent text-accent-foreground border-border-strong",
  fullstack: "bg-success/10 text-success border-success/30",
  software: "bg-surface-muted text-foreground-muted border-border",
};

// Fit-level → badge tone. Warmer/greener = stronger match.
const FIT_TONE: Record<JobMatch["level"], string> = {
  strong: "bg-success/10 text-success border-success/30",
  good: "bg-primary/10 text-primary border-primary/25",
  partial: "bg-warning/10 text-warning border-warning/25",
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
  listings: JobListing[];
  userStates: JobUserState[];
  setUserStates: Updater<JobUserState[]>;
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
  listings,
  userStates,
  setUserStates,
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
  const [view, setView] = useState<"open" | "applied">("open");

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
  const [applyOpen, setApplyOpen] = useState(false);
  const [copilotFor, setCopilotFor] = useState<JobListing | null>(null);

  return (
    <div>
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
            <div className="flex rounded-md border border-border bg-surface p-0.5">
              {(["open", "applied"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded px-3 py-1.5 text-xs font-medium transition-colors focus-ring",
                    view === v
                      ? "bg-accent text-foreground"
                      : "text-foreground-muted hover:text-foreground",
                  )}
                >
                  {v === "open" ? t.jobs.openTab : t.jobs.appliedTab}
                  <span className="ml-1.5 text-[10px] text-foreground-subtle tabular">
                    {v === "open" ? listings.length : applications.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        }
      />

      {view === "open" ? (
        <OpenPositionsView
          listings={listings}
          userStates={userStates}
          setUserStates={setUserStates}
          appliedListingIds={appliedListingIds}
          appliedUrls={appliedUrls}
          lastRun={lastRun}
          userId={userId}
          onApply={(l) => {
            setApplyFor(l);
            setApplyOpen(true);
          }}
          onCopilot={setCopilotFor}
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
          onLogManual={() => {
            setApplyFor(null);
            setApplyOpen(true);
          }}
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
      />
      <CareerCopilotDialog
        key={copilotFor?.id ?? "none"}
        listing={copilotFor}
        onClose={() => setCopilotFor(null)}
      />
    </div>
  );
}

/* ========================================================================= *
 * Open positions                                                            *
 * ========================================================================= */

function OpenPositionsView({
  listings,
  userStates,
  setUserStates,
  appliedListingIds,
  appliedUrls,
  lastRun,
  userId,
  onApply,
  onCopilot,
}: {
  listings: JobListing[];
  userStates: JobUserState[];
  setUserStates: Updater<JobUserState[]>;
  appliedListingIds: Set<string>;
  appliedUrls: Set<string>;
  lastRun: JobScrapeRun | null;
  userId: string;
  onApply: (l: JobListing) => void;
  onCopilot: (l: JobListing) => void;
}) {
  const t = useDict();
  const locale = useDateLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();

  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | JobRole>("all");
  const [source, setSource] = useState<string>("all");
  const [sortMode, setSortMode] = useState<"fit" | "newest">("fit");
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [strongFitOnly, setStrongFitOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [shortlistedOnly, setShortlistedOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
    const rows = listings.filter((l) => {
      const st = stateByListing.get(l.id)?.state;
      if (st === "hidden" && !showHidden) return false;
      if (shortlistedOnly && st !== "shortlisted") return false;
      if (priorityOnly && l.role === "software") return false;
      if (role !== "all" && l.role !== role) return false;
      if (source !== "all" && l.source !== source) return false;
      if (strongFitOnly) {
        const s = matchById.get(l.id)?.score;
        if (s == null || s < STRONG_FIT_MIN) return false;
      }
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
        return b.first_seen_at.localeCompare(a.first_seen_at);
      });
    }
    // "Best fit": shortlisted → FE/FS before software → score → breadth → newest.
    const empty: JobMatch = {
      score: null,
      level: "unknown",
      matched: [],
      missing: [],
      matchedWeight: 0,
    };
    return rows.sort((a, b) =>
      compareByFit(
        { listing: a, match: matchById.get(a.id) ?? empty, shortlisted: isShortlisted(a) },
        { listing: b, match: matchById.get(b.id) ?? empty, shortlisted: isShortlisted(b) },
      ),
    );
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
    showHidden,
    shortlistedOnly,
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

  async function refresh() {
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
        // The refresh also purges listings this user hid (cascading their
        // state rows away), so re-pull the per-user state to stay in sync.
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
    <div>
      {/* toolbar */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
            <Input
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
            onValueChange={(v) => setSortMode(v as "fit" | "newest")}
            className="h-9 w-auto min-w-32 text-xs"
            aria-label={t.jobs.sortLabel}
            options={[
              { value: "fit", label: t.jobs.sortBestFit },
              { value: "newest", label: t.jobs.sortNewest },
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
          <FilterToggle
            active={showHidden}
            onClick={() => setShowHidden((v) => !v)}
            icon={EyeOff}
            label={t.jobs.showHidden}
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-foreground-muted">
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
          <Card className="p-0 overflow-hidden">
            <ul className="divide-y divide-border">
              {visible.map((l) => (
                <ListingRow
                  key={l.id}
                  listing={l}
                  match={matchById.get(l.id)}
                  state={stateByListing.get(l.id)?.state}
                  applied={
                    appliedListingIds.has(l.id) || appliedUrls.has(l.url)
                  }
                  onShortlist={() => toggleState(l, "shortlisted")}
                  onHide={() => toggleState(l, "hidden")}
                  onApply={() => onApply(l)}
                  onCopilot={() => onCopilot(l)}
                />
              ))}
            </ul>
          </Card>
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
    match.score === null ? t.jobs.fitUnknown : `${match.score}% ${t.jobs.fitSuffix}`;
  const tip =
    match.score === null
      ? t.jobs.fitUnknownHint
      : t.jobs.fitHint(match.matched.length, match.missing.length);
  return (
    <Tooltip content={tip}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular",
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
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        kind === "have"
          ? "border-success/30 bg-success/10 text-success"
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
  onShortlist,
  onHide,
  onApply,
  onCopilot,
}: {
  listing: JobListing;
  match: JobMatch | undefined;
  state: JobUserStateValue | undefined;
  applied: boolean;
  onShortlist: () => void;
  onHide: () => void;
  onApply: () => void;
  onCopilot: () => void;
}) {
  const t = useDict();
  const locale = useDateLocale();
  const roleLabel: Record<JobRole, string> = {
    frontend: t.jobs.roleFrontend,
    fullstack: t.jobs.roleFullstack,
    software: t.jobs.roleSoftware,
  };
  const seen = formatDistanceToNow(new Date(listing.first_seen_at), {
    addSuffix: true,
    locale,
  });
  const subtitle = [listing.company, listing.location, listing.salary]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      className={cn(
        "group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-hover",
        state === "hidden" && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-full truncate text-sm font-medium text-foreground hover:underline focus-ring rounded-sm"
            title={listing.title}
          >
            {listing.title}
          </a>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
              ROLE_TONE[listing.role],
            )}
          >
            {roleLabel[listing.role]}
          </span>
          {match && <FitBadge match={match} />}
          {applied && (
            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              <Check className="h-2.5 w-2.5" />
              {t.jobs.appliedBadge}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="mt-0.5 truncate text-xs text-foreground-muted">
            {subtitle}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-foreground-subtle">
          {jobSourceLabel(listing.source)} · {t.jobs.remoteBadge}
          {listing.seniority ? ` · ${listing.seniority}` : ""} ·{" "}
          {t.jobs.firstSeen.toLowerCase()} {seen}
        </p>
        {match && (match.matched.length > 0 || match.missing.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {match.matched.slice(0, 6).map((s) => (
              <SkillChip key={s.name} label={s.name} kind="have" />
            ))}
            {match.missing.slice(0, 4).map((name) => (
              <SkillChip key={name} label={name} kind="gap" />
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
        <Tooltip content={t.jobs.copilotAction}>
          <button type="button" onClick={onCopilot} aria-label={t.jobs.copilotAction} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring">
            <Bot className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip
          content={
            state === "shortlisted" ? t.jobs.unshortlist : t.jobs.shortlist
          }
        >
          <button
            type="button"
            onClick={onShortlist}
            aria-label={
              state === "shortlisted" ? t.jobs.unshortlist : t.jobs.shortlist
            }
            aria-pressed={state === "shortlisted"}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-ring",
              state === "shortlisted"
                ? "text-warning"
                : "text-foreground-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Star
              className="h-3.5 w-3.5"
              fill={state === "shortlisted" ? "currentColor" : "none"}
            />
          </button>
        </Tooltip>
        <Tooltip content={state === "hidden" ? t.jobs.unhide : t.jobs.hide}>
          <button
            type="button"
            onClick={onHide}
            aria-label={state === "hidden" ? t.jobs.unhide : t.jobs.hide}
            aria-pressed={state === "hidden"}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content={t.jobs.openOriginal}>
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.jobs.openOriginal}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Tooltip>
        <Button size="sm" className="ml-1 h-7" onClick={onApply}>
          <Send className="h-3 w-3" />
          {t.jobs.applyAction}
        </Button>
      </div>
    </li>
  );
}

type CareerReview = {
  summary: string;
  evidence: { claim: string; sourceIds: string[] }[];
  gaps: string[];
  suggestions: string[];
  coverLetterDraft: string;
  interviewQuestions: string[];
};

function CareerCopilotDialog({ listing, onClose }: { listing: JobListing | null; onClose: () => void }) {
  const t = useDict();
  const toast = useToast();
  const [review, setReview] = useState<CareerReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function generate() {
    if (!listing || !window.confirm(t.jobs.copilotConsent)) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/ai/career-copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listing_id: listing.id }),
      });
      if (response.status === 403) {
        toast.err(t.jobs.copilotNeedsSensitive);
        return;
      }
      const data = await response.json().catch(() => null) as { review?: CareerReview } | null;
      if (!response.ok || !data?.review) throw new Error("unavailable");
      setReview(data.review);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function copyDraft() {
    if (!review) return;
    try {
      await navigator.clipboard.writeText(review.coverLetterDraft);
      toast.ok(t.jobs.copilotCopied);
    } catch {
      toast.err(t.jobs.copilotCopyFailed);
    }
  }

  return <Dialog open={Boolean(listing)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Bot className="h-4 w-4" />{t.jobs.copilotTitle}</DialogTitle><DialogDescription>{listing ? `${listing.title}${listing.company ? ` · ${listing.company}` : ""}` : t.jobs.copilotDescription}</DialogDescription></DialogHeader>
      {!review && <div className="space-y-3"><p className="text-sm text-foreground-muted">{t.jobs.copilotDescription}</p><Button onClick={generate} disabled={busy}>{busy ? t.jobs.copilotGenerating : t.jobs.copilotGenerate}</Button>{error && <p className="text-sm text-destructive">{t.jobs.copilotFailed}</p>}</div>}
      {review && <div className="space-y-4 text-sm"><p className="text-foreground-muted">{review.summary}</p><CareerList title={t.jobs.copilotEvidence} items={review.evidence.map((item) => `${item.claim} [${item.sourceIds.join(", ")}]`)} /><CareerList title={t.jobs.copilotGaps} items={review.gaps} /><CareerList title={t.jobs.copilotSuggestions} items={review.suggestions} /><div className="rounded-lg border border-border p-4"><div className="flex items-center justify-between gap-3"><p className="font-medium">{t.jobs.copilotDraft}</p><Button variant="outline" size="sm" onClick={copyDraft}><Clipboard className="h-3.5 w-3.5" />{t.jobs.copilotCopy}</Button></div><p className="mt-3 whitespace-pre-wrap text-foreground-muted">{review.coverLetterDraft}</p></div><CareerList title={t.jobs.copilotInterview} items={review.interviewQuestions} /><p className="text-xs text-foreground-subtle">{t.jobs.copilotProposalNotice}</p></div>}
    </DialogContent>
  </Dialog>;
}

function CareerList({ title, items }: { title: string; items: string[] }) {
  return <div><p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">{title}</p>{items.length === 0 ? <p className="mt-1 text-foreground-muted">—</p> : <ul className="mt-1 list-disc space-y-1 pl-5">{items.map((item) => <li key={item}>{item}</li>)}</ul>}</div>;
}

/* ========================================================================= *
 * Apply dialog — from a listing or as a manual log                          *
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
  setEvents,
  userId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  listing: JobListing | null;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  setApplications: Updater<JobApplication[]>;
  setEvents: Updater<JobApplicationEvent[]>;
  userId: string;
}) {
  const t = useDict();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();

  const [form, setForm] = useState({
    title: "",
    company: "",
    url: "",
    appliedOn: todayIso(),
    coverLetter: "",
    notes: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  // Reset the form whenever the dialog opens for a (different) job.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = listing?.id ?? "manual";
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setForm({
      title: listing?.title ?? "",
      company: listing?.company ?? "",
      url: listing?.url ?? "",
      appliedOn: todayIso(),
      coverLetter: "",
      notes: "",
    });
    setFormError(null);
  }
  if (!open && seededFor !== null) setSeededFor(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const title = form.title.trim();
      const { data, error } = await supabase
        .from("job_applications")
        .insert({
          user_id: userId,
          listing_id: listing?.id ?? null,
          title,
          company: form.company.trim() || null,
          url: form.url.trim() || null,
          source: listing?.source ?? null,
          location: listing?.location ?? null,
          cover_letter: form.coverLetter,
          applied_on: form.appliedOn || todayIso(),
          notes: form.notes.trim() || null,
        })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      const app = data as JobApplication;
      // History trail. Best-effort: a failed event insert must not undo the
      // application itself.
      const { data: ev } = await supabase
        .from("job_application_events")
        .insert({
          user_id: userId,
          application_id: app.id,
          kind: "applied",
          detail: null,
        })
        .select()
        .single();
      return { app, ev: (ev ?? null) as JobApplicationEvent | null };
    },
    onSuccess: ({ app, ev }) => {
      setApplications((prev) => [app, ...prev]);
      if (ev) setEvents((prev) => [ev, ...prev]);
      toast.ok(t.jobs.applicationSaved);
      void qc.invalidateQueries({ queryKey: qk.jobApplications });
      void qc.invalidateQueries({ queryKey: qk.jobApplicationEvents });
      onOpenChange(false);
    },
    onError: () => toast.err(t.jobs.couldNotSave),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setFormError(t.jobs.positionRequired);
      return;
    }
    createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
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

            <CoverLetterField
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

            {formError && (
              <p className="text-xs text-destructive">{formError}</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  {t.jobs.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>
                <Check className="h-3.5 w-3.5" />
                {createMutation.isPending ? t.jobs.saving : t.jobs.saveApplication}
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
}: {
  value: string;
  onChange: (v: string) => void;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  vars: { position?: string | null; company?: string | null; source?: string | null };
  userId: string;
  id?: string;
}) {
  const t = useDict();
  const { lang } = useLang();
  const locale = useDateLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();

  function loadTemplate(key: string) {
    if (!key) return;
    let body: string | null = null;
    if (key.startsWith("builtin:")) {
      const tpl = BUILTIN_TEMPLATES.find((b) => `builtin:${b.id}` === key);
      body = tpl ? tpl.body[lang] : null;
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
    const name = window.prompt(t.jobs.saveAsTemplateName)?.trim();
    if (!name) return;
    saveTemplateMutation.mutate({ name, body: value });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{t.jobs.coverLetter}</Label>
        <div className="flex items-center gap-1.5">
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
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
        className="text-xs leading-relaxed"
      />
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
  onLogManual,
}: {
  applications: JobApplication[];
  setApplications: Updater<JobApplication[]>;
  events: JobApplicationEvent[];
  setEvents: Updater<JobApplicationEvent[]>;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  userId: string;
  onLogManual: () => void;
}) {
  const t = useDict();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();

  const stats = useMemo(() => applicationStats(applications), [applications]);
  const [letterFor, setLetterFor] = useState<JobApplication | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const statusMutation = useMutation({
    mutationFn: async (vars: {
      app: JobApplication;
      status: JobApplicationStatus;
    }) => {
      const { data, error } = await supabase
        .from("job_applications")
        .update({
          status: vars.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vars.app.id)
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      const { data: ev } = await supabase
        .from("job_application_events")
        .insert({
          user_id: userId,
          application_id: vars.app.id,
          kind: "status",
          detail: vars.status,
        })
        .select()
        .single();
      return { app: data as JobApplication, ev: (ev ?? null) as JobApplicationEvent | null };
    },
    onSuccess: ({ app, ev }) => {
      setApplications((prev) => prev.map((a) => (a.id === app.id ? app : a)));
      if (ev) setEvents((prev) => [ev, ...prev]);
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

  function removeApplication(app: JobApplication) {
    if (!window.confirm(t.jobs.deleteApplicationConfirm)) return;
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
        <Button size="sm" onClick={onLogManual}>
          <Plus className="h-3.5 w-3.5" />
          {t.jobs.logManual}
        </Button>
      </div>

      {applications.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={Send}
            title={t.jobs.noApplicationsYet}
            description={t.jobs.noApplicationsDescription}
            action={
              <Button size="sm" onClick={onLogManual}>
                <Plus className="h-3.5 w-3.5" />
                {t.jobs.logManual}
              </Button>
            }
            className="py-16"
          />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-border">
            {applications.map((app) => (
              <ApplicationRow
                key={app.id}
                app={app}
                events={events.filter((e) => e.application_id === app.id)}
                statusLabel={statusLabel}
                onStatus={(status) => statusMutation.mutate({ app, status })}
                onLetter={() => setLetterFor(app)}
                onDelete={() => removeApplication(app)}
              />
            ))}
          </ul>
        </Card>
      )}

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
  onLetter,
  onDelete,
}: {
  app: JobApplication;
  events: JobApplicationEvent[];
  statusLabel: Record<JobApplicationStatus, string>;
  onStatus: (s: JobApplicationStatus) => void;
  onLetter: () => void;
  onDelete: () => void;
}) {
  const t = useDict();
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
                    : `${t.jobs.eventNote}: ${e.detail ?? ""}`}
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
          <DialogTitle>
            {t.jobs.coverLetter}
          </DialogTitle>
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
              <DialogTitle>
                {t.jobs.templatesTitle}
              </DialogTitle>
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
                  className="text-xs leading-relaxed"
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
                        <p className="truncate text-xs font-medium">
                          {tpl.name}
                        </p>
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
                          onClick={() => {
                            if (window.confirm(t.jobs.deleteTemplateConfirm))
                              deleteMutation.mutate(tpl.id);
                          }}
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
