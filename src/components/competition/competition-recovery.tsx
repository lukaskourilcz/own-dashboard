'use client';
import { Button } from '@/components/ui/button';
import { useDict } from '@/lib/i18n';
import type { CompetitorActions } from './use-competitor-actions';

/** One recovery action for retained data and unconfirmed row changes. */
export function CompetitionRecovery({ actions, refreshFailed = false }: { actions: CompetitorActions; refreshFailed?: boolean }) {
 const p = useDict().portfolio, readFailed = refreshFailed || actions.reloadFailed;
 if (!readFailed && !actions.notice) return null;
 return <div role="alert" className="mb-3 flex min-w-0 flex-col gap-2 rounded-md border border-border px-3 py-2 text-xs md:flex-row md:items-center md:justify-between">
  <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">{readFailed && <p>{p.competitorReadUnavailable}</p>}{actions.notice && <p>{p[actions.notice]}</p>}</div>
  <Button size="sm" variant="outline" disabled={actions.reloading || actions.pending.size > 0} aria-busy={actions.reloading} className="w-full shrink-0 md:w-auto" onClick={() => void actions.reload()}>{p.competitorReload}</Button>
 </div>;
}
