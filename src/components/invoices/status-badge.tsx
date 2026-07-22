"use client";

import { StatusBadge as OperationalStatusBadge } from "@/components/ui/status-badge";
import { useDict } from "@/lib/i18n";
import type { InvoiceStatus } from "@/lib/types";

export function StatusBadge({
  status,
  className,
}: {
  status: InvoiceStatus | "overdue";
  className?: string;
}) {
  const t = useDict();
  return <OperationalStatusBadge value={status} label={t.invoices.statusLabel[status]} className={className} />;
}
