"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  BriefcaseBusiness,
  Bookmark,
  Check,
  ChevronDown,
  ExternalLink,
  Files,
  FileText,
  History,
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
import { useCareerTemplateWrite } from "@/components/panels/use-career-template-write";
import { CAREER_TEMPLATE_NAME_MAX, CAREER_TEMPLATE_BODY_MAX } from "@/lib/career-template-records";
import { CareerTemplatePicker } from "@/components/panels/career-template-picker";
import { CareerTemplatesDialog, CareerTemplateFailure } from "@/components/panels/career-templates-dialog";
import { CareerPagination } from "@/components/panels/career-pagination";
import { collectionPage } from "@/lib/collection-page";
import { readCareerAvailability, availabilityVersionMatches, CareerAvailabilityError, type AvailabilityReceipt, type AvailabilityRequest } from "@/lib/jobs/availability-client";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
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
import { useCvLinks, useCzechCareerVisibility } from "@/lib/use-prefs";
import { jobSourceLabel } from "@/lib/jobs/meta";
import { JobSources } from "@/components/panels/job-sources";
import { compareByFit, matchListing, type JobMatch } from "@/lib/jobs/match";
import { applicationStats } from "@/lib/jobs/stats";
import { fillTemplate } from "@/lib/jobs/template";
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

import { isCareerRelevant, isOsloRelevant, snapshotRemote, isOsloSnapshot, isPrague, careerSeniority } from "@/lib/jobs/filter";
import { OsloCareerWorkspace, OsloLetterReview } from "./oslo-career-workspace";
import { researchForUrl, careerPositionKey } from "@/lib/jobs/oslo-research";
import { CareerBoard } from "./career-board";
import { applyCareerSaveReceipt, captureCareerListing, CareerSaveError } from "@/lib/career-listing-save";
import { applyCareerTriage, applyCareerTriageReceipt, CareerTriageError, type CareerTriageIntent } from "@/lib/career-triage";
import { readCareerRecords, type CareerScope } from "@/lib/career-records";
import { SavedPositionsView } from "./career-saved-positions";
import { useCareerApplicationRecordWrite } from "./use-career-application-record-write";
import { useCareerProgressWrite } from "./use-career-progress-write";
import { useCareerApplicationDraft } from "./use-career-application-draft";
import { useGuardedNavigation, useUnsavedDraft } from "@/components/navigation-guard";
import { CareerActionNotice } from "./career-action-notice";
import { CareerCompanies } from "./career-companies";
import { CareerProgressDialog } from "./career-progress-dialog";
import { isGoogleLetterUrl, isPositionReady, readinessLabel, progressEventLabel } from "@/lib/jobs/pipeline";
import { CareerLetterHelper } from "./career-letter-helper";
import type { LetterLanguage } from "@/lib/jobs/letter-helper";
import { useNow } from "@/lib/use-now";
import { focusDayKey } from "@/lib/date-keys";
import { safeWebUrl } from "@/lib/web-url";
import { useOwnerPreferences } from "@/lib/owner-preferences";
import { awaitWithSignal } from "@/lib/abortable";
import { CareerRefreshError, refreshCareer } from "@/lib/jobs/refresh-client";

// Fit-level → badge tone. Warmer/greener = stronger match.
const FIT_TONE: Record<JobMatch["level"], string> = {
  strong: "bg-success/10 text-foreground border-success/30",
  good: "bg-primary/10 text-primary border-primary/25",
  partial: "bg-warning/10 text-foreground border-warning/25",
  weak: "bg-surface-muted text-foreground-muted border-border",
  unknown: "bg-surface text-foreground-subtle border-border",
};

const STATUSES: JobApplicationStatus[] = [
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];

