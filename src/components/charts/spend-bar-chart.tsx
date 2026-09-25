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

/** Committed (subscriptions) vs paid (invoices) development spend per month. Lazily loaded (recharts). */
export function SpendBarChart({
  data,
  currency,
  committedLabel,
  paidLabel,
}: {
  data: { label: string; committed: number; paid: number }[];
  currency: string;
  committedLabel: string;
  paidLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--foreground-subtle)" />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} stroke="var(--foreground-subtle)" />
        <Tooltip cursor={{ fill: "var(--surface-hover)" }} formatter={(value) => formatCurrency(Number(value), currency)} contentStyle={chartTooltipStyle} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="committed" fill="var(--chart-1)" name={committedLabel} radius={[3, 3, 0, 0]} />
        <Bar dataKey="paid" fill="var(--chart-3)" name={paidLabel} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
