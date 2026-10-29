'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CollectionPage } from '@/lib/collection-page';
/** Shared local range/navigation for complete collections, with the caller's
 * domain copy. Paging never requests more database or provider data. */
export function CollectionPagination({ page, onPage, label, range, previous, next, disabled = false, stacked = false }: {
 page: CollectionPage; onPage: (index: number) => void; label: string;
 range: (from: number, to: number, total: number) => string; previous: string; next: string; disabled?: boolean; stacked?: boolean;
}) {
 if (page.pages <= 1) return null;
 return <nav aria-label={label} className={stacked ? "my-3 flex flex-col gap-2" : "my-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"}>
  <p role="status" className="text-xs tabular text-foreground-muted">{range(page.from, page.to, page.total)}</p>
  <div className={stacked ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 gap-2 sm:min-w-56"}>
   <Button size="sm" variant="outline" className="md:h-8" disabled={disabled || page.index === 0} onClick={() => onPage(page.index - 1)}><ChevronLeft aria-hidden />{previous}</Button>
   <Button size="sm" variant="outline" className="md:h-8" disabled={disabled || page.index >= page.pages - 1} onClick={() => onPage(page.index + 1)}>{next}<ChevronRight aria-hidden /></Button>
  </div>
 </nav>;
}