type Props = {
  /** True after an explicit private Career data load in this page session. */
  activated: boolean;
  timeZone?: string;
  /** Fetch Career's on-demand data and mark it active. */
  onActivate: (signal?: AbortSignal) => Promise<void>;
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
function todayIso(timeZone: string): string {
  return focusDayKey(new Date(), timeZone);
}

export function JobsPanel({
  activated,
  timeZone = "Europe/Prague",
  onActivate,
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
  const cvLinks = useCvLinks();
  const navigate = useGuardedNavigation();
  const [revealedSavedIds, setRevealedSavedIds] = useState<ReadonlySet<string>>(new Set());
  const cvCs = safeWebUrl(cvLinks.cs), cvEn = safeWebUrl(cvLinks.en);
  const { showCzechCareer } = useCzechCareerVisibility();
  const { lang } = useLang();
  const [view, setView] = useState<
    "oslo" | "open" | "saved" | "ready" | "applied" | "letters" | "companies"
  >("oslo");
  const relevantListings = useMemo(
    () => listings.filter(job => isCareerRelevant(job) && (showCzechCareer || isOsloRelevant(job))),
    [listings, showCzechCareer],
  );

  const visibleSaved = useMemo(() => savedPositions.filter(row => showCzechCareer || revealedSavedIds.has(row.id) || !!researchForUrl(row.url) || isOsloSnapshot(row)), [savedPositions, showCzechCareer, revealedSavedIds]);
  const visibleApplications = useMemo(() => applications.filter(row => showCzechCareer || !!researchForUrl(row.url) || isOsloSnapshot(row)), [applications, showCzechCareer]);

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
      new Set(applications.filter(a => !!a.url).map(a => careerPositionKey(a.url))),
    [applications],
  );

  const [savedFor, setSavedFor] = useState<SavedJobPosition | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const [loadingCareer, setLoadingCareer] = useState(false);
  const [activationFailed, setActivationFailed] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState<{ message: string; reload: boolean } | null>(null);
  const ownerScope = useOwnerPreferences();
  const lifetime = useRef(new AbortController());
  const pending = useRef(false);
  useLayoutEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    return () => lifetime.current.abort();
  }, []);
  function capture() {
    const original = ownerScope?.capture();
    if (!isPreview && (!original || original.ownerId !== userId)) throw new CareerRefreshError();
    const parent = AbortSignal.any([lifetime.current.signal, ...(original ? [original.signal] : [])]);
    const signal = AbortSignal.any([parent, AbortSignal.timeout(75_000)]);
    signal.throwIfAborted(); return { ownerId: original?.ownerId ?? userId, signal, parent };
  }
  async function loadCareer() {
    if (pending.current) return;
    pending.current = true;
    const panel = lifetime.current.signal;
    let scope: ReturnType<typeof capture> | undefined;
    try {
      scope = capture(); setActivationFailed(false); setLoadingCareer(true);
      const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)]);
      await awaitWithSignal(onActivate(signal), signal); signal.throwIfAborted();
      if (refreshFailure?.reload) await awaitWithSignal(Promise.all([
        qc.invalidateQueries({ queryKey: qk.jobLastRun }),
        qc.invalidateQueries({ queryKey: qk.jobAvailability }),
      ]), signal);
      signal.throwIfAborted(); setRefreshFailure(null);
    } catch { if (!panel.aborted && !scope?.parent.aborted) setActivationFailed(true); }
    finally { pending.current = false; if (!panel.aborted) setLoadingCareer(false); }
  }

  // One explicit captured refresh; no timer, focus refresh or hidden retry.
  async function checkOffers() {
    if (pending.current) return;
    pending.current = true;
    const panel = lifetime.current.signal;
    let scope: ReturnType<typeof capture> | undefined, confirmed = false;
    try {
      scope = capture(); setChecking(true); setRefreshFailure(null);
      if (!isPreview) await refreshCareer(scope);
      scope.signal.throwIfAborted(); confirmed = true;
      const readSignal = AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)]);
      await awaitWithSignal(onActivate(readSignal), readSignal); readSignal.throwIfAborted();
      await awaitWithSignal(Promise.all([
        qc.invalidateQueries({ queryKey: qk.jobLastRun }),
        qc.invalidateQueries({ queryKey: qk.jobAvailability }),
      ]), readSignal);
      readSignal.throwIfAborted(); setActivationFailed(false);
      if (!isPreview) toast.ok(t.jobs.refreshOk);
    } catch (error) {
      if (!panel.aborted && !scope?.parent.aborted) {
        setRefreshFailure({ message: confirmed ? t.jobs.refreshLoadErr : error instanceof CareerRefreshError && error.reason === 'rate-limited' ? t.jobs.refreshRateLimited : t.jobs.refreshErr, reload: confirmed });
        if (confirmed) setActivationFailed(true);
      }
    } finally {
      pending.current = false;
      if (!panel.aborted) setChecking(false);
    }
  }


  return (
    <div className="min-w-0">
      <PageHeader
        title={t.jobs.title}
        description={t.jobs.description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {(cvCs || cvEn) && (
              <div className="flex items-center">
                {showCzechCareer && cvCs && (
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
            {(view !== "open" || !activated) && <Button onClick={() => navigate(() => { setView("open"); void checkOffers(); })} disabled={checking || loadingCareer}><RefreshCw className={cn("size-4",checking && "animate-spin")} aria-hidden />{checking ? t.jobs.checking : t.jobs.checkOffers}</Button>}
            <div className="flex max-w-full flex-wrap rounded-md border border-border bg-surface p-0.5">
              {(["oslo", "open", "saved", "ready", "applied", "letters", "companies"] as const).map(
                (v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => { if (v !== view) navigate(() => { setView(v); if (v !== "oslo" && !activated) void loadCareer(); }); }}
                    className={cn(
                      "min-h-11 rounded px-3 py-1.5 text-sm font-medium transition-colors focus-ring",
                      view === v
                        ? "bg-accent text-foreground"
                        : "text-foreground-muted hover:text-foreground",
                    )}
                  >
                    {v === "oslo"
                      ? "Oslo"
                      : v === "open"
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
                        {!activated && !isPreview ? "—" : v === "applied" ? visibleApplications.length : visibleSaved.filter(row => v === "ready" ? isPositionReady(row) : !isPositionReady(row)).length}
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>
          </div>
        }
      />

      {refreshFailure && (activated || view === "oslo") && <div className="mb-4 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{refreshFailure.message}</p>{refreshFailure.reload && <Button variant="outline" size="sm" onClick={() => void loadCareer()} disabled={checking || loadingCareer}>{loadingCareer ? t.common.loading : t.jobs.refreshReload}</Button>}</div>}

      {view === "oslo" ? (
        <OsloCareerWorkspace activated={activated} onActivate={onActivate} isPreview={isPreview} userId={userId} savedPositions={savedPositions} setSavedPositions={setSavedPositions} applications={applications} onPrepare={position => { setSavedFor(position); setApplyOpen(true); }} />
      ) : !activated ? (
        <Card className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><p role={activationFailed || refreshFailure ? "alert" : "status"} className="min-w-0 flex-1 text-sm">{refreshFailure?.message ?? (activationFailed ? lang === "cs" ? "Uložená Kariéra se nepodařila načíst. Zkuste to znovu." : "Could not load saved Career. Please retry." : lang === "cs" ? "Načítám uloženou Kariéru…" : "Loading saved Career…")}</p><Button variant="outline" className="w-full shrink-0 sm:w-auto" disabled={checking || loadingCareer} onClick={() => void loadCareer()}>{loadingCareer ? t.common.loading : lang === "cs" ? "Načíst znovu" : "Retry loading"}</Button></Card>
      ) : view === "companies" ? (
        <CareerCompanies userId={userId} isPreview={isPreview} />
      ) : view === "letters" ? (
        <><OsloLetterReview /><LetterWorkspace
          templates={templates}
          setTemplates={setTemplates}
          userId={userId}
          applications={visibleApplications}
        /></>
      ) : view === "saved" || view === "ready" ? (
        <SavedPositionsView
          key={view}
          readyOnly={view === "ready"}
          positions={visibleSaved.filter(row => view === "ready" ? isPositionReady(row) : !isPositionReady(row))}
          setPositions={setSavedPositions}
          userId={userId}
          onReveal={id => setRevealedSavedIds(current => new Set([...current, id]))}
          onPrepare={(position) => {
            setSavedFor(position);
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
          checking={checking || loadingCareer}
          onCheck={checkOffers}
        />
      ) : (
        <AppliedView
          timeZone={timeZone}
          applications={visibleApplications}
          setApplications={setApplications}
          savedPositions={visibleSaved}
          events={events}
          setEvents={setEvents}
          templates={templates}
          setTemplates={setTemplates}
          onPrepare={(position) => {
            setSavedFor(position);
            setApplyOpen(true);
          }}
          userId={userId}
        />
      )}

      {applyOpen && savedFor && <ApplyDialog
        key={savedFor.id}
        timeZone={timeZone}
        open={applyOpen}
        onOpenChange={setApplyOpen}
        templates={templates}
        setTemplates={setTemplates}
        setApplications={setApplications}
        setEvents={setEvents}
        userId={userId}
        savedPosition={savedFor}
        setSavedPositions={setSavedPositions}
        onApplied={() => setSavedFor(null)}
      />}
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
  checking,
  onCheck,
}: {
  checking: boolean;
  onCheck: () => Promise<void>;
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
    () => new Set(savedPositions.map((position) => careerPositionKey(position.url))),
    [savedPositions],
  );

  const { lang } = useLang();
  const cs = lang === "cs";
  const { showCzechCareer } = useCzechCareerVisibility();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [workplace, setWorkplace] = useState("all");
  const [seniority, setSeniority] = useState("all");
  const ownerScope = useOwnerPreferences();
  const lifetime = useRef(new AbortController());
  const morePending = useRef(false);
  const [moreFailureBase, setMoreFailureBase] = useState<AvailabilityReceipt | null>(null);
  useLayoutEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    return () => lifetime.current.abort();
  }, []);
  function captureAvailability(parent?: AbortSignal): AvailabilityRequest {
    const scope = ownerScope?.capture();
    if (!scope || scope.ownerId !== userId) throw new CareerAvailabilityError();
    const signal = AbortSignal.any([scope.signal, lifetime.current.signal, ...(parent ? [parent] : [])]);
    signal.throwIfAborted();
    return { ownerId: scope.ownerId, signal, listings: listings.map(row => ({
      id: row.id, source: row.source, title: row.title, url: row.url, last_seen_at: row.last_seen_at,
    })) };
  }
  // No interval/focus/remount refresh. Every accepted state is bound to the
  // original owner and the exact displayed listing version.
  const availability = useQuery({
    queryKey: [...qk.jobAvailability, userId],
    queryFn: ({ signal }): Promise<AvailabilityReceipt> => {
      if (isPreview) return Promise.resolve({
        ownerId: userId, candidateVersion: "preview", previouslyChecked: 0,
        states: Object.fromEntries(listings.map(row => [row.id, "open" as const])),
        versions: Object.fromEntries(listings.map(row => [row.id, { source: row.source, title: row.title, url: row.url, lastSeenAt: row.last_seen_at }])),
        checkedAt: new Date().toISOString(), candidates: listings.length, remaining: 0,
      });
      return readCareerAvailability(captureAvailability(signal));
    },
    retry: false, staleTime: Infinity, gcTime: Infinity,
    // Activation may mount this view before the enclosing refresh invalidates
    // availability. Wait until that whole refresh finishes, then check once.
    enabled: !checking,
    refetchOnMount: false, refetchOnWindowFocus: false,
  });
  const moreChecks = useMutation({
    mutationFn: ({ request }: { request: AvailabilityRequest; base: AvailabilityReceipt }) => readCareerAvailability(request),
    onSuccess: (result, { request, base }) => {
      if (request.signal.aborted) return;
      qc.setQueryData<AvailabilityReceipt>([...qk.jobAvailability, userId], current => {
        // A newer explicit refresh owns the cache. Never merge a late page
        // over its result or combine different discovery snapshots.
        if (current !== base || result.candidateVersion !== base.candidateVersion) return current;
        const states = { ...base.states, ...result.states };
        if (result.candidates !== Object.keys(states).length + result.remaining) return current;
        return { ...result, previouslyChecked: 0, states, versions: { ...base.versions, ...result.versions } };
      });
    },
    onError: (_error, { request, base }) => { if (!request.signal.aborted) setMoreFailureBase(base); },
    onSettled: () => { morePending.current = false; },
  });
  function checkMore() {
    if (morePending.current || checking || availability.isFetching || !availability.data) return;
    morePending.current = true;
    const base = availability.data;
    try {
      const request = captureAvailability();
      const ids = new Set(request.listings.map(row => row.id));
      request.checkedIds = Object.keys(base.states).filter(id => ids.has(id));
      request.previousCheckedAt = base.checkedAt;
      request.expectedVersion = base.candidateVersion;
      setMoreFailureBase(null);
      moreChecks.mutate({ request, base });
    } catch { morePending.current = false; setMoreFailureBase(base); }
  }
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | JobRole>("all");
  const [source, setSource] = useState<string>("all");
  const [sortMode, setSortMode] = useState<
    "fit" | "fit-asc" | "newest" | "remote" | "location"
  >("fit");
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [strongFitOnly, setStrongFitOnly] = useState(false);
  const [shortlistedOnly, setShortlistedOnly] = useState(false);
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
        availability.isFetching ||
        availability.isError ||
        (availability.data?.states[l.id] !== "open" || !availabilityVersionMatches(l, availability.data.versions[l.id]))
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
        if (matchById.get(l.id)?.level !== "strong") return false;
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
    availability.data,
    availability.isFetching,
    availability.isError,
    workplace,
    seniority,
  ]);

  const [pageIndex, setPageIndex] = useState(0);
  const page = collectionPage(visible, pageIndex);
  const pageDetail = page.items.find(row => row.id === detailId) ?? page.items[0];

  const saveAttempts = useRef(new Map<string, { requestId: string; listing: JobListing }>());
  const savingIds = useRef(new Set<string>());
  const [pendingSaves, setPendingSaves] = useState<ReadonlySet<string>>(new Set());
  const [saveIssue, setSaveIssue] = useState<{ listing: JobListing; changed: boolean } | null>(null);
  // The shell already isolates its QueryClient by owner. Match its entity keys.
  const savedQueryKey = qk.savedJobPositions;
  const saveRegion = useRef<HTMLDivElement>(null);
  const saveInteraction = useRef(0);
  const [saveFocus, setSaveFocus] = useState<{ id: string; epoch: number; confirmed: boolean } | null>(null);
  const focusedSave = useRef<typeof saveFocus>(null);
  useLayoutEffect(() => {
    if (!saveFocus || focusedSave.current === saveFocus || pendingSaves.has(saveFocus.id)) return;
    focusedSave.current = saveFocus;
    const root = saveRegion.current;
    if (!root || lifetime.current.signal.aborted || saveInteraction.current !== saveFocus.epoch) return;
    if (document.activeElement !== document.body && document.activeElement && !root.contains(document.activeElement)) return;
    const card = [...root.querySelectorAll<HTMLElement>("[data-career-listing]")].find(element => element.dataset.careerListing === saveFocus.id);
    card?.querySelector<HTMLButtonElement>(saveFocus.confirmed ? "[data-career-open]" : "[data-career-save]")?.focus();
  }, [saveFocus, pendingSaves]);

  async function saveListing(listing: JobListing) {
    if (savingIds.current.size || triageBusy.current) return;
    const original = ownerScope?.capture();
    if (!original || original.ownerId !== userId || original.signal.aborted || lifetime.current.signal.aborted) return;
    const captured = { ownerId: original.ownerId, signal: AbortSignal.any([original.signal, lifetime.current.signal]) };
    const attempt = saveAttempts.current.get(listing.id) ?? { requestId: crypto.randomUUID(), listing: { ...listing } };
    saveAttempts.current.set(listing.id, attempt);
    savingIds.current.add(listing.id); setPendingSaves(new Set(savingIds.current)); setSaveIssue(null);
    const base = savedPositions, epoch = saveInteraction.current;
    try {
      const receipt = await captureCareerListing(supabase, captured, attempt.requestId, attempt.listing);
      await awaitWithSignal(qc.cancelQueries({ queryKey: savedQueryKey, exact: true }), AbortSignal.any([captured.signal, AbortSignal.timeout(5_000)]));
      if (captured.signal.aborted) return;
      setSavedPositions(current => applyCareerSaveReceipt(current, base, receipt));
      saveAttempts.current.delete(listing.id);
      setSaveIssue(null); setSaveFocus({ id: listing.id, epoch, confirmed: true });
      toast.ok(t.jobs.positionSaved);
      void qc.invalidateQueries({ queryKey: savedQueryKey, exact: true, refetchType: "none" });
    } catch (error) {
      if (!captured.signal.aborted) {
        const changed = error instanceof CareerSaveError && error.reason === "changed";
        if (changed) saveAttempts.current.delete(listing.id);
        setSaveIssue({ listing: attempt.listing, changed });
        setSaveFocus({ id: listing.id, epoch, confirmed: false });
      }
    } finally {
      savingIds.current.delete(listing.id);
      if (!captured.signal.aborted) setPendingSaves(new Set(savingIds.current));
    }
  }

  type TriageAttempt = { intents: CareerTriageIntent[]; base: JobUserState[]; removing: boolean; selection: boolean; epoch: number; neighbor: string | null; revealPage: number };
  const triageBusy = useRef(false);
  const [triagePending, setTriagePending] = useState(false);
  const [triageIssue, setTriageIssue] = useState<{ attempt: TriageAttempt | null; reason: "unavailable" | "changed" | "limit" | "reload" } | null>(null);
  const triageQueryKey = qk.jobUserStates;
  const listingQueryKey = qk.jobListings;
  const [triageFocus, setTriageFocus] = useState<{ attempt: TriageAttempt; confirmed: boolean } | { reloaded: boolean; epoch: number } | null>(null);
  const handledTriageFocus = useRef<typeof triageFocus>(null);
  useLayoutEffect(() => {
    if (!triageFocus || handledTriageFocus.current === triageFocus || triagePending) return;
    handledTriageFocus.current = triageFocus;
    const root = saveRegion.current, epoch = "reloaded" in triageFocus ? triageFocus.epoch : triageFocus.attempt.epoch;
    if (!root || lifetime.current.signal.aborted || saveInteraction.current !== epoch) return;
    if (document.activeElement !== document.body && document.activeElement && !root.contains(document.activeElement)) return;
    if ("reloaded" in triageFocus) {
      root.querySelector<HTMLElement>(triageFocus.reloaded ? "[data-career-search]" : "[data-career-triage-recovery]")?.focus();
      return;
    }
    const { attempt, confirmed } = triageFocus;
    const cards = [...root.querySelectorAll<HTMLElement>("[data-career-listing]")];
    const original = cards.find(card => card.dataset.careerListing === attempt.intents[0].listing.id);
    if (!confirmed || !attempt.removing) {
      const target = attempt.selection ? root.querySelector<HTMLButtonElement>("[data-career-delete-selected]") : original?.querySelector<HTMLButtonElement>(attempt.removing ? "[data-career-delete]" : "[data-career-shortlist]");
      (target ?? root.querySelector<HTMLInputElement>("[data-career-search]"))?.focus();
    }
    else {
      const neighbor = cards.find(card => card.dataset.careerListing === attempt.neighbor) ?? cards[0];
      (neighbor?.querySelector<HTMLButtonElement>("[data-career-open]") ?? root.querySelector<HTMLInputElement>("[data-career-search]"))?.focus();
    }
  }, [triageFocus, triagePending]);
  function triageScope() {
    const original = ownerScope?.capture();
    if (!original || original.ownerId !== userId) return null;
    return { ownerId: original.ownerId, signal: AbortSignal.any([original.signal, lifetime.current.signal]) };
  }
  async function performTriage(attempt: TriageAttempt, captured: CareerScope) {
    try {
      captured.signal.throwIfAborted(); setTriageIssue(null);
      const receipt = await applyCareerTriage(supabase, captured, attempt.intents);
      await awaitWithSignal(qc.cancelQueries({ queryKey: triageQueryKey, exact: true }), AbortSignal.any([captured.signal, AbortSignal.timeout(5_000)]));
      if (captured.signal.aborted) return;
      setUserStates(current => applyCareerTriageReceipt(current, attempt.base, receipt));
      if (attempt.removing) {
        const ids = new Set(attempt.intents.map(item => item.listing.id));
        setSelected(current => new Set([...current].filter(id => !ids.has(id))));
        toast.ok(t.jobs.listingDeleted);
      }
      if (attempt.removing && saveInteraction.current === attempt.epoch) setPageIndex(attempt.revealPage);
      setTriageFocus({ attempt, confirmed: true });
      void qc.invalidateQueries({ queryKey: triageQueryKey, exact: true, refetchType: "none" });
    } catch (error) {
      if (!captured.signal.aborted) {
        setTriageIssue({ attempt, reason: error instanceof CareerTriageError ? error.reason : "unavailable" });
        setTriageFocus({ attempt, confirmed: false });
      }
    }
  }
  async function startTriage(rows: JobListing[], removing: boolean, fromSelection = false) {
    if (!rows.length || triageBusy.current || savingIds.current.size) return;
    const captured = triageScope(); if (!captured || captured.signal.aborted) return;
    if (rows.length > 1000) { setTriageIssue({ attempt: null, reason: "limit" }); return; }
    triageBusy.current = true; setTriagePending(true);
    const ids = new Set(rows.map(row => row.id));
    const firstRemoved = Math.max(0, visible.findIndex(row => ids.has(row.id)));
    const neighbors = [...visible.slice(firstRemoved + 1), ...visible.slice(0, firstRemoved).reverse()];
    const neighbor = neighbors.find(row => !ids.has(row.id))?.id ?? null;
    const remaining = visible.filter(row => !ids.has(row.id));
    const attempt: TriageAttempt = {
      intents: rows.map(listing => {
        const existing = stateByListing.get(listing.id);
        return { id: crypto.randomUUID(), listing: { id: listing.id, url: listing.url, last_seen_at: listing.last_seen_at },
          next: removing ? "deleted" : existing?.state === "shortlisted" ? null : "shortlisted", existing: existing ? { ...existing } : null };
      }),
      base: userStates, removing, selection: fromSelection, epoch: saveInteraction.current,
      neighbor, revealPage: Math.max(0, Math.floor(remaining.findIndex(row => row.id === neighbor) / 50)),
    };
    try {
      if (removing && !await confirm({ title: t.jobs.deleteListingsTitle, description: t.jobs.deleteListingsDescription(rows.length), confirmLabel: t.jobs.deleteSelected(rows.length), cancelLabel: t.common.cancel, destructive: true })) { if (!captured.signal.aborted) setTriageFocus({ attempt, confirmed: false }); return; }
      if (!captured.signal.aborted) await performTriage(attempt, captured);
    } finally { triageBusy.current = false; if (!captured.signal.aborted) setTriagePending(false); }
  }
  async function recoverTriage() {
    if (!triageIssue || triageBusy.current || savingIds.current.size) return;
    const epoch = saveInteraction.current;
    if (triageIssue.reason === "limit") {
      setSelected(new Set()); setTriageIssue(null); setTriageFocus({ reloaded: true, epoch }); return;
    }
    const captured = triageScope(); if (!captured || captured.signal.aborted) return;
    triageBusy.current = true; setTriagePending(true);
    try {
      if (triageIssue.reason === "unavailable" && triageIssue.attempt) {
        await performTriage({ ...triageIssue.attempt, epoch }, captured);
      } else {
        // `listings` is the displayed relevant subset, not the shell's complete
        // cached collection. Guard the actual canonical snapshots instead.
        const base = qc.getQueryData<JobUserState[]>(triageQueryKey);
        const knownListings = qc.getQueryData<JobListing[]>(listingQueryKey), operation = new AbortController();
        const request = { ownerId: captured.ownerId, signal: AbortSignal.any([captured.signal, operation.signal]) };
        try {
          const [states, offers] = await Promise.all([
            readCareerRecords(supabase, "job_user_state", request), readCareerRecords(supabase, "job_listings", request),
          ]);
          const cancelSignal = AbortSignal.any([captured.signal, AbortSignal.timeout(5_000)]);
          await awaitWithSignal(Promise.all([
            qc.cancelQueries({ queryKey: triageQueryKey, exact: true }),
            qc.cancelQueries({ queryKey: listingQueryKey, exact: true }),
          ]), cancelSignal);
          if (captured.signal.aborted) return;
          if (qc.getQueryData(triageQueryKey) !== base || qc.getQueryData(listingQueryKey) !== knownListings) throw new CareerTriageError();
          setUserStates(current => current === base ? states.data : current);
          qc.setQueryData<JobListing[]>(listingQueryKey, current => current === knownListings ? offers.data : current);
          setSelected(new Set()); setTriageIssue(null);
          if (saveInteraction.current === epoch) setPageIndex(0);
          setTriageFocus({ reloaded: true, epoch });
        } finally { operation.abort(); }
      }
    } catch {
      if (!captured.signal.aborted) {
        setTriageIssue(current => current ? { ...current, reason: "reload" } : current);
        setTriageFocus({ reloaded: false, epoch });
      }
    } finally { triageBusy.current = false; if (!captured.signal.aborted) setTriagePending(false); }
  }
  function toggleState(listing: JobListing) { void startTriage([listing], false); }
  function deleteListings(rows: JobListing[], fromSelection = false) { return startTriage(rows, true, fromSelection); }

  const lastRunAt = lastRun?.finished_at ?? lastRun?.started_at ?? null;
  const failedSources = Object.entries(lastRun?.sources ?? {}).filter(
    ([, o]) => o.error,
  );

  return (
    <div ref={saveRegion} onPointerDownCapture={() => { saveInteraction.current++; }} onKeyDownCapture={() => { saveInteraction.current++; }} className="min-w-0">
      <div className="mb-4 border-l-2 border-primary pl-4 text-sm leading-relaxed">
        <p className="font-medium">React · TypeScript · Next.js · Node.js</p>
        <p className="text-foreground-muted">
          {showCzechCareer
            ? cs ? "Frontend a fullstack. Oslo, Praha a odpovídající nabídky na dálku. Junior, medior i senior." : "Frontend and fullstack. Oslo, Prague and compatible remote roles. Junior, medior and senior."
            : cs ? "Frontend a fullstack. Oslo a nabídky na dálku slučitelné s prací z Norska. Junior, medior i senior." : "Frontend and fullstack. Oslo and remote roles compatible with Norway. Junior, medior and senior."}
        </p>
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        <SimpleSelect
          value={workplace}
          onValueChange={value => { setWorkplace(value); setPageIndex(0); }}
          className="w-full sm:w-48"
          aria-label={cs ? "Místo práce" : "Work location"}
          options={[
            { value: "all", label: showCzechCareer ? (cs ? "Oslo, Praha i remote" : "Oslo, Prague + remote") : "Oslo + remote" },
            ...(showCzechCareer ? [{ value: "prague", label: "Praha" }] : []),
            { value: "remote", label: "Remote" },
          ]}
        />
        <SimpleSelect
          value={seniority}
          onValueChange={value => { setSeniority(value); setPageIndex(0); }}
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
              data-career-search
              aria-label={t.jobs.searchPlaceholder}
              placeholder={t.jobs.searchPlaceholder}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPageIndex(0); }}
              className="h-9 pl-8 text-sm"
            />
          </div>
          <SimpleSelect
            value={role}
            onValueChange={(v) => { setRole(v as "all" | JobRole); setPageIndex(0); }}
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
            onValueChange={value => { setSource(value); setPageIndex(0); }}
            className="h-9 w-auto min-w-32 text-xs"
            aria-label={t.jobs.sourceAll}
            options={[
              { value: "all", label: t.jobs.sourceAll },
              ...sources.map((s) => ({ value: s, label: jobSourceLabel(s) })),
            ]}
          />
          <SimpleSelect
            value={sortMode}
            onValueChange={(v) => { setSortMode(v as typeof sortMode); setPageIndex(0); }}
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
            onClick={() => { setPriorityOnly((v) => !v); setPageIndex(0); }}
            icon={Target}
            label={t.jobs.priorityOnly}
          />
          <FilterToggle
            active={strongFitOnly}
            onClick={() => { setStrongFitOnly((v) => !v); setPageIndex(0); }}
            icon={Check}
            label={t.jobs.strongFitOnly}
          />
          <FilterToggle
            active={shortlistedOnly}
            onClick={() => { setShortlistedOnly((v) => !v); setPageIndex(0); }}
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
                data-career-delete-selected
                onClick={() =>
                  void deleteListings(
                    listings.filter((listing) => selected.has(listing.id)),
                    true,
                  )
                }
                disabled={triagePending || pendingSaves.size > 0}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t.jobs.deleteSelected(selected.size)}
              </Button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
          <span role="status" className="tabular">{visible.length} {t.jobs.listingsShown}</span>
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
            onClick={() => void onCheck()}
            disabled={checking || moreChecks.isPending}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", checking && "animate-spin")}
            />
            {checking ? t.jobs.checking : t.jobs.checkOffers}
          </Button>
        </div>
      </div>

      <JobSources lastRun={lastRun} />

      <div className="my-4 text-sm" role="status">
        {isPreview ? (
          cs ? (
            "Ukázková data. Dostupnost se zde neověřuje."
          ) : (
            "Demo data. Availability is not checked here."
          )
        ) : checking ? (
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
        <div className={cn("mb-4", moreFailureBase === availability.data && "mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-md border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between")}>
        {moreFailureBase === availability.data && <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">{cs ? "Další nabídky se nepodařilo potvrdit. Zkuste je ověřit znovu, nebo znovu načtěte aktuální nabídky." : "Could not confirm the next listings. Retry the check or check for new offers again."}</p>}
        <Button
          variant="outline"
          className={moreFailureBase === availability.data ? "w-full shrink-0 sm:w-auto" : undefined}
          disabled={moreChecks.isPending || checking}
          onClick={checkMore}
        >
          {moreChecks.isPending
            ? cs
              ? "Ověřuji…"
              : "Checking…"
            : cs
              ? `Ověřit další nabídky (${availability.data.remaining})`
              : `Check more listings (${availability.data.remaining})`}
        </Button>
        </div>
      )}
      {saveIssue && <CareerActionNotice message={saveIssue.changed ? t.jobs.saveListingChanged : t.jobs.saveUnconfirmed}>
        <Button variant="outline" className="w-full shrink-0 sm:w-auto" disabled={pendingSaves.size > 0 || triagePending || checking} onClick={() => saveIssue.changed ? void onCheck() : void saveListing(saveIssue.listing)}>{saveIssue.changed ? t.jobs.checkOffers : t.common.retry}</Button>
      </CareerActionNotice>}
      {triageIssue && <CareerActionNotice message={triageIssue.reason === "limit" ? t.jobs.triageLimit : triageIssue.reason === "changed" ? t.jobs.triageChanged : triageIssue.reason === "reload" ? t.jobs.triageReloadFailed : t.jobs.triageUnconfirmed}>
        <Button data-career-triage-recovery variant="outline" className="w-full shrink-0 sm:w-auto" disabled={triagePending || pendingSaves.size > 0} onClick={() => void recoverTriage()}>{triagePending ? t.jobs.checking : triageIssue.reason === "limit" ? t.jobs.clearSelection : triageIssue.reason === "unavailable" ? t.common.retry : t.jobs.triageReload}</Button>
      </CareerActionNotice>}
      {listings.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={BriefcaseBusiness}
            title={t.jobs.noListingsYet}
            description={t.jobs.noListingsDescription}
            action={
              <Button size="sm" onClick={() => void onCheck()} disabled={checking || moreChecks.isPending}>
                <RefreshCw
                  className={cn("h-3.5 w-3.5", checking && "animate-spin")}
                />
                {checking ? t.jobs.checking : t.jobs.checkOffers}
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
          <CareerPagination page={page} onPage={setPageIndex} label={t.jobs.listingPages} />
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,2fr)_minmax(360px,3fr)]">
            <div className="min-w-0 divide-y divide-border rounded-md border border-border bg-surface">
              {page.items.map((l) => (
                <ListingRow
                  key={l.id}
                  listing={l}
                  match={matchById.get(l.id)}
                  state={stateByListing.get(l.id)?.state}
                  applied={
                    appliedListingIds.has(l.id) || appliedUrls.has(careerPositionKey(l.url))
                  }
                  saved={savedListingIds.has(l.id) || savedUrls.has(careerPositionKey(l.url))}
                  selected={selected.has(l.id)}
                  onSelect={() =>
                    setSelected((old) => {
                      const next = new Set(old);
                      if (next.has(l.id)) next.delete(l.id);
                      else next.add(l.id);
                      return next;
                    })
                  }
                  onShortlist={() => toggleState(l)}
                  onDelete={() => void deleteListings([l])}
                  pending={pendingSaves.has(l.id)}
                  triagePending={triagePending || pendingSaves.size > 0}
                  onApply={() => void saveListing(l)}
                  onDetail={() => {
                    setDetailId(l.id);
                    if (window.matchMedia("(max-width: 1279px)").matches)
                      setMobileDetail(true);
                  }}
                  active={pageDetail?.id === l.id}
                />
              ))}
            </div>
            <div className="hidden min-w-0 xl:block">
              {(() => {
                const detail =
                  pageDetail;
                return detail ? (
                  <CareerJobDetails
                    listing={detail}
                    saved={savedListingIds.has(detail.id) || savedUrls.has(careerPositionKey(detail.url))}
                    pending={pendingSaves.has(detail.id)}
                    blocked={triagePending || pendingSaves.size > 0}
                    onApply={() => void saveListing(detail)}
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
                      saved={savedListingIds.has(detail.id) || savedUrls.has(careerPositionKey(detail.url))}
                      pending={pendingSaves.has(detail.id)}
                      blocked={triagePending || pendingSaves.size > 0}
                      onApply={() => {
                        setMobileDetail(false);
                        void saveListing(detail);
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
  pending,
  triagePending,
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
  pending: boolean;
  triagePending: boolean;
  selected: boolean;
  onSelect: () => void;
  onShortlist: () => void;
  onDelete: () => void;
  onApply: () => void;
  onDetail: () => void;
  active: boolean;
}) {
  const t = useDict();
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} data-career-listing={listing.id} className={cn("min-w-0 p-4", active && "bg-accent/50")}>
      <div className="flex items-start gap-3">
        <Checkbox
          disabled={triagePending}
          checked={selected}
          onCheckedChange={onSelect}
          aria-label={listing.title}
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            id={titleId}
            data-career-open
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
          data-career-shortlist aria-describedby={titleId} disabled={triagePending} onClick={onShortlist}
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
          data-career-delete aria-describedby={titleId} disabled={triagePending} onClick={onDelete}
          aria-label={t.jobs.deleteListing}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button aria-describedby={titleId} data-career-save size="sm" className="ml-auto" onClick={onApply} disabled={saved || applied || pending || triagePending}>
          <Bookmark className="h-4 w-4" />
          {pending ? t.jobs.saving : saved ? t.jobs.savedBadge : t.jobs.savePosition}
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
    remote: snapshotRemote(position),
    salary: null,
    tags: [],
    seniority: null,
    description: position.description,
    posted_at: null,
    first_seen_at: position.saved_at,
    last_seen_at: position.updated_at,
  };
}

/* ========================================================================= *
 * Apply dialog — captured Saved position                                  *
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
  timeZone,
  open,
  onOpenChange,
  templates,
  setTemplates,
  setApplications,
  setEvents,
  userId,
  savedPosition,
  setSavedPositions,
  onApplied,
}: {
  timeZone: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  setApplications: Updater<JobApplication[]>;
  setEvents: Updater<JobApplicationEvent[]>;
  userId: string;
  savedPosition: SavedJobPosition;
  setSavedPositions: Updater<SavedJobPosition[]>;
  onApplied: () => void;
}) {
  const t = useDict();
  const now = useNow();
  const today = now ? focusDayKey(now, timeZone) : todayIso(timeZone);
  const cs = useLang().lang === "cs";
  const toast = useToast();
  const requestExit = useGuardedNavigation();
  const draft = useCareerApplicationDraft({source:savedPosition,userId,day:today,setSavedPositions,setApplications,setEvents,
    onRecorded:()=>{toast.ok(t.jobs.applicationSaved);requestExit(()=>{onOpenChange(false);onApplied();});},
    onDraftSaved:()=>toast.ok(t.jobs.draftSaved)});
  const {form,update,pending,failure,locked}=draft;
  const listing=useMemo(()=>savedToListing(draft.reviewedSource),[draft.reviewedSource]);
  const message=draft.reloadFailed?(cs?"Pozici se nepodařilo načíst. Koncept zůstal zachovaný.":"The position could not be loaded. Your draft is kept.")
    :failure?.reason==='changed'?(cs?"Uložená pozice se změnila. Koncept zůstal zachovaný. Před pokračováním načtěte aktuální pozici.":"The saved position changed. Your draft is kept. Load the current position before continuing.")
    :failure?.reason==='invalid'?(cs?"Zkontrolujte název, délku údajů, odkazy a datum odeslání.":"Check the title, field lengths, links and application date.")
    :failure?(cs?"Uložení není potvrzené. Zkuste znovu stejný požadavek; koncept zůstal zachovaný.":"The save is unconfirmed. Retry the same request; your draft is kept."):null;
  function close(next:boolean){if(!next)requestExit(()=>onOpenChange(false));}
  function submit(event:React.FormEvent){event.preventDefault();draft.record();}

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-3xl" aria-busy={pending!==null}>
        <DialogTitle>
          {listing ? t.jobs.applyTitle : t.jobs.logManualTitle}
        </DialogTitle>
        {listing && (
          <p className="mt-1 truncate text-xs text-foreground-muted">
            {listing.source==='manual'?(cs?'Ručně uložená pozice':'Manually saved position'):jobSourceLabel(listing.source)}
          </p>
        )}
        {listing && <ApplyFitSummary listing={listing} />}
        <form onSubmit={submit} className="mt-3 space-y-3">
          <fieldset disabled={pending!==null} className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="job-app-title">{t.jobs.position}</Label>
              <Input
                id="job-app-title"
                value={form.title} readOnly={locked}
                onChange={(e) =>
                  update({title: e.target.value})
                }
                placeholder={t.jobs.positionPlaceholder}
                maxLength={300}
                autoFocus={!listing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-app-company">{t.jobs.company}</Label>
              <Input
                id="job-app-company"
                value={form.company} readOnly={locked}
                onChange={(e) =>
                  update({company: e.target.value})
                }
                placeholder={t.jobs.companyPlaceholder}
                maxLength={500}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="job-app-url">{t.jobs.link}</Label>
              <Input
                id="job-app-url"
                type="url"
                value={form.url} readOnly={locked}
                onChange={(e) =>
                  update({url: e.target.value})
                }
                placeholder="https://…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-app-date">{t.jobs.appliedOn}</Label>
              <Input
                id="job-app-date"
                type="date"
                value={form.appliedOn} readOnly={locked}
                max={today}
                onChange={(e) =>
                  update({appliedOn: e.target.value})
                }
              />
            </div>
          </div>

          <div className="space-y-1.5"><Label htmlFor="cover-letter-drive">{cs?"Dopis na Google Drive":"Cover letter on Google Drive"}</Label><Input id="cover-letter-drive" type="url" value={form.coverLetterUrl} readOnly={locked} onChange={event=>update({coverLetterUrl:event.target.value})} placeholder="https://docs.google.com/document/d/…"/>
          {form.coverLetterUrl && isGoogleLetterUrl(form.coverLetterUrl) && <a className="inline-flex min-h-11 items-center text-sm underline focus-ring" href={form.coverLetterUrl} target="_blank" rel="noopener noreferrer">{cs?"Otevřít dokument":"Open document"}</a>}</div>
          {savedPosition && <SimpleSelect disabled={locked} value={form.readiness} onValueChange={readiness=>update({readiness:readiness as NonNullable<SavedJobPosition["readiness"]>})} aria-label={cs?"Připravenost přihlášky":"Application readiness"} options={["draft","ready","needs_review"].map(value=>({value,label:readinessLabel(value,cs)}))}/>}
          <p className="text-sm text-foreground-muted">{cs?"Po odeslání přihlášky na webu firmy zde potvrďte datum. Tlačítko níže pouze uloží záznam o odeslání.":"After applying on the employer website, confirm the date here. The button below only records that you sent the application."}</p>
          <CoverLetterField
            readOnly={locked}
            description={listing?.description ?? undefined}
            value={form.coverLetter}
            onChange={(v) => update({coverLetter:v})}
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
              value={form.notes} readOnly={locked}
              onChange={(e) =>
                update({notes: e.target.value})
              }
              placeholder={t.jobs.notesPlaceholder}
              rows={2}
              className="text-xs"
            />
          </div>

          </fieldset>
          {message&&<CareerActionNotice message={message}><div className="flex flex-wrap gap-2">
            {failure?.reason==='unavailable'&&<Button type="button" variant="outline" disabled={pending!==null} onClick={draft.retry}>{cs?'Zkusit znovu':'Try again'}</Button>}
            {failure&&failure.reason!=='invalid'&&<Button type="button" variant="outline" disabled={pending!==null} onClick={()=>void draft.reload()}>{cs?'Zahodit koncept a načíst aktuální':'Discard draft and load latest'}</Button>}
          </div></CareerActionNotice>}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                {t.jobs.cancel}
              </Button>
            </DialogClose>
            {savedPosition && (
              <Button type="button" variant="outline" size="sm" onClick={() => void draft.saveDraft()} disabled={locked}>
                {pending ? t.jobs.saving : t.jobs.saveDraft}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={locked}>
              <Check className="h-3.5 w-3.5" />
              {pending
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
  readOnly = false,
  showLabel = true,
  helperRevision = 0,
  protectContext = false,
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
  readOnly?: boolean;
  showLabel?: boolean;
  helperRevision?: number;
  protectContext?: boolean;
}) {
  const t = useDict();
  const { lang } = useLang();
  const { showCzechCareer } = useCzechCareerVisibility();
  const [letterLanguage, setLetterLanguage] = useState<LetterLanguage>(showCzechCareer ? lang : "en");
  const [draftName, setDraftName] = useState("");
  const [guidanceOpen, setGuidanceOpen] = useState(() => !value.trim());
  const [guidanceMounted, setGuidanceMounted] = useState(() => !value.trim());
  const locale = useDateLocale();
  const pickerId=useId(),[pickerOpen,setPickerOpen]=useState(false);
  const toast = useToast();

  function loadTemplate(body:string){
    if(readOnly||templateLocked)return false;
    if(value.trim()&&!window.confirm(t.jobs.overwriteLetterConfirm))return false;
    changeLetter(fillTemplate(body,{...vars,date:format(new Date(),"PPP",{locale})}));return true;
  }

  const templateWriter=useCareerTemplateWrite({userId,setTemplates});
  const [templateAttempt,setTemplateAttempt]=useState<{name:string;body:string}|null>(null),templateAttemptRef=useRef<typeof templateAttempt>(null),templateId=useRef<string|null>(null),nameRef=useRef("");
  const initialContext={body:value,position:vars.position??'',company:vars.company??''};
  const currentContext=useRef(initialContext),baselineContext=useRef(initialContext),attemptContext=useRef<typeof initialContext|null>(null);
  useLayoutEffect(()=>{currentContext.current={body:value,position:vars.position??'',company:vars.company??''};},[value,vars.position,vars.company]);
  function matchesContext(a:typeof currentContext.current,b:typeof currentContext.current){return a.body===b.body&&a.position===b.position&&a.company===b.company;}
  const templateLocked=templateWriter.pending!==null||!!templateWriter.failure&&templateWriter.failure.reason!=='invalid';
  function changeLetter(body:string){if(readOnly||templateWriter.isPending())return false;currentContext.current={...currentContext.current,body};onChange(body);if(templateWriter.failure?.reason==='invalid')templateWriter.clearFailure();return true;}
  function confirmedTemplate(){const saved=attemptContext.current;if(saved)baselineContext.current=saved;attemptContext.current=null;templateAttemptRef.current=null;setTemplateAttempt(null);templateId.current=null;nameRef.current="";setDraftName("");toast.ok(t.jobs.templateSaved);return !protectContext||!!saved&&matchesContext(currentContext.current,saved);}
  async function saveAsTemplate(){
    if(templateWriter.isPending()||templateWriter.failure||!value.trim())return false;
    const defaultName=`[${letterLanguage.toUpperCase()}] ${vars.company || (lang === "cs" ? "Firma" : "Company")} · ${vars.position || (lang === "cs" ? "Dopis" : "Letter")} · ${new Date().toISOString().slice(0,10)}`;
    const fields={name:nameRef.current.trim()||defaultName.slice(0,CAREER_TEMPLATE_NAME_MAX).replace(/[\uD800-\uDBFF]$/u,''),body:value};
    templateId.current??=crypto.randomUUID();templateAttemptRef.current=fields;attemptContext.current={body:value,position:vars.position??'',company:vars.company??''};setTemplateAttempt(fields);
    const receipt=await templateWriter.create(templateId.current,fields);if(!receipt||!templateWriter.isCurrent())return false;return confirmedTemplate();
  }
  async function retryTemplate(){const receipt=await templateWriter.retry();if(receipt&&templateWriter.isCurrent())confirmedTemplate();}
  useUnsavedDraft({get dirty(){return !!nameRef.current.trim()||templateAttemptRef.current!==null||protectContext&&!matchesContext(currentContext.current,baselineContext.current);},canSave:!templateWriter.failure&&!!value.trim()&&value.length<=CAREER_TEMPLATE_BODY_MAX,save:saveAsTemplate,discard:()=>{baselineContext.current=currentContext.current;attemptContext.current=null;templateAttemptRef.current=null;templateId.current=null;nameRef.current="";setTemplateAttempt(null);setDraftName("");templateWriter.clearFailure();}});

  return (
    <div className="space-y-4">
      {pickerOpen&&<CareerTemplatePicker id={pickerId} templates={templates} language={letterLanguage} onSelect={loadTemplate} onClose={()=>setPickerOpen(false)}/>}
      <fieldset className="min-w-0 space-y-4">
      <details open={guidanceOpen} onToggle={event=>{const open=event.currentTarget.open;setGuidanceOpen(open);if(open)setGuidanceMounted(true);}}>
      <summary className="min-h-11 cursor-pointer rounded-sm py-3 text-sm font-medium focus-ring">{t.jobs.letterGuidance}</summary>
      {guidanceMounted&&<CareerLetterHelper
        key={`${helperRevision}:${description ?? id}`}
        position={vars.position ?? ""}
        company={vars.company ?? ""}
        description={description}
        value={value}
        onChange={changeLetter}
        readOnly={readOnly||templateWriter.pending!==null}
        language={letterLanguage}
        onLanguageChange={setLetterLanguage}
      />}
      </details>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} className={showLabel?undefined:'sr-only'}>{t.jobs.coverLetter}</Label>
        <div data-career-letter-toolbar className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" role="combobox" aria-haspopup="dialog" aria-expanded={pickerOpen} aria-controls={pickerOpen?pickerId:undefined} aria-label={t.jobs.loadTemplate} disabled={readOnly||templateLocked} className="w-full justify-between sm:w-auto sm:min-w-36" onClick={()=>setPickerOpen(true)}><span>{t.jobs.loadTemplate}</span><ChevronDown className="h-4 w-4 text-foreground-muted"/></Button>
          <Input
            value={draftName}
            readOnly={templateLocked}
            onChange={(e) => {if(templateWriter.isPending())return;nameRef.current=e.target.value;setDraftName(e.target.value);templateWriter.clearFailure();}}
            maxLength={150}
            className="w-full sm:w-40"
            aria-label={t.jobs.templateName}
            placeholder={t.jobs.templateName}
          />
          <Button
            type="button"
            variant="outline"
            onClick={()=>void saveAsTemplate()}
            disabled={!value.trim()||templateLocked}
          >
            <Plus className="h-3 w-3" />
            {t.jobs.saveAsTemplate}
          </Button>
        </div>
      </div>
      <CareerTemplateFailure writer={templateWriter} onRetry={()=>void retryTemplate()}/>
      {templateAttempt&&templateWriter.failure&&templateAttempt.body!==value&&<div className="space-y-1.5"><Label htmlFor={`${id}-template-attempt`}>{lang==='cs'?'Dopis z nepotvrzeného uložení šablony':'Letter from the unconfirmed template save'}</Label><Textarea id={`${id}-template-attempt`} readOnly value={templateAttempt.body} rows={3}/></div>}
      <Textarea
        readOnly={readOnly||templateWriter.pending!==null}
        id={id}
        value={value}
        onChange={(e) => changeLetter(e.target.value)}
        placeholder={t.jobs.coverLetterPlaceholder}
        rows={6}
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
  timeZone,
  applications,
  setApplications,
  savedPositions,
  events,
  setEvents,
  templates,
  setTemplates,
  onPrepare,
  userId,
}: {
  timeZone: string;
  applications: JobApplication[];
  setApplications: Updater<JobApplication[]>;
  savedPositions: SavedJobPosition[];
  events: JobApplicationEvent[];
  setEvents: Updater<JobApplicationEvent[]>;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  onPrepare: (position: SavedJobPosition) => void;
  userId: string;
}) {
  const t = useDict();
  const cs = useLang().lang === "cs";
  const [search, setSearch] = useState("");
  const [since, setSince] = useState("");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [responseFilter, setResponseFilter] = useState("all");
  const [progressFor, setProgressFor] = useState<JobApplication | null>(null);
  const cohort = useMemo(()=>applications.filter(row=>(!since || row.applied_on >= since) && `${row.company} ${row.title}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())),[applications,since,search]);
  const visible = useMemo(() => cohort.filter(row=>responseFilter === "all" || (responseFilter === "responded" ? !!row.responded_on : !row.responded_on)), [cohort, responseFilter]);
  const [pageIndex, setPageIndex] = useState(0);
  const page = collectionPage(visible, pageIndex);
  const eventsByApplication = useMemo(() => {
    const index = new Map<string, JobApplicationEvent[]>();
    for (const event of events) {
      const group = index.get(event.application_id);
      if (group) group.push(event);
      else index.set(event.application_id, [event]);
    }
    return index;
  }, [events]);

  // The board's "Saved" column holds positions that have no application yet, so
  // the applied-date and response filters cannot apply to them; the search box
  // still does.
  const visibleSaved = useMemo(()=>savedPositions.filter(row=>`${row.company} ${row.title}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())),[savedPositions,search]);
  const toast = useToast();
  const confirm = useConfirmation();

  const now = useNow();
  const stats = useMemo(() => applicationStats(cohort, now ?? new Date(), timeZone), [cohort, now, timeZone]);
  const [letterFor, setLetterFor] = useState<JobApplication | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const actionActivity=useRef(0);

  const progressWriter=useCareerProgressWrite({userId,setApplications,setEvents});
  async function changeStatus(app:JobApplication,status:JobApplicationStatus){
    const receipt=await progressWriter.perform(app,{status});
    if(!receipt||!progressWriter.isCurrent())throw new Error('Career change unconfirmed');
    toast.ok(t.jobs.statusUpdated);
  }
  const progressMessage=progressWriter.reloadFailed?(cs?'Přihlášky se nepodařilo načíst. Zkuste to znovu.':'Applications could not be loaded. Try again.')
    :progressWriter.failure?.reason==='changed'?(cs?'Přihláška se změnila. Změna stavu není potvrzená. Načtěte aktuální přihlášky.':'The application changed. The stage change is unconfirmed. Reload current applications.')
    :progressWriter.failure?t.jobs.couldNotSave:null;

  const recordWriter=useCareerApplicationRecordWrite({userId,setApplications,setEvents});
  function restoreRemovalFocus(control:HTMLButtonElement,epoch:number,target:string|null|undefined){
    requestAnimationFrame(()=>{
      if(!recordWriter.isCurrent()||epoch!==actionActivity.current||document.activeElement!==document.body&&document.activeElement!==control)return;
      if(target===undefined&&control.isConnected){control.focus();return;}
      const next=target?document.querySelector<HTMLElement>(`[data-career-application="${target}"] [data-career-application-title]`):null;
      (next??(target===undefined?document.querySelector<HTMLElement>('[data-career-removal-reload]'):null)??document.querySelector<HTMLElement>('[data-career-application-search]'))?.focus();
    });
  }
  async function removeApplication(app:JobApplication,control:HTMLButtonElement){
    const epoch=actionActivity.current,index=visible.findIndex(row=>row.id===app.id),neighbor=visible[index+1]??visible[index-1];
    const receipt=await recordWriter.remove(app,()=>confirm({title:t.jobs.deleteApplication,description:t.jobs.deleteApplicationConfirm,confirmLabel:t.common.delete,cancelLabel:t.common.cancel,destructive:true}));
    if(!recordWriter.isCurrent())return;if(receipt)toast.ok(t.jobs.applicationDeleted);
    restoreRemovalFocus(control,epoch,receipt?neighbor?.id??null:undefined);
  }
  async function retryRemoval(control:HTMLButtonElement){
    const epoch=actionActivity.current,index=visible.findIndex(row=>row.id===recordWriter.failure?.source.id),neighbor=visible[index+1]??visible[index-1],receipt=await recordWriter.retry();
    if(!recordWriter.isCurrent())return;if(receipt)toast.ok(t.jobs.applicationDeleted);
    restoreRemovalFocus(control,epoch,receipt?neighbor?.id??null:undefined);
  }
  const removalMessage=recordWriter.reloadFailed?(cs?'Přihlášky se nepodařilo načíst. Zkuste to znovu.':'Applications could not be loaded. Try again.')
    :recordWriter.failure?.reason==='changed'?(cs?'Přihláška se změnila nebo už neexistuje. Odebrání není potvrzené. Načtěte aktuální přihlášky.':'The application changed or is no longer available. Removal is unconfirmed. Reload current applications.')
    :recordWriter.failure?t.jobs.couldNotDelete:null;

  const statusLabel: Record<JobApplicationStatus, string> = {
    applied: t.jobs.statusApplied,
    interviewing: t.jobs.statusInterviewing,
    offer: t.jobs.statusOffer,
    rejected: t.jobs.statusRejected,
    withdrawn: t.jobs.statusWithdrawn,
  };

  return (
    <div onPointerDownCapture={()=>{actionActivity.current++;}} onKeyDownCapture={()=>{actionActivity.current++;}}>
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
      <div className="mb-4 flex flex-wrap items-end gap-3"><Input data-career-application-search value={search} onChange={event=>{ setSearch(event.target.value); setPageIndex(0); }} className="max-w-sm" aria-label={cs?"Hledat odeslané přihlášky":"Search sent applications"} placeholder={cs?"Firma nebo pozice":"Company or position"}/>
      <div><Label htmlFor="applications-since">{cs?"Odesláno od":"Applied since"}</Label><Input id="applications-since" type="date" value={since} onChange={event=>{ setSince(event.target.value); setPageIndex(0); }}/></div>
      <SimpleSelect value={responseFilter} onValueChange={value=>{ setResponseFilter(value); setPageIndex(0); }} aria-label={cs?"Filtrovat odpovědi":"Filter responses"} options={[{value:"all",label:cs?"Všechny přihlášky":"All applications"},{value:"responded",label:cs?"S odpovědí":"With response"},{value:"waiting",label:cs?"Bez odpovědi":"Without response"}]}/></div>
      {/* toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <div role="group" aria-label={t.jobs.layoutLabel} className="flex rounded-md border border-border bg-surface p-0.5">
          {([["list", t.jobs.listView], ["board", t.jobs.boardView]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setLayout(value)}
              aria-pressed={layout === value}
              className={cn(
                "min-h-11 rounded px-3 py-1.5 text-sm font-medium transition-colors focus-ring",
                layout === value ? "bg-accent text-foreground" : "text-foreground-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setTemplatesOpen(true)}
        >
          <Files className="h-3.5 w-3.5" />
          {t.jobs.manageTemplates}
        </Button>
      </div>

      {progressMessage&&<CareerActionNotice message={progressMessage}><div className="flex flex-wrap gap-2">
        {progressWriter.failure?.reason==='unavailable'&&<Button variant="outline" disabled={progressWriter.pending!==null} onClick={()=>void progressWriter.retry()}>{cs?'Zkusit znovu':'Try again'}</Button>}
        {progressWriter.failure&&<Button variant="outline" disabled={progressWriter.pending!==null} onClick={()=>void progressWriter.reload(progressWriter.failure!.source.id)}>{cs?'Načíst přihlášky':'Reload applications'}</Button>}
      </div></CareerActionNotice>}
      {removalMessage&&<CareerActionNotice message={removalMessage}><div className="flex flex-wrap gap-2">
        {recordWriter.failure?.reason==='unavailable'&&<Button variant="outline" disabled={recordWriter.pending!==null} onClick={event=>void retryRemoval(event.currentTarget)}>{cs?'Zkusit znovu':'Try again'}</Button>}
        {recordWriter.failure&&<Button data-career-removal-reload variant="outline" disabled={recordWriter.pending!==null} onClick={()=>void recordWriter.reload()}>{cs?'Načíst přihlášky':'Reload applications'}</Button>}
      </div></CareerActionNotice>}
      {layout === "list" && <CareerPagination page={page} onPage={setPageIndex} label={t.jobs.applicationPages} />}
      {layout === "board" ? (
        <CareerBoard
          key={JSON.stringify([search, since, responseFilter])}
          disabled={progressWriter.pending!==null||recordWriter.pending!==null}
          applications={visible}
          allApplications={applications}
          savedPositions={visibleSaved}
          statusLabel={statusLabel}
          statuses={STATUSES}
          onStatus={changeStatus}
          onProgress={(app) => setProgressFor(app)}
          onPrepare={onPrepare}
        />
      ) : visible.length === 0 ? (
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
            {page.items.map((app) => (
              <ApplicationRow
                key={app.id}
                app={app}
                events={eventsByApplication.get(app.id) ?? []}
                statusLabel={statusLabel}
                onStatus={(status) => void changeStatus(app,status).catch(()=>{})}
                disabled={progressWriter.pending!==null||recordWriter.pending!==null}
                onProgress={() => setProgressFor(app)}
                onLetter={() => setLetterFor(app)}
                onDelete={(control) => void removeApplication(app,control)}
              />
            ))}
          </ul>
        </Card>
      )}

      {progressFor && <CareerProgressDialog timeZone={timeZone} key={progressFor.id} app={progressFor} onClose={()=>setProgressFor(null)} setApplications={setApplications} setEvents={setEvents} userId={userId}/>}
      {letterFor && <LetterDialog
        key={letterFor.id}
        app={letterFor}
        onClose={() => setLetterFor(null)}
        templates={templates}
        setTemplates={setTemplates}
        setApplications={setApplications}
        userId={userId}
        setEvents={setEvents}
      />}
      {templatesOpen && <CareerTemplatesDialog
        onClose={() => setTemplatesOpen(false)}
        templates={templates}
        setTemplates={setTemplates}
        userId={userId}
      />}
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
  disabled,
}: {
  app: JobApplication;
  disabled: boolean;
  events: JobApplicationEvent[];
  statusLabel: Record<JobApplicationStatus, string>;
  onStatus: (s: JobApplicationStatus) => void;
  onProgress: () => void;
  onLetter: () => void;
  onDelete: (control: HTMLButtonElement) => void;
}) {
  const t = useDict();
  const cs = useLang().lang === "cs";
  const locale = useDateLocale();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPageIndex,setHistoryPageIndex]=useState(0);
  const historyPage=historyOpen?collectionPage(events,historyPageIndex):null;
  const link=safeWebUrl(app.url,2048);

  const appliedDate = new Date(`${app.applied_on}T00:00:00`);
  const subtitle = [app.company, app.source==='manual'?(cs?'Ručně':'Manual'):app.source ? jobSourceLabel(app.source) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <li data-career-application={app.id} className="min-w-0 px-4 py-3 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <div className="flex items-center gap-2">
            {link ? (
              <a
                data-career-application-title
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="block min-w-0 break-words text-sm font-medium hover:underline focus-ring rounded-sm"
                title={app.title}
              >
                {app.title}
              </a>
            ) : (
              <span data-career-application-title tabIndex={-1} className="block min-w-0 break-words text-sm font-medium focus-ring" title={app.title}>
                {app.title}
              </span>
            )}
          </div>
          <p className="mt-0.5 break-words text-xs text-foreground-muted">
            {subtitle}
          </p>
          <p className="mt-0.5 text-[11px] text-foreground-subtle">
            {t.jobs.appliedOnLabel} {format(appliedDate, "PPP", { locale })} (
            {formatDistanceToNow(appliedDate, { addSuffix: true, locale })})
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <SimpleSelect
            disabled={disabled}
            value={app.status}
            onValueChange={(v) => onStatus(v as JobApplicationStatus)}
            className="h-11 w-auto min-w-28 text-xs md:h-8"
            aria-label={t.jobs.statusLabel}
            options={STATUSES.map((s) => ({ value: s, label: statusLabel[s] }))}
          />
          <Tooltip content={t.jobs.coverLetterAction}>
            <Button
              type="button" variant="ghost" size="icon"
              onClick={onLetter}
              disabled={disabled}
              aria-label={t.jobs.coverLetterAction}
              className="text-foreground-muted hover:text-foreground"
            >
              <FileText className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t.jobs.history}>
            <Button
              type="button" variant="ghost" size="icon"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-label={t.jobs.history}
              aria-expanded={historyOpen}
              className={cn(
                "",
                historyOpen
                  ? "bg-accent text-foreground"
                  : "text-foreground-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <History className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t.jobs.deleteApplication}>
            <Button
              type="button" variant="ghost" size="icon"
              onClick={event=>onDelete(event.currentTarget)}
              disabled={disabled}
              aria-label={t.jobs.deleteApplication}
              className="text-foreground-muted hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {app.cover_letter_url && isGoogleLetterUrl(app.cover_letter_url) && <Button asChild size="sm" variant="outline"><a href={app.cover_letter_url} target="_blank" rel="noopener noreferrer">{cs?"Dopis na Google Drive":"Cover letter on Google Drive"}<ExternalLink className="h-4 w-4"/></a></Button>}
        <Button size="sm" variant="outline" onClick={onProgress} disabled={disabled}>{cs?"Odpověď / další postup":"Response / follow-up"}</Button>
        <span className="text-sm text-foreground-muted">{app.responded_on ? `${cs?"První odpověď":"First response"}: ${format(new Date(`${app.responded_on}T00:00:00`),"PP",{locale})}` : cs?"Zatím bez zaznamenané odpovědi":"No response recorded yet"}</span>
        {app.next_follow_up_at && <span className="text-sm text-foreground-muted">{cs?"Připomenout":"Follow up"}: {format(new Date(app.next_follow_up_at),"PP",{locale})}</span>}
      </div>
      {historyPage && (
        <div data-career-application-history>
        <ul className="mt-2 space-y-1 border-l-2 border-border pl-3">
          {events.length === 0 && (
            <li className="text-[11px] text-foreground-subtle">—</li>
          )}
          {historyPage.items.map((e) => (
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
        <CareerPagination page={historyPage} onPage={setHistoryPageIndex} label={t.jobs.history}/>
        </div>
      )}

      {(app.contact_name || app.contact_email) && (
        <p className="mt-2 break-words text-[11px] text-foreground-muted">
          {t.jobs.contactLabel}:{" "}
          {app.contact_name}
          {app.contact_name && app.contact_email ? " · " : null}
          {app.contact_email && (
            <a href={`mailto:${app.contact_email}`} className="hover:underline focus-ring rounded-sm">
              {app.contact_email}
            </a>
          )}
        </p>
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
  setEvents,
  userId,
}: {
  app: JobApplication;
  onClose: () => void;
  templates: CoverLetterTemplate[];
  setTemplates: Updater<CoverLetterTemplate[]>;
  setApplications: Updater<JobApplication[]>;
  setEvents: Updater<JobApplicationEvent[]>;
  userId: string;
}) {
  const t = useDict();
  const toast = useToast();
  const cs=useLang().lang==='cs',requestExit=useGuardedNavigation();
  const [initial]=useState(()=>structuredClone(app)),[reviewed,setReviewed]=useState(initial),source=useRef(initial);
  const [helperRevision,setHelperRevision]=useState(0);
  const [letter,setLetter]=useState(initial.cover_letter),fields=useRef(initial.cover_letter),dirty=useRef(false);
  const writer=useCareerApplicationRecordWrite({userId,setApplications,setEvents}),locked=writer.pending!==null||!!writer.failure&&writer.failure.reason!=='invalid';
  function update(value:string){if(locked||writer.isPending())return;fields.current=value;dirty.current=value!==source.current.cover_letter;setLetter(value);writer.clearFailure();}
  async function save(){if(fields.current===source.current.cover_letter)return true;const receipt=await writer.saveLetter(source.current,fields.current);if(!receipt||!writer.isCurrent())return false;source.current=receipt;setReviewed(receipt);dirty.current=false;toast.ok(t.jobs.letterSaved);return true;}
  async function retry(){const receipt=await writer.retry();if(receipt&&writer.isCurrent()){source.current=receipt;setReviewed(receipt);dirty.current=false;toast.ok(t.jobs.letterSaved);requestExit(onClose);}}
  async function reload(){const result=await writer.reload(source.current.id);if(!result?.row||!writer.isCurrent())return;source.current=result.row;setReviewed(result.row);setHelperRevision(value=>value+1);fields.current=result.row.cover_letter;setLetter(fields.current);dirty.current=false;}
  useUnsavedDraft({get dirty(){return dirty.current;},canSave:!writer.failure,save,discard:()=>{dirty.current=false;}});
  const message=writer.reloadFailed?(cs?'Přihlášku se nepodařilo načíst. Dopis zůstal zachovaný.':'The application could not be loaded. Your letter is kept.')
    :writer.failure?.reason==='changed'?(cs?'Přihláška se změnila nebo už neexistuje. Dopis zůstal zachovaný. Načtěte aktuální přihlášku.':'The application changed or is no longer available. Your letter is kept. Load the current application.')
    :writer.failure?.reason==='invalid'?(cs?'Zkraťte dopis na nejvýše 64 000 znaků.':'Shorten the letter to at most 64,000 characters.')
    :writer.failure?(cs?'Uložení není potvrzené. Dopis zůstal zachovaný. Zkuste znovu stejný požadavek.':'The save is unconfirmed. Your letter is kept. Retry the same request.'):null;
  function close(){requestExit(onClose);}

  return (
    <Dialog open onOpenChange={(v) => {if(!v)close();}}>
      <DialogContent className="max-w-xl" aria-busy={writer.pending!==null}>
        <DialogTitle>{t.jobs.coverLetter}</DialogTitle>
        {app && (
          <p className="mt-1 truncate text-xs text-foreground-muted">
            {[reviewed.title, reviewed.company].filter(Boolean).join(" — ")}
          </p>
        )}
        <div className="mt-3 space-y-3">
          <fieldset disabled={writer.pending!==null}>
          <CoverLetterField
            helperRevision={helperRevision}
            showLabel={false}
            readOnly={locked}
            id="job-letter-editor"
            value={letter}
            onChange={update}
            templates={templates}
            setTemplates={setTemplates}
            vars={{
              position: reviewed.title,
              company: reviewed.company,
              source: reviewed.source ? jobSourceLabel(reviewed.source) : null,
            }}
            userId={userId}
          />
          </fieldset>
          {message&&<CareerActionNotice message={message}><div className="flex flex-wrap gap-2">
            {writer.failure?.reason==='unavailable'&&<Button variant="outline" disabled={writer.pending!==null} onClick={()=>void retry()}>{cs?'Zkusit znovu':'Try again'}</Button>}
            {writer.failure&&writer.failure.reason!=='invalid'&&<Button variant="outline" disabled={writer.pending!==null} onClick={()=>void reload()}>{cs?'Zahodit koncept a načíst aktuální':'Discard draft and load latest'}</Button>}
          </div></CareerActionNotice>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                {t.jobs.cancel}
              </Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={()=>void save().then(saved=>{if(saved)requestExit(onClose);})}
              disabled={locked||letter===reviewed.cover_letter}
            >
              <Check className="h-3.5 w-3.5" />
              {writer.pending ? t.jobs.saving : t.jobs.save}
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
  const previous=useMemo(()=>applications.filter(app=>app.cover_letter.trim()),[applications]);
  const [previousPageIndex,setPreviousPageIndex]=useState(0),previousPage=collectionPage(previous,previousPageIndex);
  const previousLabel=cs?"Předchozí dopisy":"Previous letters";
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
          protectContext
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
      <aside data-career-previous-letters className="min-w-0 self-start space-y-4">
        <h2 className="text-base font-semibold">
          {previousLabel}
        </h2>
        {previousPage.items.map((a) => (
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
        <CareerPagination page={previousPage} onPage={setPreviousPageIndex} label={previousLabel} stacked/>
        {previous.length===0 && (
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
  pending,
  blocked,
}: {
  listing: JobListing;
  onApply: () => void;
  saved: boolean;
  pending: boolean;
  blocked: boolean;
}) {
  const { lang } = useLang();
  const cs = lang === "cs";
  const t = useDict();
  const titleId = useId();
  return (
    <section
      className="min-w-0 rounded-md border border-border bg-surface p-5"
      aria-label={cs ? "Podrobnosti pozice" : "Position details"}
    >
      <p className="mb-2 text-sm text-foreground-muted">
        {detail.company} · {detail.location}
      </p>
      <h2 id={titleId} className="break-words text-xl font-semibold">{detail.title}</h2>
      <p className="mt-2 text-sm text-foreground-muted">
        {detail.salary || (cs ? "Mzda neuvedena" : "Salary not specified")}
      </p>
      <div className="my-4 flex flex-wrap gap-2">
        <Button aria-describedby={titleId} onClick={onApply} disabled={saved || pending || blocked}>
          <Bookmark className="h-4 w-4" />
          {pending ? t.jobs.saving : saved ? t.jobs.savedBadge : t.jobs.savePosition}
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
