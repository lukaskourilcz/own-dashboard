"use client";

import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import { chartTooltipStyle } from "./shared";

/** Income vs. expense bars over recent months. Lazily loaded (recharts). */
export function MonthsBarChart({
  data,
  currency,
  incomeLabel,
  expenseLabel,
}: {
  data: { label: string; income: number; expense: number }[];
  currency: string;
  incomeLabel: string;
  expenseLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barCategoryGap="25%"
      >
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          stroke="var(--foreground-subtle)"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={11}
          width={50}
          stroke="var(--foreground-subtle)"
        />
        <Tooltip
          cursor={{ fill: "var(--surface-hover)" }}
          formatter={(value) => formatCurrency(Number(value), currency)}
          contentStyle={chartTooltipStyle}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar
          dataKey="income"
          fill="var(--success)"
          name={incomeLabel}
          radius={[3, 3, 0, 0]}
        />
        <Bar
          dataKey="expense"
          fill="var(--destructive)"
          name={expenseLabel}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
