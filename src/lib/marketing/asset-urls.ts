import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { AssetSchema, parseContentRevision, type ContentRevision } from "./contracts";
import { revisionContentHash } from "./hashes";

type Database = ReturnType<typeof createAdminClient>;
type Asset = ContentRevision["assets"][number];
const bucket = "marketing-assets";
const expiresIn = 7 * 24 * 60 * 60;
const maxBytes = 8 * 1024 * 1024;
const prefix = `/storage/v1/object/sign/${bucket}/`;
export class MarketingAssetUrlError extends Error {
  constructor(readonly code: string) { super(code); this.name = "MarketingAssetUrlError"; }
}
const hold = (code: string): never => { throw new MarketingAssetUrlError(code); };
function trustedOrigin(value: string | undefined): string {
  try {
    if (!value || value !== value.trim()) return hold("asset-storage-origin-required");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return hold("asset-storage-origin-required");
    return url.origin;
  } catch { return hold("asset-storage-origin-required"); }
}
type AssetKey =
  | { key: string; kind: "revision"; revisionId: string; templateSha256: string }
  | { key: string; kind: "dneskai-slide"; renderKey: string };
function assetKey(value: string, owner: string, sha256: string, origin: string): AssetKey {
  try {
    if (value !== value.trim() || /[\x00-\x20\x7f\\]/.test(value)) return hold("asset-url-untrusted");
    const url = new URL(value);
    if (url.origin !== origin || url.protocol !== "https:" || url.username || url.password || url.hash || !url.pathname.startsWith(prefix)) return hold("asset-url-untrusted");
    const queries = [...url.searchParams];
    if (queries.length !== 1 || queries[0][0] !== "token" || !queries[0][1] || queries[0][1].length > 8192) return hold("asset-url-untrusted");
    // Inspect the original path too: URL() would silently normalize dot segments
    // or backslashes before ownership validation. Decode a key exactly once.
    const rawPath = /^https:\/\/[^/?#]+([^?#]*)/.exec(value)?.[1];
    if (!rawPath || rawPath !== url.pathname || /(?:^|\/)\.{1,2}(?:\/|$)|%2e|%2f|%5c/i.test(rawPath)) return hold("asset-url-untrusted");
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    // Slide positions 1-10: a DNESKAi carousel has up to ten slides.
    // A DNESKAi studio slide is cached by its render key (#117), so one stored JPEG can serve several revisions.
    // Its identity is the sha256 recorded in the object's metadata and re-hashed below, never the key itself.
    const slide = /^([a-f0-9-]{36})\/marketing\/dneskai\/slides\/([a-f0-9]{64})\.jpg$/.exec(key);
    if (slide) {
      if (slide[1] !== owner) return hold("asset-url-untrusted");
      return { key, kind: "dneskai-slide", renderKey: slide[2] };
    }
    const match = /^([a-f0-9-]{36})\/marketing\/(?:dneskai|devshark)\/([a-f0-9-]{36})\/([a-f0-9]{64})\/(?:[1-9]|10)-([a-f0-9]{64})\.jpg$/.exec(key);
    if (!match || match[1] !== owner || !z.uuid().safeParse(match[2]).success || match[4] !== sha256) return hold("asset-url-untrusted");
    return { key, kind: "revision", revisionId: match[2], templateSha256: match[3] };
  } catch { return hold("asset-url-untrusted"); }
}

function storedProofValid(item: AssetKey, metadata: Record<string, unknown>): boolean {
  if (item.kind === "dneskai-slide") return metadata.renderKey === item.renderKey;
  return metadata.revisionId === item.revisionId && metadata.templateSha256 === item.templateSha256 &&
    /^[a-f0-9]{64}$/.test(String(metadata.designExportSha256 ?? "")) && /^[a-f0-9]{64}$/.test(String(metadata.svgSha256 ?? "")) &&
    typeof metadata.rendererVersion === "string" && !!metadata.rendererVersion && metadata.rendererVersion.length <= 120;
}

/** Renew only previously prepared private assets. No URL is fetched, uploaded
 * or replaced. The stored bytes are re-hashed against `sha256` before any new
 * URL is signed; the URLs themselves are not part of the approval hash. */
export async function refreshMarketingAssetUrls(db: Database, ownerId: string, assets: Asset[], options: { supabaseUrl?: string } = {}): Promise<Asset[]> {
  if (!z.uuid().safeParse(ownerId).success) return hold("asset-owner-invalid");
  const parsed = z.array(AssetSchema).max(10).safeParse(assets);
  if (!parsed.success) return hold("asset-input-invalid");
  if (!parsed.data.length) return [];
  const origin = trustedOrigin(options.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  const prepared = parsed.data.map((asset) => {
    if (asset.mimeType !== "image/jpeg") return hold("asset-mime-unsupported");
    return { asset, ...assetKey(asset.url, ownerId, asset.sha256, origin) };
  });
  try {
    const { data: config, error: bucketError } = await db.storage.getBucket(bucket);
    if (bucketError || !config || config.public !== false) return hold("private-asset-bucket-required");
    const files = db.storage.from(bucket);
    // Verify the whole bounded batch before creating any replacement URL.
    for (const item of prepared) {
      const { data: info, error } = await files.info(item.key);
      const metadata = info?.metadata;
      if (error || !info || info.name !== item.key || info.bucketId !== bucket || !Number.isInteger(info.size) || !info.size || info.size > maxBytes || info.contentType !== "image/jpeg" ||
        metadata?.ownerId !== ownerId || metadata.sha256 !== item.asset.sha256 || !storedProofValid(item, metadata)) return hold("stored-asset-proof-invalid");
      const downloaded = await files.download(item.key, {}, { cache: "no-store" });
      if (downloaded.error || !downloaded.data || downloaded.data.size !== info.size || downloaded.data.size > maxBytes || downloaded.data.type.split(";")[0] !== "image/jpeg") return hold("stored-asset-download-invalid");
      const bytes = Buffer.from(await downloaded.data.arrayBuffer());
      if (bytes.length !== info.size || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9 ||
        createHash("sha256").update(bytes).digest("hex") !== item.asset.sha256) return hold("stored-asset-hash-or-mime-invalid");
    }
    const renewed: Asset[] = [];
    for (const item of prepared) {
      const signed = await files.createSignedUrl(item.key, expiresIn);
      if (signed.error || !signed.data?.signedUrl) return hold("asset-signing-failed");
      if (assetKey(signed.data.signedUrl, ownerId, item.asset.sha256, origin).key !== item.key) return hold("asset-signing-failed");
      renewed.push({ ...item.asset, url: signed.data.signedUrl });
    }
    return renewed;
  } catch (error) {
    if (error instanceof MarketingAssetUrlError) throw error;
    return hold("asset-storage-unavailable"); // Never expose native credentials or exception text.
  }
}

/**
 * Writes renewed signed URLs into the stored revision itself (#118). The bytes behind every asset are re-verified
 * first; `marketing_renew_revision_asset_urls` then checks in SQL that only `assets[].url` changed and that each URL
 * signs the same object. `content_hash`, `approved_hash` and the approval stay, and no revision is created.
 */
export async function renewStoredRevisionAssetUrls(db: Database, ownerId: string, revisionId: string, options: { supabaseUrl?: string } = {}):
  Promise<{ revisionId: string; contentHash: string; renewed: number }> {
  if (!z.uuid().safeParse(ownerId).success) return hold("asset-owner-invalid");
  if (!z.uuid().safeParse(revisionId).success) return hold("asset-input-invalid");
  let stored: { revision: unknown; content_hash: string; status: string } | null;
  try {
    const { data, error } = await db.from("marketing_revisions").select("revision,content_hash,status").eq("user_id", ownerId).eq("id", revisionId).maybeSingle();
    if (error) return hold("asset-storage-unavailable");
    stored = data;
  } catch { return hold("asset-storage-unavailable"); }
  if (!stored) return hold("revision-unavailable");
  if (!["review", "approved"].includes(stored.status)) return hold("revision-not-renewable");
  let revision: ContentRevision;
  try { revision = parseContentRevision(stored.revision); } catch { return hold("asset-input-invalid"); }
  // A row whose stored hash is not the URL-free identity was not written by this release: do not touch it.
  if (revisionContentHash(revision) !== stored.content_hash) return hold("revision-identity-mismatch");
  if (!revision.assets.length) return { revisionId, contentHash: stored.content_hash, renewed: 0 };
  const assets = await refreshMarketingAssetUrls(db, ownerId, revision.assets, options);
  if (revisionContentHash({ ...revision, assets }) !== stored.content_hash) return hold("revision-identity-mismatch");
  try {
    const { data, error } = await db.rpc("marketing_renew_revision_asset_urls", { p_owner: ownerId, p_revision: revisionId, p_expected_hash: stored.content_hash, p_assets: assets });
    const result = data as { contentHash?: unknown; renewed?: unknown } | null;
    if (error || !result || result.contentHash !== stored.content_hash || result.renewed !== assets.length) return hold("asset-url-renewal-refused");
  } catch { return hold("asset-url-renewal-refused"); }
  return { revisionId, contentHash: stored.content_hash, renewed: assets.length };
}
