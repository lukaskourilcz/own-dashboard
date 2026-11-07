import type { CarouselTemplate } from '../schema.js';
import type { DneskaiFlow, DneskaiLayoutMetrics } from '../dneskai-layout.js';
import { kitStyleFor, kitStyleWithLook } from '../kit-style.js';
import { CAROUSEL_BRANDS } from '../library.js';
import { resolveFace } from '../fonts.js';
import { DNESKAI_CODE_OWNED_SLOTS, DNESKAI_MAX_THUMBNAILS, DNESKAI_SLIDE_TYPES, DNESKAI_TEMPLATE_ROLES, DNESKAI_TEXT_FIELDS, dneskaiImageSlots, dneskaiRoleOf,
  type DneskaiKitId, type DneskaiSlideType, type DneskaiTemplateRole, type DneskaiTextField, type DneskaiVariant } from './contract.js';

export interface DneskaiFieldFace { family: string; weight: number; uppercase: boolean }
export interface DneskaiKitTemplate { role:DneskaiTemplateRole; thumbnails?:number; template:CarouselTemplate; flow:DneskaiFlow }
export interface DneskaiKit {
 readonly id:DneskaiKitId; readonly label:string; readonly purpose:string; readonly look:string;
 readonly templates:ReadonlyMap<string,CarouselTemplate>;
 readonly roles:ReadonlyMap<string,DneskaiTemplateRole>;
 readonly flows:ReadonlyMap<string,DneskaiFlow>;
 readonly metrics:DneskaiLayoutMetrics;
 resolve(type:DneskaiSlideType,variant:DneskaiVariant|undefined,imageSlots:readonly string[]):CarouselTemplate;
 /** One face per field the kit places, in `DNESKAI_TEXT_FIELDS` order. A field no template places (since 22 October 2026, `credit`) has no face. */
 readonly fieldFaces:Readonly<Partial<Record<DneskaiTextField,DneskaiFieldFace>>>;
 readonly placedFields:Readonly<Record<DneskaiSlideType,readonly DneskaiTextField[]>>;
}
const fieldOf=(slot:string):DneskaiTextField|null=>{
 if((DNESKAI_CODE_OWNED_SLOTS as readonly string[]).includes(slot))return null;
 if(/^source-[1-4]$/.test(slot))return 'sources';
 if((DNESKAI_TEXT_FIELDS as readonly string[]).includes(slot))return slot as DneskaiTextField;
 throw new Error(`Unknown DNESKAi text slot ${slot}`);
};

/** Importing a kit verifies structure only. Font/manifest reads wait for the first fieldFaces access. */
export function defineDneskaiKit(input:{id:DneskaiKitId;label:string;purpose:string;look:string;metrics:DneskaiLayoutMetrics;templates:readonly DneskaiKitTemplate[]}):DneskaiKit {
 const templates=new Map<string,CarouselTemplate>(),roles=new Map<string,DneskaiTemplateRole>(),flows=new Map<string,DneskaiFlow>(),byRole=new Map<string,CarouselTemplate>();
 for(const row of input.templates){
  const t=row.template,key=row.role==='sources'?`sources-${row.thumbnails}`:row.role;
  if(templates.has(t.id)||byRole.has(key))throw new Error(`Duplicate DNESKAi template ${t.id} or role ${key}`);
  if(t.schemaVersion!=='carousel-template/2'||t.slides.length!==1||t.canvas?.master!=='instagram-portrait'||!row.flow)throw new Error(`Invalid DNESKAi kit template ${t.id}`);
  // The image layers are the contract's slots for the role in this kit, in order, with their optional flags.
  const images=t.slides[0]!.layers.flatMap(layer=>layer.type==='image'?[{slot:layer.slot,optional:layer.optional}]:[]);
  if(JSON.stringify(images)!==JSON.stringify(dneskaiImageSlots(row.role,row.thumbnails??0,input.id)))throw new Error(`Kit ${input.id} template ${t.id} has image slots ${JSON.stringify(images)}, not the contract's for ${key}`);
  templates.set(t.id,t);roles.set(t.id,row.role);flows.set(t.id,row.flow);byRole.set(key,t);
 }
 for(const role of DNESKAI_TEMPLATE_ROLES){
  const keys=role==='sources'?Array.from({length:DNESKAI_MAX_THUMBNAILS+1},(_,n)=>`sources-${n}`):[role];
  for(const key of keys)if(!byRole.has(key))throw new Error(`Kit ${input.id} lacks role ${key}`);
 }
 if(templates.size!==DNESKAI_TEMPLATE_ROLES.length+DNESKAI_MAX_THUMBNAILS)throw new Error(`Kit ${input.id} has extra roles`);
 const placedFields=Object.fromEntries(DNESKAI_SLIDE_TYPES.map(type=>{
  const serve=new Set<DneskaiTemplateRole>(type==='single'?['single-photo','single-type']:type==='split'?['split','split-pair']:[type]);
  const fields=new Set<DneskaiTextField>();
  for(const row of input.templates)if(serve.has(row.role))for(const layer of row.template.slides[0]!.layers)if(layer.type==='text'){const field=fieldOf(layer.slot);if(field)fields.add(field);}
  return [type,DNESKAI_TEXT_FIELDS.filter(field=>fields.has(field))];
 })) as unknown as Record<DneskaiSlideType,readonly DneskaiTextField[]>;
 let fieldFaces:Readonly<Partial<Record<DneskaiTextField,DneskaiFieldFace>>>|undefined;
 return {
  id:input.id,label:input.label,purpose:input.purpose,look:input.look,templates,roles,flows,metrics:input.metrics,placedFields,
  resolve(type,variant,imageSlots){const {role,thumbnails}=dneskaiRoleOf(type,variant,imageSlots);return byRole.get(role==='sources'?`sources-${thumbnails}`:role)!;},
  get fieldFaces(){
   if(fieldFaces)return fieldFaces;
   const brand=CAROUSEL_BRANDS['caught-up'],style=kitStyleWithLook(kitStyleFor(brand),input.look);
   const fonts=style?.fonts??brand.fonts,found:Partial<Record<DneskaiTextField,DneskaiFieldFace>>={};
   const origins=new Map<DneskaiTextField,string>();
   for(const t of templates.values())for(const layer of t.slides[0]!.layers){
    if(layer.type!=='text')continue;const field=fieldOf(layer.slot);if(!field)continue;
    const family=fonts[layer.fontToken],face={family,weight:resolveFace(family,layer.fontWeight).weight,uppercase:layer.uppercase};
    if(found[field]&&JSON.stringify(found[field])!==JSON.stringify(face))throw new Error(`Kit ${input.id} field ${field} differs between ${origins.get(field)} and ${t.id}: ${JSON.stringify(found[field])} / ${JSON.stringify(face)}`);
    found[field]=face;origins.set(field,t.id);
   }
   fieldFaces=Object.fromEntries(DNESKAI_TEXT_FIELDS.flatMap(field=>found[field]?[[field,found[field]]]:[])) as Partial<Record<DneskaiTextField,DneskaiFieldFace>>;return fieldFaces;
  }
 };
}
