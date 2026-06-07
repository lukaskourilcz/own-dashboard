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
  return (
    <div
      className="grid grid-flow-col gap-[3px]"
      style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))" }}
    >
      {cells.map(({ date, hit }) => (
        <div
          key={date}
          title={date}
          className={cn(
            "h-2.5 w-2.5 rounded-[2px] transition-opacity",
            !hit && "bg-surface-muted",
          )}
          style={hit ? { background: color } : undefined}
        />
      ))}
    </div>
  );
}
