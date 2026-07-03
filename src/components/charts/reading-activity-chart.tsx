"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTooltipStyle } from "./shared";

/** Stacked pages-per-day bars for me (and optionally a partner). Lazily loaded
 * (recharts). */
export function ReadingActivityChart({
  data,
  isShared,
  meLabel,
  partnerLabel,
  pagesTooltip,
}: {
  data: { date: string; me: number; partner: number }[];
  isShared: boolean;
  meLabel: string;
  partnerLabel: string;
  pagesTooltip: (n: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          stroke="var(--foreground-subtle)"
        />
        <YAxis
          fontSize={10}
          width={24}
          tickLine={false}
          axisLine={false}
          stroke="var(--foreground-subtle)"
        />
        <Tooltip
          cursor={{ fill: "var(--surface-hover)" }}
          formatter={(value, name) => [
            pagesTooltip(Number(value)),
            name === "me" ? meLabel : partnerLabel,
          ]}
          contentStyle={chartTooltipStyle}
        />
        <Legend
          iconType="circle"
          iconSize={6}
          wrapperStyle={{ fontSize: 10 }}
          formatter={(name) => (name === "me" ? meLabel : partnerLabel)}
        />
        <Bar dataKey="me" stackId="a" fill="var(--foreground)" radius={[2, 2, 0, 0]} />
        {isShared && (
          <Bar
            dataKey="partner"
            stackId="a"
            fill="var(--foreground-subtle)"
            radius={[2, 2, 0, 0]}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
