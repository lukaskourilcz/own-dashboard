import { kitStyleFor, kitStyleWithLook } from '../kit-style.js';
import { CAROUSEL_BRANDS } from '../library.js';
import { resolveFace } from '../fonts.js';
import { DNESKAI_CODE_OWNED_SLOTS, DNESKAI_MAX_THUMBNAILS, DNESKAI_SLIDE_TYPES, DNESKAI_TEMPLATE_ROLES, DNESKAI_TEXT_FIELDS, dneskaiRoleOf } from './contract.js';
const fieldOf = (slot) => {
    if (DNESKAI_CODE_OWNED_SLOTS.includes(slot))
        return null;
    if (/^source-[1-4]$/.test(slot))
        return 'sources';
    if (DNESKAI_TEXT_FIELDS.includes(slot))
        return slot;
    throw new Error(`Unknown DNESKAi text slot ${slot}`);
};
/** Importing a kit verifies structure only. Font/manifest reads wait for the first fieldFaces access. */
export function defineDneskaiKit(input) {
    const templates = new Map(), roles = new Map(), flows = new Map(), byRole = new Map();
    for (const row of input.templates) {
        const t = row.template, key = row.role === 'sources' ? `sources-${row.thumbnails}` : row.role;
        if (templates.has(t.id) || byRole.has(key))
            throw new Error(`Duplicate DNESKAi template ${t.id} or role ${key}`);
        if (t.schemaVersion !== 'carousel-template/2' || t.slides.length !== 1 || t.canvas?.master !== 'instagram-portrait' || !row.flow)
            throw new Error(`Invalid DNESKAi kit template ${t.id}`);
        templates.set(t.id, t);
        roles.set(t.id, row.role);
        flows.set(t.id, row.flow);
        byRole.set(key, t);
    }
    for (const role of DNESKAI_TEMPLATE_ROLES) {
        const keys = role === 'sources' ? Array.from({ length: DNESKAI_MAX_THUMBNAILS + 1 }, (_, n) => `sources-${n}`) : [role];
        for (const key of keys)
            if (!byRole.has(key))
                throw new Error(`Kit ${input.id} lacks role ${key}`);
    }
    if (templates.size !== DNESKAI_TEMPLATE_ROLES.length + DNESKAI_MAX_THUMBNAILS)
        throw new Error(`Kit ${input.id} has extra roles`);
    const placedFields = Object.fromEntries(DNESKAI_SLIDE_TYPES.map(type => {
        const serve = new Set(type === 'single' ? ['single-photo', 'single-type'] : type === 'split' ? ['split', 'split-pair'] : [type]);
        const fields = new Set();
        for (const row of input.templates)
            if (serve.has(row.role))
                for (const layer of row.template.slides[0].layers)
                    if (layer.type === 'text') {
                        const field = fieldOf(layer.slot);
                        if (field)
                            fields.add(field);
                    }
        return [type, DNESKAI_TEXT_FIELDS.filter(field => fields.has(field))];
    }));
    let fieldFaces;
    return {
        id: input.id, label: input.label, purpose: input.purpose, look: input.look, templates, roles, flows, metrics: input.metrics, placedFields,
        resolve(type, variant, imageSlots) { const { role, thumbnails } = dneskaiRoleOf(type, variant, imageSlots); return byRole.get(role === 'sources' ? `sources-${thumbnails}` : role); },
        get fieldFaces() {
            if (fieldFaces)
                return fieldFaces;
            const brand = CAROUSEL_BRANDS['caught-up'], style = kitStyleWithLook(kitStyleFor(brand), input.look);
            const fonts = style?.fonts ?? brand.fonts, found = {};
            const origins = new Map();
            for (const t of templates.values())
                for (const layer of t.slides[0].layers) {
                    if (layer.type !== 'text')
                        continue;
                    const field = fieldOf(layer.slot);
                    if (!field)
                        continue;
                    const family = fonts[layer.fontToken], face = { family, weight: resolveFace(family, layer.fontWeight).weight, uppercase: layer.uppercase };
                    if (found[field] && JSON.stringify(found[field]) !== JSON.stringify(face))
                        throw new Error(`Kit ${input.id} field ${field} differs between ${origins.get(field)} and ${t.id}: ${JSON.stringify(found[field])} / ${JSON.stringify(face)}`);
                    found[field] = face;
                    origins.set(field, t.id);
                }
            fieldFaces = Object.fromEntries(DNESKAI_TEXT_FIELDS.flatMap(field => found[field] ? [[field, found[field]]] : []));
            return fieldFaces;
        }
    };
}
//# sourceMappingURL=kit.js.map