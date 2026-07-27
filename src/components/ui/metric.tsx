import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Metric({ label, value, detail, icon: Icon, tone = "default", className }: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "attention" | "risk";
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-card", tone === "attention" ? "border-warning/35" : tone === "risk" ? "border-risk/35" : "", className)}>
      {Icon && (
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-[var(--section-accent,var(--mac-blue))]">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
      <div className="truncate text-[11px] font-medium text-foreground-muted">
        {label}
      </div>
      <p className="mt-0.5 text-[18px] font-bold leading-5 tracking-[-0.02em] tabular text-foreground">{value}</p>
      {detail && <p className="mt-0.5 text-[11px] text-foreground-subtle">{detail}</p>}
      </div>
    </div>
  );
}
