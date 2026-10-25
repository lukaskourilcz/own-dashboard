'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDict } from '@/lib/i18n';
import type { competitorPage } from '@/lib/competition';

type Page = Pick<ReturnType<typeof competitorPage>, 'index' | 'from' | 'to' | 'total' | 'pages'>;
/** Both views page the same complete data locally; controls make the visible
 * range explicit without another database request or thousands of row mounts. */
export function CompetitionPagination({ page, onPage }: { page: Page; onPage: (index: number) => void }) {
 const p = useDict().portfolio;
 if (page.pages <= 1) return null;
 return <nav aria-label={p.competitorPages} className="my-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
  <p role="status" className="text-xs tabular text-foreground-muted">{p.competitorPageRange(page.from, page.to, page.total)}</p>
  <div className="grid grid-cols-2 gap-2 sm:min-w-56">
   <Button size="sm" variant="outline" className="md:h-8" disabled={page.index === 0} onClick={() => onPage(page.index - 1)}><ChevronLeft aria-hidden />{p.competitorPrevious}</Button>
   <Button size="sm" variant="outline" className="md:h-8" disabled={page.index >= page.pages - 1} onClick={() => onPage(page.index + 1)}>{p.competitorNext}<ChevronRight aria-hidden /></Button>
  </div>
 </nav>;
}
