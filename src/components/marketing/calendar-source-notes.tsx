"use client";

import { useDict } from "@/lib/i18n";
import type { MarketingSourceResult } from "@/lib/marketing-calendars";
import { cn } from "@/lib/utils";

/**
 * One line per calendar that could not be used, naming the file and the
 * reason, plus a note when a readable calendar had items it could not use.
 * Renders nothing when every calendar was read cleanly.
 */
export function CalendarSourceNotes({ sources, className }: { sources: readonly MarketingSourceResult[]; className?: string }) {
  const m = useDict().marketing;
  const reason = (source: MarketingSourceResult): string => {
    switch (source.status) {
      case "wrong-project":
        return m.reason["wrong-project"](source.detail);
      case "error":
        return m.reason.error(source.detail);
      case "ok":
        return "";
      default:
        return m.reason[source.status];
    }
  };
  const problems = sources.filter((source) => source.status !== "ok");
  const skipped = sources.filter((source) => source.status === "ok" && (source.calendar?.skipped ?? 0) > 0);
  if (problems.length === 0 && skipped.length === 0) return null;
  return (
    <ul className={cn("space-y-1 text-xs", className)}>
      {problems.map((source) => (
        <li key={source.id} data-calendar-problem={source.id} className="text-warning [overflow-wrap:anywhere]">
          {m.couldNotRead(`${source.repo}/${source.path}`, reason(source))}
        </li>
      ))}
      {skipped.map((source) => (
        <li key={source.id} className="text-foreground-muted [overflow-wrap:anywhere]">
          {m.skipped(source.label, source.calendar!.skipped)}
        </li>
      ))}
    </ul>
  );
}
