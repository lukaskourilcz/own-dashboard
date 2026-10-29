import { z } from "zod";

/** PostgreSQL serializes at most six fractional digits. Preserve them when a
 * receipt is compared with a cached source; JS dates alone lose microseconds. */
export const databaseTimestamp = z.iso.datetime({ offset: true }).max(40)
  .refine(value => (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 6);

export function databaseVersion(value: string): bigint | null {
  if (!databaseTimestamp.safeParse(value).success) return null;
  const fraction = (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0");
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(fraction.slice(3));
}
