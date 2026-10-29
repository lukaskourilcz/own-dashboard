"use client";
import { Button } from "@/components/ui/button";
import { useDict } from "@/lib/i18n";

/** The two history views share one concise failure/retry treatment. */
export function HistoryReadNotice({ cached, missing, busy, onRetry }: { cached?: boolean; missing?: boolean; busy: boolean; onRetry: () => void }) {
  const t = useDict(), p = t.professional;
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground-muted">
    <p>{missing ? p.githubRepositoryUnavailable : cached ? p.githubCachedReadFailed : p.githubError}</p>
    <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>{t.common.retry}</Button>
  </div>;
}
