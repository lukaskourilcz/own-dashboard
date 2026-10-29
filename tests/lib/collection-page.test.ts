import { expect, it } from 'vitest';
import { collectionPage } from '@/lib/collection-page';
import { competitorPage } from '@/lib/competition';
it('keeps all 1,201 original records reachable in order with at most fifty row mounts',()=>{
 const rows=Array.from({length:1201},(_,id)=>({id})),seen:typeof rows=[];
 for(let index=0;index<25;index++){const page=collectionPage(rows,index);expect(page.index).toBe(index);expect(page.total).toBe(1201);expect(page.items.length).toBeLessThanOrEqual(50);seen.push(...page.items);}
 expect(seen).toEqual(rows);expect(new Set(seen).size).toBe(1201);expect(rows[0]).toEqual({id:0});
});
it('handles empty data and clamps a removed last page without mutating input',()=>{
 expect(collectionPage([],24)).toMatchObject({index:0,items:[],from:0,to:0,total:0,pages:1});
 expect(collectionPage(Array.from({length:1200},(_,i)=>i),24)).toMatchObject({index:23,from:1151,to:1200,pages:24});
});
it.each([-1,NaN,Infinity,0.5])('uses the first page for an invalid requested index (%s)',index=>{expect(collectionPage([1,2],index).index).toBe(0);});
it.each([0,-1,NaN,Infinity,1.5])('rejects an invalid page size (%s)',size=>{expect(()=>collectionPage([1],0,size)).toThrow('Invalid page size');});
it('preserves the existing Competition page contract exactly',()=>{
 const rows=Array.from({length:121},(_,i)=>i);
 for(const index of [-1,0,1,2,100])expect(competitorPage(rows,index)).toEqual(collectionPage(rows,index));
});
