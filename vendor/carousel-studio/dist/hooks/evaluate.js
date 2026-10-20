import { createHash } from "node:crypto";
export function evaluateQuizPredicate(predicate, context) {
    const { subject, categoryLists } = context;
    switch (predicate.kind) {
        case "always":
            return true;
        case "hasCode":
            return subject.hasCode;
        case "optionsAtLeast":
            return subject.optionCount >= predicate.count;
        case "optionsExactly":
            // Not a stricter `optionsAtLeast`: it licenses counted imagery, where the number is the
            // line. "Four branches. One merges." is false on a five-option question, and
            // `optionsAtLeast:4` would happily serve it there.
            return subject.optionCount === predicate.count;
        case "difficultyAtLeast":
            return subject.difficulty >= predicate.level;
        case "categoryIn":
            return (categoryLists[predicate.list] ?? []).includes(subject.category);
        case "questionStartsWith":
            return subject.canonicalEnglishQuestion
                .trimStart()
                .toLowerCase()
                .startsWith(predicate.prefix.toLowerCase());
    }
}
export function evaluateNewsPredicate(predicate, context) {
    const { subject } = context;
    switch (predicate.kind) {
        case "always":
            return true;
        case "hasNumber":
            return subject.hasNumber;
        case "sourceCount":
            return subject.sourceCount >= predicate.count;
        case "primarySources":
            return subject.primarySourceCount >= predicate.count;
        case "signalStrengthAtLeast":
            // An unscored item fails the gate rather than defaulting past it. A weight claim on an
            // item nobody scored is a claim nothing licensed.
            return subject.signalStrength !== null && subject.signalStrength >= predicate.score;
        case "topicIn":
            return subject.tags.includes(predicate.topic);
    }
}
export function evaluateMmaPredicate(predicate, context) {
    const { subject } = context;
    switch (predicate.kind) {
        case "always":
            return true;
        case "hasEvent":
            return subject.hasEvent;
        case "formatIs":
            return subject.format === predicate.format;
        case "fighterCount":
            return subject.fighterCount >= predicate.count;
        case "sourceCount":
            return subject.sourceCount >= predicate.count;
    }
}
/**
 * `truthRequires` is a conjunction: every predicate must hold.
 *
 * There is no per-vertical substitution. A gate is a claim about the item in front of it, so
 * rewriting one to make a line reachable more often would render that line where it is untrue.
 */
export function hookIsEligible(hook, context) {
    return hook.truthRequires.every((predicate) => {
        switch (hook.surface) {
            case "quiz":
                return evaluateQuizPredicate(predicate, context);
            case "news":
                return evaluateNewsPredicate(predicate, context);
            case "mma":
                return evaluateMmaPredicate(predicate, context);
        }
    });
}
/**
 * The eligible set for one item, in library order.
 *
 * Library order rather than sorted order because the seeded pick indexes into this list, and a
 * reordering that changed the pick without changing the set would break reproducibility for a
 * reason no receipt records.
 */
export function eligibleFor(library, context) {
    // An unwritten library is the honest empty case: nothing is eligible and the pack takes its
    // `no-hook` fallback. It needs no subject, because there is nothing for a gate to hold against.
    if (library.hooks.length === 0) {
        return { surface: library.surface, ids: [], hash: eligibleSetHash([]) };
    }
    if (!context) {
        throw new Error(`The ${library.surface} evaluator needs a subject: a gate cannot hold or fail against nothing`);
    }
    const ids = library.hooks.filter((hook) => hookIsEligible(hook, context)).map((hook) => hook.id);
    return { surface: library.surface, ids, hash: eligibleSetHash(ids) };
}
/**
 * The eligible set's fingerprint, recorded in `hook-assignment/1`.
 *
 * This is what bounds the agent override: a meeting may swap the assigned hook for another member
 * of the recorded set, and pack validation rehashes the set to prove the swap stayed inside it.
 * Order-independent on purpose — the set is the licence, and sorting it means a library reordering
 * cannot invalidate a committed pack's receipt.
 */
export function eligibleSetHash(ids) {
    return createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
}
//# sourceMappingURL=evaluate.js.map