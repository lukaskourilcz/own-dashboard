import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { gitSha, githubWebUrl, MAX_GITHUB_FILE_BYTES } from "@/lib/github-file-contract";

export async function readGithubJson(response: Response, maxCharacters: number, signal: AbortSignal): Promise<unknown> {
  const body = await awaitWithSignal(readTextPrefix(response, maxCharacters), signal);
  if (body.truncated) throw new Error("GitHub response unavailable");
  return JSON.parse(body.text);
}
export function gitBlobSha(content: string | Uint8Array, format = 40): string {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash(format === 64 ? "sha256" : "sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
export const githubFileMetadata = z.object({ type: z.literal("file"), path: z.string(), sha: gitSha, html_url: githubWebUrl, size: z.number().int().nonnegative() });
export function decodeGithubFile(raw: unknown, expectedPath: string) {
  const file = githubFileMetadata.extend({ encoding: z.literal("base64"), content: z.string().max(1_500_000) }).parse(raw);
  if (file.path !== expectedPath || file.size > MAX_GITHUB_FILE_BYTES) throw Error("GitHub file unavailable");
  const encoded = file.content.replace(/[\r\n]/g, "");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || bytes.byteLength !== file.size || gitBlobSha(bytes, file.sha.length) !== file.sha) throw Error("GitHub file unavailable");
  const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  return { content, html_url: file.html_url, sha: file.sha };
}
