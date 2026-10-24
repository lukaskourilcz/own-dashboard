import { beginRepositoryFilterIntent, parseRepositoryFilter, repositoryFilterRevision, writeRepoFilter } from "@/lib/repository-filter";
import { saveUserPreferences } from "@/lib/preference-client";

export async function saveRepositoryFilter(input: readonly string[]) {
  const ids = parseRepositoryFilter(input);
  if (!ids) throw Error("Invalid repository filter");
  const intent = beginRepositoryFilterIntent();
  let device = writeRepoFilter(ids, { expectedRevision: intent }), server = false;
  const captured = repositoryFilterRevision();
  try { await saveUserPreferences({ visible_repo_ids: ids }); server = true; }
  catch { if (!device) throw Error("Repository filter unconfirmed"); }
  if (captured !== repositoryFilterRevision()) return { device, server, current: false };
  if (!device && server) device = writeRepoFilter(ids, { allowMemoryFallback: true, expectedRevision: captured });
  return { device, server, current: true };
}
