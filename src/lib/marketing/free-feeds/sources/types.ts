import { z } from "zod";

export const SOURCE_KINDS = [
  "rss",
  "html",
  "hn",
  "arxiv",
  "bluesky",
  "spaceflight",
  "github",
  "stackexchange"
] as const;

export const SourceKindSchema = z.enum(SOURCE_KINDS);

export const SourceItemSchema = z.object({
  sourceId: z.string().min(1),
  externalId: z.string().min(1),
  title: z.string().min(1).max(500),
  url: z.string().url().startsWith("https://"),
  publishedAt: z.string().datetime().nullable(),
  author: z.string().max(200).nullable(),
  summary: z.string().max(2_000),
  fetchedAt: z.string().datetime(),
  weight: z.number().min(0).max(1),
  tags: z.array(z.string().min(1)).max(12),
  promptInjectionSignals: z.array(z.string()).max(20),
  /** A publisher image URL the adapter saw for free (RSS media, card image, og:image). Never downloaded here. */
  imageUrl: z.string().url().startsWith("https://").max(2048).optional(),
  /**
   * `publishedAt` is an upper bound, not the publisher's timestamp: the latest instant that still
   * carries the stated day or month in any time zone, clamped to the fetch time.
   */
  dateEstimated: z.literal(true).optional()
});
export type SourceItem = z.infer<typeof SourceItemSchema>;

export const SourceConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    kind: SourceKindSchema,
    name: z.string().min(1),
    url: z.string().url().startsWith("https://"),
    query: z.string().min(1).optional(),
    repos: z.array(z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)).optional(),
    site: z.string().min(1).optional(),
    weight: z.number().min(0).max(1),
    tags: z.array(z.string().min(1)).min(1).max(12),
    enabled: z.boolean(),
    stage: z.array(z.string()).min(1),
    maxItems: z.number().int().min(1).max(50),
    credentialEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
    missingCredential: z.literal("skip").optional()
  })
  .superRefine((source, context) => {
    if (source.kind === "github" && !source.repos?.length) {
      context.addIssue({
        code: "custom",
        message: "github sources require repos",
        path: ["repos"]
      });
    }
    if (
      ["arxiv", "bluesky", "stackexchange"].includes(
        source.kind
      ) &&
      !source.query
    ) {
      context.addIssue({
        code: "custom",
        message: `${source.kind} sources require a query`,
        path: ["query"]
      });
    }
    if (source.credentialEnv && source.missingCredential !== "skip") {
      context.addIssue({
        code: "custom",
        message: "credentialed sources must self-skip when the credential is missing",
        path: ["missingCredential"]
      });
    }
  });
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export const SourceRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(SourceConfigSchema).length(32),
  disabledByDefault: z.array(
    z.object({ kind: z.string().min(1), reason: z.string().min(1) })
  )
});
export type SourceRegistry = z.infer<typeof SourceRegistrySchema>;

export interface SourceFetchContext {
  allowHosts: readonly string[];
  fetchImpl?: typeof fetch;
  resolveImpl?: (hostname: string) => Promise<string[]>;
  now: Date;
  /** Collection window start; adapters may skip optional per-item work for older entries. */
  since?: Date;
  signal?: AbortSignal;
  /** Defaults preserve existing pipelines; collection must explicitly prohibit both readers. */
  allowPaidReaders?: boolean;
  reportIssue?: (code: "fetch-failed" | "upstream-cap" | "reader-disabled") => void;
}
