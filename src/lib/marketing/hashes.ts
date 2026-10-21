import { createHash } from "node:crypto";
import { canonicalJson, type ContentRevision } from "./contracts";

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * The revision as the owner approves it: every field except the assets' delivery URLs. A signed URL is a
 * temporary link to bytes whose sha256 the revision already records, so renewing it is not a content change.
 */
export function revisionWithoutDeliveryUrls(revision: ContentRevision): Omit<ContentRevision, "assets"> & { assets: Omit<ContentRevision["assets"][number], "url">[] } {
  // Drop only `url`, so any asset field added later is covered by the hash by default.
  return { ...revision, assets: revision.assets.map((asset) => { const { url, ...identity } = asset; void url; return identity; }) };
}

/**
 * The approval identity stored as `content_hash` and bound by `approved_hash`: sha256 of the canonical JSON of the
 * revision without delivery URLs. It covers caption, title, format, the deck (slide text, image asset hashes, crops,
 * order), every asset's sha256, MIME type, dimensions and alt text, the account, schedule, sources, collaborators
 * and versions.
 */
export function revisionContentHash(revision: ContentRevision): string {
  return contentHash(revisionWithoutDeliveryUrls(revision));
}

/** @deprecated Same function as `revisionContentHash`; kept so callers written before #118 keep the new identity. */
export const revisionHash = revisionContentHash;
