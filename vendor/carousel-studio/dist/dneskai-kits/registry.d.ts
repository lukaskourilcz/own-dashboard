import type { DneskaiKit } from "./kit.js";
import type { DneskaiKitId } from "./contract.js";
/** The five DNESKAi kits, editorial first and default; the order is the contract's `DNESKAI_KIT_IDS`. */
export declare const DNESKAI_KITS: ReadonlyMap<DneskaiKitId, DneskaiKit>;
export declare const dneskaiKit: (id: string) => DneskaiKit | null;
//# sourceMappingURL=registry.d.ts.map