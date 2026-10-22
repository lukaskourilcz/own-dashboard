import { EDITORIAL_KIT } from "./editorial.js";
/** Only implemented kits are offered. Future designs require the owner's decision. */
export const DNESKAI_KITS = new Map([[EDITORIAL_KIT.id, EDITORIAL_KIT]]);
export const dneskaiKit = (id) => DNESKAI_KITS.get(id) ?? null;
//# sourceMappingURL=registry.js.map