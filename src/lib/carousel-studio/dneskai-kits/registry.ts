import { EDITORIAL_KIT } from "./editorial";
import { BOLD_KIT } from "./bold";
import { EXPLAINER_KIT } from "./explainer";
import { MAGAZINE_KIT } from "./magazine";
import { TICKER_KIT } from "./ticker";
import { SPOTLIGHT_KIT } from "./spotlight";
import type { DneskaiKit } from "./kit";
import type { DneskaiKitId } from "./contract";
/** The six DNESKAi kits, editorial first and default; the order is the contract's `DNESKAI_KIT_IDS`. */
export const DNESKAI_KITS:ReadonlyMap<DneskaiKitId,DneskaiKit>=new Map([[EDITORIAL_KIT.id,EDITORIAL_KIT],[BOLD_KIT.id,BOLD_KIT],[EXPLAINER_KIT.id,EXPLAINER_KIT],[MAGAZINE_KIT.id,MAGAZINE_KIT],[TICKER_KIT.id,TICKER_KIT],[SPOTLIGHT_KIT.id,SPOTLIGHT_KIT]]);
export const dneskaiKit=(id:string):DneskaiKit|null=>DNESKAI_KITS.get(id as DneskaiKitId)??null;
