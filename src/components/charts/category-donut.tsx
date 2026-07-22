"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatCurrency } from "@/lib/utils";
import { chartTooltipStyle } from "./shared";

/** Reusable donut for a {name, value} breakdown in a display currency. Loaded
 * lazily (recharts is heavy) — see the dynamic import in the consuming panels. */
export function CategoryDonut({
  data,
  currency,
  innerRadius = 45,
  outerRadius = 85,
}: {
  data: { name: string; value: number }[];
  currency: string;
  innerRadius?: number;
  outerRadius?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={1.5}
          stroke="var(--surface)"
          strokeWidth={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => formatCurrency(Number(value), currency)}
          contentStyle={chartTooltipStyle}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
