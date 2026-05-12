"use client";

import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";

type Props = {
  color: string;
  dates: Set<string>;
  weeks?: number;
};

export function StreakHeatmap({ color, dates, weeks = 12 }: Props) {
  const totalDays = weeks * 7;
  const cells = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = format(subDays(new Date(), i), "yyyy-MM-dd");
    cells.push({ date: d, hit: dates.has(d) });
  }
  // Each column = 7 cells (oldest at top), columns flow left-to-right ending
  // today at the bottom-right. grid-flow-col makes the natural index order
  // fill column-first, which matches GitHub's contribution graph layout.
  return (
    <div
      className="grid grid-flow-col gap-1"
      style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))" }}
    >
      {cells.map(({ date, hit }) => (
        <div
          key={date}
          title={date}
          className={cn(
            "h-3 w-3 rounded-[3px]",
            !hit && "bg-zinc-100 dark:bg-zinc-800",
          )}
          style={hit ? { background: color } : undefined}
        />
      ))}
    </div>
  );
}
