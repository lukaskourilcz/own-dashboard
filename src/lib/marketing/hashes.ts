import { createHash } from "node:crypto";
import { canonicalJson, type ContentRevision } from "./contracts";

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function revisionHash(revision: ContentRevision): string {
  return contentHash(revision);
}
