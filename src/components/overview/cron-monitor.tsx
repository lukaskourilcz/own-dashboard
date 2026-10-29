"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, type Locale } from "date-fns";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Timer,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useDateLocale, useDict } from "@/lib/i18n";
import type { CronRun } from "@/lib/types";
import { cn } from "@/lib/utils";
import { loadCronRuns } from "@/lib/cron-runs";
import { useNow } from "@/lib/use-now";

function StatusPill({ status }: { status: CronRun["status"] }) {
  const t = useDict();
  const map = {
    success: {
      label: t.dashboard.crons.statusSuccess,
      cls: "border-success/30 bg-success/10 text-success",
      Icon: Check,
    },
    failure: {
      label: t.dashboard.crons.statusFailure,
      cls: "border-destructive/30 bg-destructive/10 text-destructive",
      Icon: AlertTriangle,
    },
    running: {
      label: t.dashboard.crons.statusRunning,
      cls: "border-warning/30 bg-warning/10 text-warning",
      Icon: Loader2,
    },
  }[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
        map.cls,
      )}
    >
      <map.Icon className="h-2.5 w-2.5" />
      {map.label}
    </span>
  );
}

function RunRow({ run, locale }: { run: CronRun; locale: Locale }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {run.name}
        </p>
        {run.endpoint && (
          <p className="truncate font-mono text-[10px] text-foreground-subtle">
            {run.endpoint}
          </p>
        )}
      </div>
      <span className="shrink-0 text-[11px] tabular text-foreground-subtle">
        {format(new Date(run.fired_at), "HH:mm", { locale })}
      </span>
      <StatusPill status={run.status} />
    </li>
  );
}

export function CronMonitorPanel({ isPreview = false }: { isPreview?: boolean }) {
  const t = useDict();
  const locale = useDateLocale();
  const c = t.dashboard.crons;
  const query = useQuery({
    queryKey: ["crons", "runs"],
    queryFn: ({ signal }) => loadCronRuns(signal),
    staleTime: 60_000,
    enabled: !isPreview,
  });
  const runs = useMemo(() => query.data?.runs ?? [], [query.data]);

  const byDate = useMemo(() => {
    const m = new Map<string, CronRun[]>();
    for (const run of runs) {
      const key = format(new Date(run.fired_at), "yyyy-MM-dd");
      const arr = m.get(key);
      if (arr) arr.push(run);
      else m.set(key, [run]);
    }
    return m;
  }, [runs]);

  const now = useNow();
  const todayKey = now ? format(now, "yyyy-MM-dd") : "";
  const todays = byDate.get(todayKey) ?? [];
  const ok = todays.filter((r) => r.status === "success").length;
  const fail = todays.filter((r) => r.status === "failure").length;

  // History day navigator: 0 = today … up to 13 days back.
  const [offset, setOffset] = useState(0);
  const [visibleCount, setVisibleCount] = useState(10);
  const selectedDate = now ? subDays(now, offset) : null;
  const selectedKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const selected = byDate.get(selectedKey) ?? [];
  const visible = selected.slice(0, visibleCount);
  const changeDay = (next: number) => { setOffset(Math.min(13, Math.max(0, next))); setVisibleCount(10); };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
          <Timer className="h-4 w-4 text-foreground-muted" />
          {c.title}
        </h2>
        {!isPreview && (todays.length > 0 || query.isSuccess) && (
          <span className="text-xs tabular text-foreground-muted">
            {c.summary(ok, fail)}
          </span>
        )}
      </div>

      {isPreview ? (
        <p className="px-5 py-8 text-center text-sm text-foreground-subtle">
          {c.emptyToday}
        </p>
      ) : query.isLoading || !now ? (
        <div className="space-y-2 p-5" aria-live="polite">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-skeleton" />
          ))}
        </div>
      ) : query.isError && !query.data ? (
        <div role="alert" className="space-y-3 px-5 py-5 text-center text-sm text-destructive">
          <p>{c.unavailable}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>{t.common.retry}</Button>
        </div>
      ) : (
        <>
          {query.data?.partial && <p role="status" className="px-5 py-3 text-xs text-foreground-muted">{c.partial}</p>}
          {query.isError && <div role="alert" className="flex flex-wrap items-center gap-2 px-5 py-3 text-xs text-destructive"><p>{c.cachedWarning}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>{t.common.retry}</Button></div>}
          {/* One selected day; today's rows are not repeated in a second list. */}
          <div>
            <div className="flex items-center justify-between gap-2 px-5 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                {offset === 0 ? c.today : c.history}
              </p>
              <div className="flex items-center gap-2">
                <Tooltip content={c.prevDay}>
                  <button
                    type="button"
                    onClick={() => changeDay(offset + 1)}
                    disabled={offset >= 13}
                    aria-label={c.prevDay}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-40 focus-ring md:h-6 md:w-6"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </Tooltip>
                <span className="min-w-[7rem] text-center text-xs tabular text-foreground-muted">
                  {selectedDate && format(selectedDate, "PPP", { locale })}
                </span>
                <Tooltip content={c.nextDay}>
                  <button
                    type="button"
                    onClick={() => changeDay(offset - 1)}
                    disabled={offset <= 0}
                    aria-label={c.nextDay}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-40 focus-ring md:h-6 md:w-6"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
            </div>
            {selected.length === 0 ? (
              <p className="px-5 py-4 text-sm text-foreground-subtle">
                {query.data?.partial ? c.partialEmpty : offset === 0 ? c.emptyToday : c.emptyDay}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((run) => (
                  <RunRow key={run.id} run={run} locale={locale} />
                ))}
              </ul>
            )}
            {visible.length < selected.length && <div className="px-5 py-3"><Button variant="outline" size="sm" onClick={() => setVisibleCount(count => count + 10)}>{c.showMore(selected.length - visible.length)}</Button></div>}
          </div>
        </>
      )}
    </Card>
  );
}
