import { describe, expect, it } from "vitest";
import { costMonthlyIn } from "@/lib/projects";
import { projectCostEvidence, costEvidenceHref } from "@/lib/project-cost-evidence";
import { summarizeDevFinance } from "@/lib/dev-finance";
import { projects, subscriptions, subscriptionAllocations, transactions, projectCosts, crons } from "@/lib/demo/fixtures";
import type { ProjectCost, Transaction } from "@/lib/types";

const project = projects[0];
const base = { projects, subscriptions, allocations: subscriptionAllocations, transactions, projectCosts, crons, currency: "USD", now: new Date("2026-11-10") };
const usage: ProjectCost = { ...projectCosts[0], id: "usage", project_id: project.id, amount: 12, cost_type: "usage", period_start: "2026-11-01T00:00:00Z", period_end: "2026-11-10T00:00:00Z", source_key: "provider-period" };
const tx = (kind: "expense" | "income", amount: number): Transaction => ({ ...transactions[0], id: `${kind}-${amount}`, kind, amount, currency: "USD", project_id: project.id, subscription_id: null, occurred_on: "2026-11-09", category: kind === "income" ? "development_refund" : "development" });

describe("project cost evidence", () => {
  it("keeps usage/credits out of monthly commitments and payments", () => {
    expect(costMonthlyIn(usage, "USD")).toBe(0);
    expect(costMonthlyIn({ ...usage, cost_type: "credit" }, "USD")).toBe(0);
    const a = projectCostEvidence(project, { ...base, transactions: [], projectCosts: [] });
    const b = projectCostEvidence(project, { ...base, transactions: [], projectCosts: [usage] });
    expect(b.recurring).toBe(a.recurring); expect(b.paid).toBe(0); expect(b.usage).toHaveLength(1);
  });
  it("nets refunds, excludes shared payments, and keeps direct attribution over subscription allocations", () => {
    const rows = [tx("expense", 30), tx("income", 5), { ...tx("expense", 100), id: "shared", project_id: null }];
    expect(projectCostEvidence(project, { ...base, transactions: rows }).paid).toBe(25);
    const summary = summarizeDevFinance({ ...base, transactions: rows, months: 12 });
    expect(summary.paidLastMonths).toBe(125);
    expect(summary.byProject.find(row => row.project.id === project.id)?.paidTotal).toBe(25);
  });
  it("never converts an unsafe source URL into a link", () => {
    expect(costEvidenceHref("javascript:alert(1)")).toBeNull();
    expect(costEvidenceHref("https://user:password@example.com")).toBeNull();
    expect(costEvidenceHref("https://supabase.com/dashboard")).toBe("https://supabase.com/dashboard");
  });
});
