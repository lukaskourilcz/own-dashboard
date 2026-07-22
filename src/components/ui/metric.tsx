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
    <div className={cn("border-l-2 px-3 py-2", tone === "attention" ? "border-warning" : tone === "risk" ? "border-risk" : "border-border-strong", className)}>
      <div className="flex items-center gap-2 text-[11px] font-medium text-foreground-muted">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
        <span>{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold tracking-[-0.02em] tabular text-foreground">{value}</p>
      {detail && <p className="mt-0.5 text-[11px] text-foreground-subtle">{detail}</p>}
    </div>
  );
}
