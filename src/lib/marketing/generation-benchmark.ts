import { z } from "zod";
import { parseSourcePacket, sourceUsable } from "./contracts";
import { MarketingCopySchema, validateMarketingCopy } from "./generation";
import { contentHash } from "./hashes";

export type MarketingBenchmarkExample = {
  id: string; source: unknown; copy: unknown; expectedIssueCodes: string[];
};
export type MarketingBenchmarkResult = {
  exampleIdHash: string; brand: "dneskai" | "devshark";
  sourceIdHash: string; sourceRevisionHash: string; sourceContentHash: string;
  issueCodes: string[]; passed: boolean;
};
/** Offline deterministic evaluations. Raw source/copy stays local; no LLM judge or unconsented upload. */
export function evaluateMarketingBenchmark(examples: MarketingBenchmarkExample[], now: Date): MarketingBenchmarkResult[] {
  if (examples.length > 50) throw new Error("benchmark-too-large");
  return examples.map((example) => {
    const source = parseSourcePacket(example.source);
    const copy = MarketingCopySchema.safeParse(example.copy);
    const issueCodes: string[] = [];
    if (source.contentHash !== contentHash(source.content)) issueCodes.push("source-hash-mismatch");
    if (!sourceUsable(source, now)) issueCodes.push("source-unavailable");
    if (source.kind === "coding-task" && !source.content.explanation) issueCodes.push("authored-explanation-required");
    if (!copy.success) issueCodes.push("invalid-schema");
    else issueCodes.push(...validateMarketingCopy(copy.data, source));
    const issues = [...new Set(issueCodes)].sort();
    const expected = z.array(z.string().regex(/^[a-z-]{1,80}$/)).max(30).parse(example.expectedIssueCodes).sort();
    return {
      exampleIdHash: contentHash(example.id), brand: source.brand, sourceIdHash: contentHash(source.sourceId),
      sourceRevisionHash: contentHash(source.sourceRevision), sourceContentHash: source.contentHash,
      issueCodes: issues, passed: JSON.stringify(issues) === JSON.stringify(expected),
    };
  });
}
