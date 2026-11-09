import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * The per-owner share token for the iOS Shortcut (docs/ig-kolekce.md). The database keeps only its SHA-256; the
 * token itself is shown once when the owner creates or rotates it. A rotation replaces the hash, so the old token
 * stops working at once.
 */
export const SHARE_TOKEN_PATTERN = /^igk_[A-Za-z0-9_-]{43}$/;
export const newShareToken = () => `igk_${randomBytes(32).toString("base64url")}`;
export const hashShareToken = (token: string) => createHash("sha256").update(token).digest("hex");
