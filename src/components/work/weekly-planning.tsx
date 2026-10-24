"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { RelinkGoogleButton } from "@/components/calendar/relink-cta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SectionLabel } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CHART_COLORS } from "@/lib/chart-colors";
import { mondayKey, previousMondayKey, weekRange } from "@/lib/date-keys";
import { useDict } from "@/lib/i18n";
import type { EntityStatus } from "@/lib/queries/entities";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { useNow } from "@/lib/use-now";
import { useUnsavedDraft } from "@/components/navigation-guard";
import { applyWeeklyReviewReceipt, loadWeeklyReview, saveWeeklyReview, weeklyReviewPatchSchema, type WeeklyReviewPatch } from "@/lib/weekly-review-save";
import {
  LEGACY_REVIEW_KEYS,
  WEEKLY_PLANNING_STEPS,
  WORK_CHANNELS,
  carryForwardCandidates,
  channelShares,
  hoursAndMinutes,
  mergeCarriedObjectives,
  nextStep,
  previousStep,
  readObjectives,
  readStep,
  readStringList,
  summarizeFocusWeek,
  summarizeTimeByChannel,
  type CarryForwardCandidate,
  type FocusRecap,
  type LegacyReviewKey,
  type TimeByChannel,
  type WeeklyPlanningStep,
  type WorkChannel,
} from "@/lib/weekly-planning";
import { loadWeeklyFocusSnapshot, type WeeklyFocusSet } from "@/lib/weekly-focus";
import type { EventsResult } from "@/lib/calendar";
import type {
  Organization,
  Project,
  Todo,
  Updater,
  WeeklyObjective,
  WeeklyReview,
} from "@/lib/types";

type FocusSet = WeeklyFocusSet;

const EMPTY_FOCUS_SETS: FocusSet[] = [];
const CHANNEL_COLOR: Record<WorkChannel, string> = {
  client: CHART_COLORS[0],
  project: CHART_COLORS[3],
  admin: CHART_COLORS[2],
};

type PlanningProps = {
  ownerId: string;
  reviews: WeeklyReview[];
  setReviews: Updater<WeeklyReview[]>;
  projects: Project[];
  organizations: Organization[];
  todos: Todo[];
  lastWeekCalendar: EventsResult;
  isPreview?: boolean;
};

type EditedField = "summary" | "objectives" | LegacyReviewKey;

const LOADED: EntityStatus = { ready: true, failed: false };
const CALENDAR_UNREADABLE: EventsResult = { ok: false, reason: "error" };

/**
 * The guided weekly planning flow.
 *
 * Five steps in one card, persisted into the same `weekly_reviews` row the flat
 * review used: last week's calendar time by channel, the focus tasks that were
 * finished, what carries over, next week's objectives, and a summary. The step
 * the owner stopped on is stored with the record, so re-opening Work resumes
 * where they left off instead of starting over.
 *
 * Only aggregates are written — minutes per channel and counts. Calendar titles
 * classify a block and are then discarded.
 *
 * The steps mount only once the stored reviews have loaded and last week's
 * calendar has loaded or failed. They seed their state from the stored review
 * when they mount, and a tab reached client-side starts from an empty
 * placeholder: mounted early, the first "Next" would save that emptiness over
 * the week's real plan.
 */
export function WeeklyPlanningFlow({
  reviewsStatus = LOADED,
  lastWeekCalendarStatus = LOADED,
  lastWeekCalendar,
  ...props
}: PlanningProps & {
  reviewsStatus?: EntityStatus;
  lastWeekCalendarStatus?: EntityStatus;
}) {
  const now = useNow();
  const calendarSettled = lastWeekCalendarStatus.ready || lastWeekCalendarStatus.failed;
  if (!now || !reviewsStatus.ready || !calendarSettled) {
    return <PlanningPending failed={reviewsStatus.failed} />;
  }
  return (
    <PlanningSteps
      {...props}
      reference={now}
      // A calendar read that gave up is shown as unreadable, never as an
      // empty week whose zero minutes would then be saved.
      lastWeekCalendar={lastWeekCalendarStatus.ready ? lastWeekCalendar : CALENDAR_UNREADABLE}
    />
  );
}

