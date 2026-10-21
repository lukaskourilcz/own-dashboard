import { type Finding } from "./lint.js";
import { type Surface } from "./schema.js";
export declare function lintAllLibraries(root?: string): Promise<{
    findings: Finding[];
    counts: Record<Surface, number>;
}>;
//# sourceMappingURL=lint-cli.d.ts.map