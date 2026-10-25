'use client';

import { CollectionPagination } from '@/components/ui/collection-pagination';
import type { CollectionPage } from '@/lib/collection-page';
import { useDict } from '@/lib/i18n';

export function CareerPagination({ page, onPage, label }: {
  page: CollectionPage;
  onPage: (index: number) => void;
  label: string;
}) {
  const { jobs: t } = useDict();
  return <CollectionPagination page={page} onPage={onPage} label={label}
    range={t.pageRange} previous={t.previousPage} next={t.nextPage} />;
}