function PlanningPending({ failed }: { failed: boolean }) {
  const t = useDict();
  const p = t.professional;
  const qc = useQueryClient();
  return (
    <Card className="min-w-0" data-testid="weekly-planning">
      <CardHeader>
        <CardTitle><h2>{p.weeklyPlanning}</h2></CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-foreground-muted">{p.weeklyPlanningDescription}</p>
        {failed ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-foreground-muted">{p.planningLoadFailed}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: qk.weeklyReviews, exact: true });
                void qc.invalidateQueries({ queryKey: qk.calendarLastWeek, exact: true });
              }}
            >
              {p.planningRetry}
            </Button>
          </div>
        ) : (
          <p role="status" className="text-sm text-foreground-muted">
            {t.common.loading}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PlanningSteps({
  ownerId,
  reviews,
  setReviews,
  projects,
  organizations,
  todos,
  lastWeekCalendar,
  isPreview = false,
  reference,
}: PlanningProps & { reference: Date }) {
  const t = useDict();
  const p = t.professional;
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();

  const [identity] = useState(() => ({ ownerId, weekStart: mondayKey(reference) }));
  const weekStart = identity.weekStart;
  const previousWeek = previousMondayKey(new Date(`${weekStart}T12:00:00`));
  const contextCurrent = ownerId === identity.ownerId && mondayKey(reference) === weekStart;
  const current = reviews.find(review => review.user_id === identity.ownerId && review.week_start === weekStart);
  const previous = reviews.find(review => review.user_id === identity.ownerId && review.week_start === previousWeek);
  const base = useRef<WeeklyReview | null>(current ?? null);
  const recordId = useRef<string | null>(current?.id ?? null);
  const objectiveId = useRef<string | null>(null);
  if (recordId.current === null) recordId.current = crypto.randomUUID();
  if (objectiveId.current === null) objectiveId.current = crypto.randomUUID();
  const edited = useRef(new Set<EditedField>());
  const pendingRef = useRef(false), dirtyRef = useRef(false), mounted = useRef(false);
  const activeContext = useRef(contextCurrent), actor = useRef(ownerId), controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false), [, setDirty] = useState(false);
  const [error, setError] = useState<'failed' | 'conflict' | 'invalid' | null>(null);
  const [step, setStep] = useState<WeeklyPlanningStep>(() => readStep(current?.items));
  const [objectives, setObjectives] = useState<WeeklyObjective[]>(() => readObjectives(current?.items));
  const [draftObjective, setDraftObjective] = useState('');
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const [summary, setSummary] = useState(current?.summary ?? '');
  const [legacy, setLegacy] = useState<Record<LegacyReviewKey,string>>(() => Object.fromEntries(LEGACY_REVIEW_KEYS.map(key => [key,readStringList(current?.items[key]).join('\n')])) as Record<LegacyReviewKey,string>);
  const reset = useCallback((review: WeeklyReview | null) => {
    base.current = review; recordId.current = review?.id ?? crypto.randomUUID(); objectiveId.current = crypto.randomUUID();
    edited.current.clear(); dirtyRef.current = false; setDirty(false); setError(null);
    setStep(readStep(review?.items)); setObjectives(readObjectives(review?.items)); setSummary(review?.summary ?? ''); setDraftObjective(''); setDropped(new Set());
    setLegacy(Object.fromEntries(LEGACY_REVIEW_KEYS.map(key => [key,readStringList(review?.items[key]).join('\n')])) as Record<LegacyReviewKey,string>);
  },[]);
  const markEdited = (field?: EditedField) => {
    if (pendingRef.current || !activeContext.current) return false;
    if (isPreview) return true;
    if (field) edited.current.add(field);
    dirtyRef.current = true; setDirty(true); setError(null); return true;
  };
  useLayoutEffect(() => { activeContext.current = contextCurrent; actor.current = ownerId; if (!contextCurrent) controller.current?.abort(); },[contextCurrent,ownerId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; },[]);
  useEffect(() => { if (current && !dirtyRef.current && !pendingRef.current && contextCurrent) reset(current); },[current,contextCurrent,reset]);

  const range = useMemo(() => weekRange(previousWeek), [previousWeek]);
  const time: TimeByChannel = useMemo(
    () =>
      summarizeTimeByChannel(
        lastWeekCalendar.ok ? lastWeekCalendar.events : [],
        { projects, organizations },
        range,
      ),
    [lastWeekCalendar, projects, organizations, range],
  );
  const shares = useMemo(() => channelShares(time), [time]);

  // The database selects the newest generation before returning at most
  // seven days / 49 items. A failed read is unavailable, never an empty recap.
  const focusQuery = useQuery({
    queryKey: [...qk.weeklyFocusRecap, identity.ownerId, previousWeek],
    enabled: !isPreview && contextCurrent, retry: false, staleTime: 30_000,
    queryFn: ({ signal }) => loadWeeklyFocusSnapshot(supabase, identity.ownerId, previousWeek, signal),
  });
  const focusReady = !isPreview && focusQuery.isSuccess;
  const focusMissing = !isPreview && !focusQuery.data;
  const focusNotice = !isPreview && (focusQuery.isPending || focusQuery.isError) ? (
    <div className="space-y-2" role={focusQuery.isError ? "alert" : "status"}>
      <p className="text-sm text-foreground-muted">{focusQuery.isError ? focusQuery.data ? p.focusRecapStale : p.focusRecapLoadFailed : p.focusRecapLoading}</p>
      {focusQuery.isError && <Button variant="outline" disabled={focusQuery.isFetching} onClick={() => void focusQuery.refetch()}>{p.planningRetry}</Button>}
    </div>
  ) : null;

  const focusSets = focusQuery.data ?? EMPTY_FOCUS_SETS;
  const focusItems = useMemo(() => focusSets.flatMap((set) => set.items), [focusSets]);
  const recap: FocusRecap = useMemo(() => summarizeFocusWeek(focusSets), [focusSets]);
  const finished = useMemo(
    () => focusItems.filter((item) => item.completed_at),
    [focusItems],
  );

  const candidates = useMemo(
    () =>
      carryForwardCandidates({
        previousReview: previous ?? null,
        focusItems,
        todos,
      }),
    [previous, focusItems, todos],
  );
  const kept = useMemo(
    () => candidates.filter((candidate) => !dropped.has(candidate.id)),
    [candidates, dropped],
  );

  const stepIndex = WEEKLY_PLANNING_STEPS.indexOf(step);
  const stepTitles: Record<WeeklyPlanningStep, string> = {
    time: p.planningStepTime,
    done: p.planningStepDone,
    carry: p.planningStepCarry,
    objectives: p.planningStepObjectives,
    summary: p.planningStepSummary,
  };

  type SaveMode = "auto" | "draft" | "complete";

  const blocked = pending || !contextCurrent || error === 'conflict';
  async function persist(mode: SaveMode, atStep: WeeklyPlanningStep, next = objectives): Promise<boolean> {
    if (isPreview || pendingRef.current || !activeContext.current || actor.current !== identity.ownerId || mondayKey() !== weekStart || error === 'conflict') return false;
    if (mode === 'complete' && !focusReady) return false;
    const changed = new Set(edited.current), source = base.current;
    let nextObjectives = step === 'carry' && focusReady ? mergeCarriedObjectives(next.filter(objective => !objective.carriedFrom || !dropped.has(objective.carriedFrom)),kept) : next;
    if (nextObjectives !== objectives) changed.add('objectives');
    const addedText = draftObjective.trim();
    if (addedText) { nextObjectives = [...nextObjectives,{ id: objectiveId.current!,text: addedText,done: false }]; changed.add('objectives'); }
    const patch: WeeklyReviewPatch = { ...(changed.has('summary') ? { summary: summary.trim() } : {}), items: {
      ...Object.fromEntries(LEGACY_REVIEW_KEYS.filter(key => changed.has(key)).map(key => [key,legacy[key].split('\n').map(line => line.trim()).filter(Boolean)])),
      ...(changed.has('objectives') ? { objectives: nextObjectives } : {}),
      timeByChannel: { minutes: { ...time.minutes },unmatchedEvents: time.unmatchedEvents,source: lastWeekCalendar.ok ? 'google' : 'unavailable' },
      ...(focusReady ? { focusRecap: { ...recap } } : {}), step: atStep,
    } };
    if (!weeklyReviewPatchSchema.safeParse(patch).success) { setError('invalid'); return false; }
    pendingRef.current = true; setPending(true); dirtyRef.current = true; setDirty(true); setError(null);
    const cancellation = new AbortController(); controller.current = cancellation;
    try {
      const result = await saveWeeklyReview(supabase,{ ownerId: identity.ownerId,id: recordId.current!,weekStart,expected: source,mode,patch },cancellation.signal);
      if (!mounted.current || !activeContext.current || cancellation.signal.aborted) return false;
      if (result.kind === 'conflict') { setError('conflict'); void qc.invalidateQueries({ queryKey: qk.weeklyReviews,exact: true }); return false; }
      await qc.cancelQueries({ queryKey: qk.weeklyReviews,exact: true });
      if (!mounted.current || !activeContext.current || cancellation.signal.aborted) return false;
      const cached = qc.getQueryData<WeeklyReview[]>(qk.weeklyReviews) ?? reviews;
      const reconcile = applyWeeklyReviewReceipt(cached,source,result).reconcile;
      setReviews(rows => applyWeeklyReviewReceipt(rows,source,result).rows);
      if (reconcile) void qc.invalidateQueries({ queryKey: qk.weeklyReviews,exact: true });
      reset(result.review);
      if (mode !== 'auto') toast.ok(p.saved);
      return true;
    } catch {
      if (mounted.current && activeContext.current) { setError('failed'); void qc.invalidateQueries({ queryKey: qk.weeklyReviews,exact: true }); }
      return false;
    } finally { if (controller.current === cancellation) { controller.current = null; pendingRef.current = false; if (mounted.current) setPending(false); } }
  }
  async function reloadSaved() {
    if (pendingRef.current || isPreview) return;
    // A new account/week needs the shell's matching Calendar window and owner
    // data too. Explicit discard uses a full server reload for that boundary.
    if (!contextCurrent) { reset(null); window.location.reload(); return; }
    const expectedOwner = ownerId, expectedWeek = mondayKey();
    pendingRef.current = true; setPending(true);
    const cancellation = new AbortController(); controller.current = cancellation;
    try {
      const review = await loadWeeklyReview(supabase,expectedOwner,expectedWeek,cancellation.signal);
      if (!mounted.current || actor.current !== expectedOwner || mondayKey() !== expectedWeek || cancellation.signal.aborted) return;
      await qc.cancelQueries({ queryKey: qk.weeklyReviews,exact: true });
      if (!mounted.current || actor.current !== expectedOwner || mondayKey() !== expectedWeek || cancellation.signal.aborted) return;
      setReviews(rows => [...(review ? [review] : []),...rows.filter(row => row.user_id !== expectedOwner || row.week_start !== expectedWeek)]);
      reset(review);
    } catch { if (mounted.current) setError('failed'); }
    finally { if (controller.current === cancellation) { controller.current = null; pendingRef.current = false; if (mounted.current) setPending(false); } }
  }
  useUnsavedDraft({ get dirty() { return !isPreview && dirtyRef.current; },get pending() { return pendingRef.current; },canSave: !isPreview && contextCurrent && error !== 'conflict',save: () => persist('draft',step),discard: () => reset(current ?? null) });
  const goNext = () => {
    if (pendingRef.current || !contextCurrent || (!isPreview && (step === 'done' || step === 'carry') && !focusReady)) return;
    if (isPreview) { setStep(nextStep(step)); return; }
    void persist('auto',nextStep(step));
  };
  const goBack = () => { if (!pendingRef.current && contextCurrent) setStep(previousStep(step)); };
  const addObjective = () => {
    const text = draftObjective.trim();
    if (!text || text.length > 2000 || objectives.length >= 100 || !markEdited('objectives')) return;
    setObjectives(old => [...old,{ id: objectiveId.current!,text,done: false }]); objectiveId.current = crypto.randomUUID(); setDraftObjective('');
  };

  return (
    <Card className="min-w-0" data-testid="weekly-planning">
      <CardHeader>
        <CardTitle><h2>{p.weeklyPlanning}</h2></CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-foreground-muted">{p.weeklyPlanningDescription}</p>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <SectionLabel>
              {p.planningStep} {stepIndex + 1}/{WEEKLY_PLANNING_STEPS.length}
            </SectionLabel>
            {current?.status === "completed" && (
              <span className="text-[11px] text-success">{p.weekCompleted}</span>
            )}
          </div>
          <Progress
            value={((stepIndex + 1) / WEEKLY_PLANNING_STEPS.length) * 100}
            aria-label={`${p.planningStep} ${stepIndex + 1}/${WEEKLY_PLANNING_STEPS.length}`}
          />
        </div>

        {!contextCurrent && <div role="alert" className="space-y-2"><p className="text-sm text-foreground-muted">{p.planningContextChanged}</p><Button variant="outline" disabled={pending} onClick={() => void reloadSaved()}>{p.planningReload}</Button></div>}
        {error && <div role="alert" className="space-y-2"><p className="text-sm text-risk">{error === 'conflict' ? p.planningConflict : error === 'invalid' ? p.planningInvalid : p.planningSaveFailed}</p>{error === 'conflict' && <Button variant="outline" disabled={pending} onClick={() => void reloadSaved()}>{p.planningReload}</Button>}</div>}
        <fieldset disabled={pending || !contextCurrent} hidden={ownerId !== identity.ownerId} className="min-w-0 space-y-4" aria-busy={pending}>
        <section aria-labelledby={`weekly-planning-${step}`} className="space-y-3">
          <h3
            id={`weekly-planning-${step}`}
            className="text-sm font-semibold text-foreground"
          >
            {stepTitles[step]}
          </h3>

          {step === "time" && (
            <TimeStep
              time={time}
              shares={shares}
              calendar={lastWeekCalendar}
              weekStart={previousWeek}
            />
          )}

          {step === "done" && (
            <div className="space-y-3">
              <p className="text-xs text-foreground-muted">{p.focusRecapDescription}</p>
              {focusQuery.data && <dl className="grid grid-cols-2 gap-3">
                <Figure label={p.focusRecapCompleted} value={`${recap.completed}/${recap.total}`} />
                <Figure label={p.focusRecapDays} value={String(recap.days)} />
              </dl>}
              {focusNotice}
              {isPreview ? (
                <p className="text-sm text-foreground-muted">{p.focusRecapUnavailable}</p>
              ) : focusMissing ? null : finished.length === 0 ? (
                <p className="text-sm text-foreground-muted">{p.focusRecapEmpty}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {finished.map((item) => (
                    <li key={item.id} data-testid="weekly-focus-item" className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                      <span data-testid="weekly-focus-title" className="min-w-0 flex-1 basis-40 break-words text-sm">{item.title_snapshot}</span>
                      {item.project_name_snapshot && (
                        <span data-testid="weekly-focus-project" className="min-w-0 max-w-full break-words text-xs text-foreground-muted sm:max-w-[40%]">
                          {item.project_name_snapshot}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === "carry" && (
            <div className="space-y-3">
              <p className="text-xs text-foreground-muted">{p.carryForwardDescription}</p>
              {focusNotice}
              {focusMissing ? null : candidates.length === 0 ? (
                <p className="text-sm text-foreground-muted">{p.carryForwardEmpty}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {candidates.map((candidate) => (
                    <CarryRow
                      key={candidate.id}
                      candidate={candidate}
                      checked={!dropped.has(candidate.id)}
                      originLabel={
                        candidate.origin === "objective"
                          ? p.carryFromObjective
                          : p.carryFromFocus
                      }
                      disabled={blocked || (!isPreview && !focusReady)}
                      onChange={(checked) => { if (!markEdited()) return;
                        setDropped((old) => {
                          const next = new Set(old);
                          if (checked) next.delete(candidate.id);
                          else next.add(candidate.id);
                          return next;
                        });
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === "objectives" && (
            <div className="space-y-3">
              <p className="text-xs text-foreground-muted">{p.objectivesDescription}</p>
              {objectives.length === 0 ? (
                <p className="text-sm text-foreground-muted">{p.objectivesEmpty}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {objectives.map((objective) => (
                    <li key={objective.id} className="flex items-center gap-3 py-2">
                      <Checkbox
                        checked={objective.done}
                        disabled={blocked}
                        aria-label={`${p.objectiveDone}: ${objective.text}`}
                        onCheckedChange={(checked) => {
                          if (!markEdited("objectives")) return;
                          setObjectives((old) =>
                            old.map((entry) =>
                              entry.id === objective.id
                                ? { ...entry, done: checked === true }
                                : entry,
                            ),
                          );
                        }}
                      />
                      <span className="min-w-0 flex-1 break-words text-sm">
                        {objective.text}
                        {objective.carriedFrom && (
                          <span className="ml-2 text-[11px] text-foreground-muted">
                            {p.carriedOver}
                          </span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${p.removeObjective}: ${objective.text}`}
                        disabled={blocked}
                        onClick={() => {
                          if (!markEdited("objectives")) return;
                          setObjectives((old) =>
                            old.filter((entry) => entry.id !== objective.id),
                          );
                        }}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="weekly-planning-new-objective">
                  {p.addObjective}
                </label>
                <Input
                  id="weekly-planning-new-objective"
                  value={draftObjective}
                  readOnly={error === 'conflict'}
                  placeholder={p.objectivePlaceholder}
                  maxLength={2000}
                  onChange={(event) => { if (markEdited()) setDraftObjective(event.target.value); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      addObjective();
                    }
                  }}
                />
                <Button variant="outline" disabled={blocked} onClick={addObjective}>
                  <Plus />
                  {p.addObjective}
                </Button>
              </div>
            </div>
          )}

          {step === "summary" && (
            <div className="space-y-3">
              <p className="text-xs text-foreground-muted">{p.weekSummaryDescription}</p>
              <label className="block space-y-1.5">
                <SectionLabel>{p.planningStepSummary}</SectionLabel>
                <Textarea
                  value={summary}
                  readOnly={error === 'conflict'}
                  maxLength={20000}
                  rows={4}
                  placeholder={p.summaryPlaceholder}
                  onChange={(event) => {
                    if (!markEdited("summary")) return;
                    setSummary(event.target.value);
                  }}
                />
              </label>
              <details className="border-t border-border pt-3">
                <summary className="cursor-pointer text-xs text-foreground-muted focus-ring">
                  {p.earlierReviewNotes}
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["facts", p.facts],
                      ["risks", p.risks],
                      ["decisions", p.decisions],
                      ["priorities", p.priorities],
                      ["followUps", p.followUpActions],
                      ["sources", p.sources],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="space-y-1.5">
                      <SectionLabel>{label}</SectionLabel>
                      <Textarea
                        value={legacy[key]}
                        readOnly={error === 'conflict'}
                        rows={3}
                        className="min-h-20"
                        onChange={(event) => {
                          if (!markEdited(key)) return;
                          setLegacy((old) => ({ ...old, [key]: event.target.value }));
                        }}
                      />
                    </label>
                  ))}
                </div>
              </details>
            </div>
          )}
        </section>

        </fieldset>
        {step !== "done" && step !== "carry" && focusNotice}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="outline" onClick={goBack} disabled={blocked || stepIndex === 0}>
            {p.planningBack}
          </Button>
          <Button
            variant="outline"
            onClick={goNext}
            disabled={blocked || stepIndex === WEEKLY_PLANNING_STEPS.length - 1 || (!isPreview && (step === "done" || step === "carry") && !focusReady)}
          >
            {p.planningNext}
          </Button>
          <span className="flex-1" />
          <Button
            variant="outline"
            onClick={() => void persist("draft", step)}
            disabled={isPreview || blocked}
          >
            {pending ? p.planningSaving : p.saveDraft}
          </Button>
          <Button
            onClick={() => void persist("complete", step)}
            disabled={isPreview || blocked || !focusReady}
          >
            {p.completeWeek}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TimeStep({
  time,
  shares,
  calendar,
  weekStart,
}: {
  time: TimeByChannel;
  shares: Record<WorkChannel, number>;
  calendar: EventsResult;
  weekStart: string;
}) {
  const t = useDict();
  const p = t.professional;
  const label: Record<WorkChannel, string> = {
    client: p.channelClient,
    project: p.channelProject,
    admin: p.channelAdmin,
  };

  if (!calendar.ok) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground-muted">
          {calendar.reason === "no-token" || calendar.reason === "unauthorized"
            ? p.calendarNotConnected
            : p.timeByChannelUnavailable}
        </p>
        {(calendar.reason === "no-token" || calendar.reason === "unauthorized") && (
          <RelinkGoogleButton
            reason={calendar.reason === "unauthorized" ? "expired" : "calendar-access"}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-muted">
        {p.timeByChannelDescription} <span className="tabular">{weekStart}</span>
      </p>
      {time.totalMinutes === 0 ? (
        <p className="text-sm text-foreground-muted">{p.timeByChannelEmpty}</p>
      ) : (
        <>
          <div
            className="flex h-2 w-full overflow-hidden rounded-full bg-surface-muted"
            role="presentation"
          >
            {WORK_CHANNELS.filter((channel) => shares[channel] > 0).map((channel) => (
              <span
                key={channel}
                className="h-full"
                style={{ width: `${shares[channel]}%`, background: CHANNEL_COLOR[channel] }}
              />
            ))}
          </div>
          <ul className="space-y-1.5">
            {WORK_CHANNELS.map((channel) => (
              <li key={channel} className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: CHANNEL_COLOR[channel] }}
                  />
                  {label[channel]}
                </span>
                <span className="shrink-0 text-sm tabular text-foreground-muted">
                  <Duration minutes={time.minutes[channel]} /> · {shares[channel]}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        <Figure label={p.timeByChannelUnmatched} value={String(time.unmatchedEvents)} />
        <Figure label={p.timeByChannelAllDay} value={String(time.skippedAllDay)} />
      </dl>
    </div>
  );
}

function Duration({ minutes }: { minutes: number }) {
  const p = useDict().professional;
  const split = hoursAndMinutes(minutes);
  return (
    <>
      {split.hours > 0 && `${split.hours} ${p.hoursShort} `}
      {split.minutes} {p.minutesShort}
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-foreground-muted">{label}</dt>
      <dd className="text-sm font-semibold tabular text-foreground">{value}</dd>
    </div>
  );
}

function CarryRow({
  candidate,
  checked,
  originLabel,
  onChange,
  disabled,
}: {
  disabled?: boolean;
  candidate: CarryForwardCandidate;
  checked: boolean;
  originLabel: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <Checkbox
        checked={checked}
        disabled={disabled}
        aria-label={candidate.text}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <span className="min-w-0 flex-1 break-words text-sm">{candidate.text}</span>
      <span className="min-w-0 max-w-full break-words text-[11px] text-foreground-muted sm:max-w-[40%]">{originLabel}</span>
    </li>
  );
}
