import { expect, it } from 'vitest';
import { exportCsv } from '@/lib/data-export-csv';
it.each(['=SUM(1,2)', '+cmd', '-cmd', '@cmd', ' \t\r=cmd', '\ufeff=cmd', '＝cmd', '＋cmd', '－cmd', '＠cmd'])('prefixes formula-like text inside its quoted CSV field: %j', value => {
 expect(exportCsv([{ value }], ['value'])).toBe(`"value"\r\n"\t${value}"`);
});
it('keeps numeric negatives numeric and JSON/text fidelity explicit', () => {
 expect(exportCsv([{ amount: -12.5, text: '-12.5', empty: null, json: { text: '=formula' } }], ['amount', 'text', 'empty', 'json'])).toBe('"amount","text","empty","json"\r\n"-12.5","\t-12.5","","{""text"":""=formula""}"');
});
it('escapes quotes, commas and multiline text using fixed columns', () => {
 expect(exportCsv([{ value: '"hello",\r\nworld', ignored: 'extra' }], ['value'])).toBe('"value"\r\n"""hello"",\r\nworld"');
 expect(exportCsv([], ['id', 'amount'])).toBe('"id","amount"');
});
