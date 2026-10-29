'use client';
import { CollectionPagination } from '@/components/ui/collection-pagination';
import { useDict } from '@/lib/i18n';
import type { competitorPage } from '@/lib/competition';

type Page = Pick<ReturnType<typeof competitorPage>, 'index' | 'from' | 'to' | 'total' | 'pages'>;
/** Both views page the same complete data locally; controls make the visible
 * range explicit without another database request or thousands of row mounts. */
export function CompetitionPagination({ page, onPage }: { page: Page; onPage: (index: number) => void }) {
 const p = useDict().portfolio;
 return <CollectionPagination page={page} onPage={onPage} label={p.competitorPages} range={p.competitorPageRange} previous={p.competitorPrevious} next={p.competitorNext} />;
}
