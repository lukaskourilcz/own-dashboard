import { beginRepositoryFilterIntent, parseRepositoryFilter, repositoryFilterRevision, writeRepoFilter } from "@/lib/repository-filter";

export async function saveRepositoryFilter(input: readonly string[], savePreferences: (patch: Record<string, unknown>) => Promise<void>) {
  const ids = parseRepositoryFilter(input);
  if (!ids) throw Error("Invalid repository filter");
  const intent = beginRepositoryFilterIntent();
  let device = writeRepoFilter(ids, { expectedRevision: intent }), server = false;
  const captured = repositoryFilterRevision();
  try { await savePreferences({ visible_repo_ids: ids }); server = true; }
  catch { if (!device) throw Error("Repository filter unconfirmed"); }
  if (captured !== repositoryFilterRevision()) return { device, server, current: false };
  if (!device && server) device = writeRepoFilter(ids, { allowMemoryFallback: true, expectedRevision: captured });
  return { device, server, current: true };
}
