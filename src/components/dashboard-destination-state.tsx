"use client";

import { Button } from "@/components/ui/button";
import { useDict } from "@/lib/i18n";
import type { EntityStatus } from "@/lib/queries/entities";

/** Keep writes behind successful reads on in-shell navigation as well as SSR. */
export function DashboardDestinationBoundary({ statuses, onRetry, children }: { statuses: EntityStatus[]; onRetry: () => void; children: React.ReactNode }) {
  const t = useDict().common;
  if (statuses.every(status => status.ready)) return children;
  const failed = statuses.some(status => status.failed);
  if (!failed) return <p role="status" className="py-6 text-sm text-foreground-muted">{t.loading}</p>;
  return <div className="space-y-3 py-6">
    <h1 className="text-lg font-semibold">{t.dataUnavailable}</h1>
    <p role="alert" className="text-sm text-foreground-muted">{t.dataUnavailableDescription}</p>
    <Button onClick={onRetry}>{t.retry}</Button>
  </div>;
}
