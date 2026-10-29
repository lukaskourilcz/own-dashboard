// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { DneskaiCostsTab } from '@/components/marketing/dneskai/costs-tab';
import { createDneskaiCostsFixture } from '@/lib/demo/dneskai-workspace-fixtures';
const values=[-0,0.001,0.13,5,100,1234.56,9999.99];
const expected={en:['-$0.00','$0.00','$0.13','$5.00','$100.00','$1,234.56','$9,999.99'],cs:['-0,00 US$','0,00 US$','0,13 US$','5,00 US$','100,00 US$','1 234,56 US$','9 999,99 US$']};
it.each(['en','cs'] as const)('preserves exact localized USD cost cells, including small and large figures (%s)',lang=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const client=new QueryClient(),now=new Date('2026-10-25T12:00:00Z'),read=createDneskaiCostsFixture(now);
 read.days=values.map((value,index)=>({date:`2026-10-${25-index}`,collectionUsd:value,generationUsd:0,generationBookedUsd:value,unknown:0}));
 try {
  const element=document.createElement('div');element.innerHTML=renderToStaticMarkup(<QueryClientProvider client={client}><DneskaiCostsTab read={read} lang={lang} preview refreshing={false} onRefresh={()=>undefined} now={now}/></QueryClientProvider>);
  const zero=lang==='cs'?'0,00 US$':'$0.00';expect([...element.querySelectorAll('table tbody tr')].map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent))).toEqual(expected[lang].map(value=>[value,zero,value==='-$0.00'?'$0.00':value==='-0,00 US$'?'0,00 US$':value,value]));expect(fetcher).not.toHaveBeenCalled();
 }finally{client.clear();vi.unstubAllGlobals();}
});
