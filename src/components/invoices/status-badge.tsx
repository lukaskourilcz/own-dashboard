"use client";

import { cn } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import type { InvoiceStatus } from "@/lib/types";

const TONE: Record<InvoiceStatus | "overdue", string> = {
  draft: "bg-surface-muted text-foreground-muted border-border",
  issued: "bg-accent text-foreground border-border-strong",
  paid: "bg-success/10 text-success border-success/30",
  overdue: "bg-destructive/10 text-destructive border-destructive/30",
  cancelled:
    "bg-surface-muted text-foreground-subtle border-border line-through",
};

export function StatusBadge({
  status,
  className,
}: {
  status: InvoiceStatus | "overdue";
  className?: string;
}) {
  const t = useDict();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONE[status],
        className,
      )}
    >
      {t.invoices.statusLabel[status]}
    </span>
  );
}
