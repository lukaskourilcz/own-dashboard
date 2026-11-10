/** Usage ledgers are estimates of consumption, never invoice payments or prepaid top-ups. */
export type OperatingCost = { projectId: string; source: "collection" | "generation" | "generationReserved" | "devshark"; usd: number | null; rows: number; unknown: number; partial: boolean };
export type OperatingCosts = { start: string; end: string; items: OperatingCost[] };
export const OPERATING_COST_LIMIT = 5000;
export function operatingCost(source: OperatingCost["source"], projectId: string, rows: readonly { cost: unknown; pending?: boolean }[], partial = false): OperatingCost {
  let usd = 0, unknown = 0;
  for (const row of rows) {
    const amount = typeof row.cost === "number" ? row.cost : typeof row.cost === "string" && row.cost.trim() ? Number(row.cost) : NaN;
    if (row.pending || !Number.isFinite(amount) || amount < 0) unknown++;
    else usd += amount;
  }
  return { source, projectId, usd: rows.length > unknown ? usd : null, rows: rows.length, unknown, partial };
}
