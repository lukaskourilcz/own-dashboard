import type { CSSProperties } from "react";

/** Tooltip surface shared by every Recharts chart, matching the app's cards. */
export const chartTooltipStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  fontSize: "12px",
  boxShadow: "var(--shadow-card)",
  padding: "6px 10px",
};
