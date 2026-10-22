import { EDITORIAL_KIT } from "./editorial.js";
import { BOLD_KIT } from "./bold.js";
import { EXPLAINER_KIT } from "./explainer.js";
import { MAGAZINE_KIT } from "./magazine.js";
import { TICKER_KIT } from "./ticker.js";
import { SPOTLIGHT_KIT } from "./spotlight.js";
/** The six DNESKAi kits, editorial first and default; the order is the contract's `DNESKAI_KIT_IDS`. */
export const DNESKAI_KITS = new Map([[EDITORIAL_KIT.id, EDITORIAL_KIT], [BOLD_KIT.id, BOLD_KIT], [EXPLAINER_KIT.id, EXPLAINER_KIT], [MAGAZINE_KIT.id, MAGAZINE_KIT], [TICKER_KIT.id, TICKER_KIT], [SPOTLIGHT_KIT.id, SPOTLIGHT_KIT]]);
export const dneskaiKit = (id) => DNESKAI_KITS.get(id) ?? null;
//# sourceMappingURL=registry.js.map