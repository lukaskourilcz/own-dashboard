/** Slice an already complete collection locally. This never authorizes a
 * truncated server read; every original row remains reachable in its order. */
export function collectionPage<T>(rows: readonly T[], requestedIndex: number, pageSize = 50) {
 if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('Invalid page size');
 const pages = Math.max(1, Math.ceil(rows.length / pageSize));
 const index = Math.min(pages - 1, Number.isInteger(requestedIndex) && requestedIndex > 0 ? requestedIndex : 0);
 const start = index * pageSize;
 return { index, items: rows.slice(start, start + pageSize), from: rows.length ? start + 1 : 0, to: Math.min(rows.length, start + pageSize), total: rows.length, pages };
}
export type CollectionPage = Pick<ReturnType<typeof collectionPage>, 'index' | 'from' | 'to' | 'total' | 'pages'>;
