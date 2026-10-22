import type { DneskaiKit } from "./kit.js";
import type { DneskaiKitId } from "./contract.js";
/** Only implemented kits are offered. Future designs require the owner's decision. */
export declare const DNESKAI_KITS: ReadonlyMap<DneskaiKitId, DneskaiKit>;
export declare const dneskaiKit: (id: string) => DneskaiKit | null;
//# sourceMappingURL=registry.d.ts.map