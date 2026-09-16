"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
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
  latestFocusSets,
  summarizeFocusWeek,
  summarizeTimeByChannel,
  writeReviewItems,
  type CarryForwardCandidate,
  type FocusRecap,
  type LegacyReviewKey,
  type TimeByChannel,
  type WeeklyPlanningStep,
  type WorkChannel,
} from "@/lib/weekly-planning";
import type { EventsResult } from "@/lib/calendar";
import type {
  DailyFocusItem,
  Organization,
  Project,
  Todo,
  Updater,
  WeeklyObjective,
  WeeklyReview,
} from "@/lib/types";

type FocusRow = Pick<
  DailyFocusItem,
  "id" | "todo_id" | "title_snapshot" | "project_name_snapshot" | "completed_at"
>;

type FocusSet = { focus_date: string; generation: number; items: FocusRow[] };

const EMPTY_FOCUS_SETS: FocusSet[] = [];
const CHANNEL_COLOR: Record<WorkChannel, string> = {
  client: CHART_COLORS[0],
  project: CHART_COLORS[3],
  admin: CHART_COLORS[2],
};

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
 */
export function WeeklyPlanningFlow({
  reviews,
  setReviews,
  projects,
  organizations,
  todos,
  lastWeekCalendar,
  isPreview = false,
}: {
  reviews: WeeklyReview[];
  setReviews: Updater<WeeklyReview[]>;
  projects: Project[];
  organizations: Organization[];
  todos: Todo[];
  lastWeekCalendar: EventsResult;
  isPreview?: boolean;
}) {
  const t = useDict();
  const p = t.professional;
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();

  const weekStart = mondayKey();
  const previousWeek = previousMondayKey();
  const current = reviews.find((review) => review.week_start === weekStart);
  const previous = reviews.find((review) => review.week_start === previousWeek);
  const storedItems = current?.items ?? {};

  const [step, setStep] = useState<WeeklyPlanningStep>(() => readStep(storedItems));
  const [objectives, setObjectives] = useState<WeeklyObjective[]>(() =>
    readObjectives(storedItems),
  );
  const [draftObjective, setDraftObjective] = useState("");
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const [summary, setSummary] = useState(current?.summary ?? "");
  const [legacy, setLegacy] = useState<Record<LegacyReviewKey, string>>(() =>
    Object.fromEntries(
      LEGACY_REVIEW_KEYS.map((key) => [
        key,
        readStringList(storedItems[key]).join("\n"),
      ]),
    ) as Record<LegacyReviewKey, string>,
  );

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

  // Last week's focus rows. Own-only RLS already scopes both tables to the
  // signed-in owner, so this reads them directly rather than adding a route
  // whose only job would be to repeat that filter.
  const focusQuery = useQuery({
    queryKey: [...qk.weeklyFocusRecap, previousWeek],
    enabled: !isPreview,
    queryFn: async (): Promise<FocusSet[]> => {
      const { data, error } = await supabase
        .from("daily_focus_sets")
        .select(
          "focus_date, generation, daily_focus_items(id, todo_id, title_snapshot, project_name_snapshot, completed_at)",
        )
        // Half-open on the week key itself: no timezone conversion can move a
        // Sunday out of the week it belongs to.
        .gte("focus_date", previousWeek)
        .lt("focus_date", weekStart)
        .order("focus_date", { ascending: true })
        .order("generation", { ascending: true });
      if (error) throw error;
      return latestFocusSets(
        (data ?? []).map((row) => ({
          focus_date: String(row.focus_date),
          generation: Number(row.generation) || 1,
          items: (Array.isArray(row.daily_focus_items)
            ? row.daily_focus_items
            : []) as FocusRow[],
        })),
      );
    },
  });

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

  const save = useMutation({
    mutationFn: async ({
      mode,
      atStep,
      nextObjectives,
    }: {
      mode: SaveMode;
      atStep: WeeklyPlanningStep;
      nextObjectives: WeeklyObjective[];
    }) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("Not authenticated");
      const now = new Date().toISOString();
      // Moving between steps records where the owner is without changing what
      // the week is: an automatic save must never quietly re-open a week that
      // was already completed.
      const status =
        mode === "complete" ? "completed" : mode === "draft" ? "draft" : current?.status ?? "draft";
      const completedAt =
        mode === "complete" ? now : mode === "draft" ? null : current?.completed_at ?? null;
      const { data, error } = await supabase
        .from("weekly_reviews")
        .upsert(
          {
            user_id: userId,
            week_start: weekStart,
            summary: summary.trim(),
            items: writeReviewItems(storedItems, {
              ...(Object.fromEntries(
                LEGACY_REVIEW_KEYS.map((key) => [
                  key,
                  legacy[key].split("\n").map((line) => line.trim()).filter(Boolean),
                ]),
              ) as Record<LegacyReviewKey, string[]>),
              objectives: nextObjectives,
              timeByChannel: {
                minutes: time.minutes,
                unmatchedEvents: time.unmatchedEvents,
                source: lastWeekCalendar.ok ? "google" : "unavailable",
              },
              focusRecap: recap,
              step: atStep,
            }),
            status,
            completed_at: completedAt,
            updated_at: now,
          },
          { onConflict: "user_id,week_start" },
        )
        .select()
        .single();
      if (error) throw error;
      return data as WeeklyReview;
    },
    onSuccess: (review, variables) => {
      setReviews((old) => [
        review,
        ...old.filter(
          (item) => item.id !== review.id && item.week_start !== review.week_start,
        ),
      ]);
      void qc.invalidateQueries({ queryKey: qk.weeklyReviews });
      // Stepping through the flow saves quietly; only a deliberate save says so.
      if (variables.mode !== "auto") toast.ok(p.saved);
    },
    onError: () => toast.err(p.couldNotSave),
  });

  const persist = (mode: SaveMode, atStep: WeeklyPlanningStep, next = objectives) => {
    if (isPreview) return;
    save.mutate({ mode, atStep, nextObjectives: next });
  };

  const goNext = () => {
    // Leaving the carry step is what turns the kept items into objectives, so
    // stepping back and forward again never duplicates them.
    const merged = step === "carry" ? mergeCarriedObjectives(objectives, kept) : objectives;
    if (merged !== objectives) setObjectives(merged);
    const target = nextStep(step);
    setStep(target);
    persist("auto", target, merged);
  };

  const goBack = () => setStep(previousStep(step));

  const addObjective = () => {
    const text = draftObjective.trim();
    if (!text) return;
    setObjectives((old) => [
      ...old,
      { id: `objective-${Date.now()}-${old.length}`, text, done: false },
    ]);
    setDraftObjective("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{p.weeklyPlanning}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-foreground-muted">{p.weeklyPlanningDescription}</p>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <SectionLabel>
              {p.planningStep} {stepIndex + 1}/{WEEKLY_PLANNING_STEPS.length} ·{" "}
              {stepTitles[step]}
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
              <dl className="grid grid-cols-2 gap-3">
                <Figure label={p.focusRecapCompleted} value={`${recap.completed}/${recap.total}`} />
                <Figure label={p.focusRecapDays} value={String(recap.days)} />
              </dl>
              {isPreview ? (
                <p className="text-sm text-foreground-muted">{p.focusRecapUnavailable}</p>
              ) : focusQuery.isPending ? (
                <p className="text-sm text-foreground-muted">{t.common.loading}</p>
              ) : finished.length === 0 ? (
                <p className="text-sm text-foreground-muted">{p.focusRecapEmpty}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {finished.map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="min-w-0 text-sm">{item.title_snapshot}</span>
                      {item.project_name_snapshot && (
                        <span className="shrink-0 text-xs text-foreground-muted">
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
              {candidates.length === 0 ? (
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
                      onChange={(checked) =>
                        setDropped((old) => {
                          const next = new Set(old);
                          if (checked) next.delete(candidate.id);
                          else next.add(candidate.id);
                          return next;
                        })
                      }
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
                        aria-label={`${p.objectiveDone}: ${objective.text}`}
                        onCheckedChange={(checked) =>
                          setObjectives((old) =>
                            old.map((entry) =>
                              entry.id === objective.id
                                ? { ...entry, done: checked === true }
                                : entry,
                            ),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 text-sm">
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
                        onClick={() =>
                          setObjectives((old) =>
                            old.filter((entry) => entry.id !== objective.id),
                          )
                        }
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
                  placeholder={p.objectivePlaceholder}
                  onChange={(event) => setDraftObjective(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addObjective();
                    }
                  }}
                />
                <Button variant="outline" onClick={addObjective}>
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
                  rows={4}
                  placeholder={p.summaryPlaceholder}
                  onChange={(event) => setSummary(event.target.value)}
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
                        rows={3}
                        className="min-h-20"
                        onChange={(event) =>
                          setLegacy((old) => ({ ...old, [key]: event.target.value }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="outline" onClick={goBack} disabled={stepIndex === 0}>
            {p.planningBack}
          </Button>
          <Button
            variant="outline"
            onClick={goNext}
            disabled={stepIndex === WEEKLY_PLANNING_STEPS.length - 1}
          >
            {p.planningNext}
          </Button>
          <span className="flex-1" />
          <Button
            variant="outline"
            onClick={() => persist("draft", step)}
            disabled={isPreview || save.isPending}
          >
            {p.saveDraft}
          </Button>
          <Button
            onClick={() => persist("complete", step)}
            disabled={isPreview || save.isPending}
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
}: {
  candidate: CarryForwardCandidate;
  checked: boolean;
  originLabel: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Checkbox
        checked={checked}
        aria-label={candidate.text}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <span className="min-w-0 flex-1 text-sm">{candidate.text}</span>
      <span className="shrink-0 text-[11px] text-foreground-muted">{originLabel}</span>
    </li>
  );
}
