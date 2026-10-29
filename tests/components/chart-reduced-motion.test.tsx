// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SpendBarChart } from "@/components/charts/spend-bar-chart";
import { MonthsBarChart } from "@/components/charts/months-bar-chart";
import { CategoryDonut } from "@/components/charts/category-donut";
const state = vi.hoisted(() => ({ reduce: null as boolean | null, animated: [] as unknown[] }));
vi.mock("motion/react", () => ({ useReducedMotion: () => state.reduce }));
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Shape = ({ isAnimationActive, children }: { isAnimationActive?: boolean; children?: ReactNode }) => { state.animated.push(isAnimationActive); return <div>{children}</div>; };
  return { ResponsiveContainer: Box, BarChart: Box, PieChart: Box, Bar: Shape, Pie: Shape, Cell: Box, Legend: Box, Tooltip: Box, XAxis: Box, YAxis: Box };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { state.animated = []; });
it.each([true, false, null])("all financial charts honor reduced motion %s without initial movement when unknown", reduce => {
  state.reduce = reduce; const host = document.createElement("div"), root = createRoot(host);
  act(() => root.render(<><SpendBarChart data={[]} currency="USD" committedLabel="Synthetic commitment" paidLabel="Synthetic paid"/><MonthsBarChart data={[]} currency="USD" incomeLabel="Synthetic income" expenseLabel="Synthetic expense"/><CategoryDonut data={[]} currency="USD"/></>));
  expect(state.animated).toHaveLength(5); expect(state.animated.every(active => active === (reduce === false))).toBe(true); act(() => root.unmount());
});
