import { z } from "zod";
/**
 * The surfaces that own a hook library.
 *
 * A surface is not a brand. The quiz surface is defined by the shape of question it gates on, not
 * by devShark; DNESKAi and MMA Files are separate surfaces because a briefing item and a magazine
 * article carry different metadata and a quiz gate cannot evaluate against either. See
 * `docs/hooks/05-surfaces.md`.
 */
export const SURFACES = ["quiz", "news", "mma"];
/**
 * The verticals a hook carries a line for. Every surface has exactly one, named `dev`.
 *
 * The quiz surface had a second, `geo`, for StudyShark's geography brand. It left with StudyShark,
 * and a vertical that no brand serves is copy nobody reads, so the enum names only what a brand can
 * still ask for.
 */
export const VERTICALS = ["dev"];
export const LANGUAGES = ["en", "cs"];
/**
 * Per-surface predicate vocabularies.
 *
 * A predicate outside its surface's vocabulary is a load-time error naming the hook and the
 * surface, never a silent skip: a skipped gate is an ungated claim, and an ungated claim on a
 * quiz surface is the exact failure `docs/hooks/02-hook-craft-rules.md` calls non-negotiable.
 */
export const VOCABULARIES = {
    quiz: {
        always: { arity: "none" },
        hasCode: { arity: "none" },
        optionsAtLeast: { arity: "number", field: "count" },
        optionsExactly: { arity: "number", field: "count" },
        difficultyAtLeast: { arity: "number", field: "level" },
        categoryIn: { arity: "string", field: "list" },
        questionStartsWith: { arity: "string", field: "prefix" }
    },
    news: {
        always: { arity: "none" },
        hasNumber: { arity: "none" },
        sourceCount: { arity: "number", field: "count" },
        primarySources: { arity: "number", field: "count" },
        signalStrengthAtLeast: { arity: "number", field: "score" },
        topicIn: { arity: "string", field: "topic" }
    },
    mma: {
        always: { arity: "none" },
        hasEvent: { arity: "none" },
        formatIs: { arity: "string", field: "format" },
        fighterCount: { arity: "number", field: "count" },
        sourceCount: { arity: "number", field: "count" }
    }
};
/**
 * Tier B predicate names, kept out of every vocabulary on purpose.
 *
 * They are specified in `docs/hooks/04-schema-and-gates.md` and each has an open issue. Naming them
 * here buys one thing: a hook gated on `statsReady` fails to load with "not implemented yet, see
 * the Tier B issue" instead of with "unknown predicate", which is the difference between a build
 * order and a typo.
 */
export const TIER_B_PREDICATES = [
    "statsReady",
    "accuracyBelow",
    "accuracyAtLeast",
    "streakAtLeast",
    "missedTopicBefore",
    "timerEnabled"
];
const VariantTextSchema = z.object({
    en: z.string().min(1),
    cs: z.string().min(1)
});
/** The library file's own shape, before predicates are parsed. */
export const RawHookSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    cooldownDays: z.number().int().min(1).max(30),
    truthRequires: z.array(z.string().min(1)).min(1),
    /**
     * One line per vertical, exhaustively, and nothing else.
     *
     * A key outside `VERTICALS` fails the load rather than riding along unread, so a `geo` line
     * copied back from an old library is an error, not dead copy that looks shipped.
     */
    variants: z.record(z.enum(VERTICALS), VariantTextSchema)
});
export const RawLibrarySchema = z.array(RawHookSchema);
/**
 * The per-hook research record: the shipping bar from `docs/hooks/02-hook-craft-rules.md`, as
 * fields a check can read.
 *
 * It is a parallel file rather than fields on the hook because assignment needs compact copy while
 * authoring and lint need the full evidence/falsifiability record.
 */
export const CITATION_CONFIDENCES = ["verified", "recalled", "practitioner", "mechanism-only", "measured"];
export const HookResearchSchema = z.object({
    id: z.string().min(1),
    archetype: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    mechanism: z.string().min(1),
    citation: z.string().min(1),
    citationConfidence: z.enum(CITATION_CONFIDENCES),
    whyItEarnsTheSwipe: z.string().min(1),
    prediction: z.string().min(1),
    falsifiedIf: z.string().min(1),
    cooldownRationale: z.string().min(1),
    risk: z.string().min(1),
    gateJustification: z.string().min(1)
});
export const ResearchFileSchema = z.array(HookResearchSchema);
//# sourceMappingURL=schema.js.map