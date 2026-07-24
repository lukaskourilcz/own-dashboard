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
import { Tooltip } from "@/components/ui/tooltip";
import { useDateLocale, useDict } from "@/lib/i18n";
import type { CronRun } from "@/lib/types";
import { cn } from "@/lib/utils";

async function loadRuns(): Promise<CronRun[]> {
  const res = await fetch("/api/crons/runs?days=14", { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as {
    runs?: CronRun[];
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? "Could not load cron runs.");
  return body.runs ?? [];
}

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
    queryFn: loadRuns,
    staleTime: 60_000,
    enabled: !isPreview,
  });
  const runs = useMemo(() => query.data ?? [], [query.data]);

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

  const now = new Date();
  const todayKey = format(now, "yyyy-MM-dd");
  const todays = byDate.get(todayKey) ?? [];
  const ok = todays.filter((r) => r.status === "success").length;
  const fail = todays.filter((r) => r.status === "failure").length;

  // History day navigator: 0 = today … up to 13 days back.
  const [offset, setOffset] = useState(0);
  const selectedDate = subDays(now, offset);
  const selectedKey = format(selectedDate, "yyyy-MM-dd");
  const selected = byDate.get(selectedKey) ?? [];

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
      ) : query.isLoading ? (
        <div className="space-y-2 p-5" aria-live="polite">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-skeleton" />
          ))}
        </div>
      ) : query.isError ? (
        <p role="alert" className="px-5 py-8 text-center text-sm text-destructive">
          {c.unavailable}
        </p>
      ) : (
        <>
          {/* Today */}
          <div className="border-b border-border">
            <p className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              {c.today}
            </p>
            {todays.length === 0 ? (
              <p className="px-5 py-4 text-sm text-foreground-subtle">
                {c.emptyToday}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {todays.map((run) => (
                  <RunRow key={run.id} run={run} locale={locale} />
                ))}
              </ul>
            )}
          </div>

          {/* Log history with day navigation */}
          <div>
            <div className="flex items-center justify-between gap-2 px-5 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                {c.history}
              </p>
              <div className="flex items-center gap-2">
                <Tooltip content={c.prevDay}>
                  <button
                    type="button"
                    onClick={() => setOffset((o) => Math.min(13, o + 1))}
                    disabled={offset >= 13}
                    aria-label={c.prevDay}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-40 focus-ring"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </Tooltip>
                <span className="min-w-[7rem] text-center text-xs tabular text-foreground-muted">
                  {format(selectedDate, "PPP", { locale })}
                </span>
                <Tooltip content={c.nextDay}>
                  <button
                    type="button"
                    onClick={() => setOffset((o) => Math.max(0, o - 1))}
                    disabled={offset <= 0}
                    aria-label={c.nextDay}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-40 focus-ring"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
            </div>
            {selected.length === 0 ? (
              <p className="px-5 py-4 text-sm text-foreground-subtle">
                {c.emptyDay}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {selected.map((run) => (
                  <RunRow key={run.id} run={run} locale={locale} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
