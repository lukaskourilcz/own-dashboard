import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { awaitWithSignal } from "@/lib/abortable";
import { databaseTimestamp, databaseVersion } from "@/lib/database-version";
import type { SpendCategory } from "@/lib/types";

export const SPEND_CATEGORY_NAME_MAX = 100;
const columns = "id,user_id,name,sort_order,created_at";
const rowSchema = z.object({ id: z.uuid(), user_id: z.uuid(), name: z.string().min(1).max(1000).refine(value => value.trim() === value), sort_order: z.number().int().min(-2147483648).max(2147483647), created_at: databaseTimestamp }).strict();
const intentSchema = z.object({ id: z.uuid(), name: z.string().min(1).max(SPEND_CATEGORY_NAME_MAX).refine(value => value.trim() === value), sortOrder: rowSchema.shape.sort_order }).strict();
export type SpendCategoryIntent = z.infer<typeof intentSchema>;
export type SpendCategoryScope = { ownerId: string; signal: AbortSignal };
export class SpendCategoryError extends Error {
  constructor(readonly reason: "unavailable" | "changed" = "unavailable") { super("Category unavailable"); }
}
const signalFor = (scope: SpendCategoryScope) => AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)]);
const ownedRow = (value: unknown, owner: string): SpendCategory => {
  const row = rowSchema.parse(value);
  if (row.user_id !== owner) throw new SpendCategoryError();
  return row;
};
export function orderSpendCategories(rows: readonly SpendCategory[]): SpendCategory[] {
  const keyed = rows.map(row => {
    const version = databaseVersion(row.created_at);
    if (version === null) throw new SpendCategoryError();
    return { row, version };
  });
  return keyed.sort((left, right) => left.row.sort_order - right.row.sort_order || (left.version < right.version ? -1 : left.version > right.version ? 1 : left.row.id.localeCompare(right.row.id))).map(item => item.row);
}
export async function readSpendCategoryRecords(db: SupabaseClient, scope: SpendCategoryScope): Promise<SpendCategory[]> {
  const signal = signalFor(scope);
  try {
    z.uuid().parse(scope.ownerId); signal.throwIfAborted();
    const result = await awaitWithSignal(db.from("spend_categories").select(columns, { count: "exact" }).eq("user_id", scope.ownerId)
      .order("sort_order", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1000).retry(false).abortSignal(signal), signal);
    const { data, count, error } = result;
    if (error || !Array.isArray(data) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > 1000 || data.length !== count) throw new SpendCategoryError();
    const ids = new Set<string>(), names = new Set<string>();
    return orderSpendCategories(data.map(value => {
      const row = ownedRow(value, scope.ownerId), name = row.name.toLowerCase();
      if (ids.has(row.id) || names.has(name)) throw new SpendCategoryError();
      ids.add(row.id); names.add(name); return row;
    }));
  } catch { throw new SpendCategoryError(); }
}

/** The captured id survives an uncertain retry. A unique-name collision is
 * resolved only from a complete fresh owned read, preserving server spelling. */
export async function createSpendCategoryRecord(db: SupabaseClient, scope: SpendCategoryScope, value: SpendCategoryIntent): Promise<SpendCategory> {
  const signal = signalFor(scope);
  try {
    const intent = intentSchema.parse(structuredClone(value)), owner = z.uuid().parse(scope.ownerId); signal.throwIfAborted();
    const result = await awaitWithSignal(db.from("spend_categories").insert({ id: intent.id, user_id: owner, name: intent.name, sort_order: intent.sortOrder })
      .select(columns).retry(false).abortSignal(signal).maybeSingle(), signal);
    if (result.error) {
      if (Object.hasOwn(result.error, "code") && result.error.code === "23505") {
        const rows = await readSpendCategoryRecords(db, { ownerId: owner, signal });
        const found = rows.find(row => row.name.toLowerCase() === intent.name.toLowerCase());
        if (found) return found;
      }
      throw new SpendCategoryError();
    }
    const row = ownedRow(result.data, owner);
    if (row.id !== intent.id || row.name !== intent.name || row.sort_order !== intent.sortOrder) throw new SpendCategoryError();
    signal.throwIfAborted(); return row;
  } catch { throw new SpendCategoryError(); }
}

/** Remove only the captured row. No optimistic whole-list rollback and no
 * unconfirmed zero-row success; existing entity category strings stay intact. */
export async function removeSpendCategoryRecord(db: SupabaseClient, scope: SpendCategoryScope, value: SpendCategory): Promise<void> {
  const signal = signalFor(scope);
  try {
    const expected = ownedRow(structuredClone(value), z.uuid().parse(scope.ownerId)); signal.throwIfAborted();
    const result = await awaitWithSignal(db.from("spend_categories").delete().eq("id", expected.id).eq("user_id", expected.user_id).eq("name", expected.name)
      .eq("sort_order", expected.sort_order).eq("created_at", expected.created_at).select(columns).retry(false).abortSignal(signal).maybeSingle(), signal);
    if (result.error) throw new SpendCategoryError();
    if (!result.data) throw new SpendCategoryError("changed");
    const removed = ownedRow(result.data, expected.user_id);
    if (removed.id !== expected.id || removed.name !== expected.name || removed.sort_order !== expected.sort_order || databaseVersion(removed.created_at) !== databaseVersion(expected.created_at)) throw new SpendCategoryError();
    signal.throwIfAborted();
  } catch (error) { throw error instanceof SpendCategoryError ? error : new SpendCategoryError(); }
}
