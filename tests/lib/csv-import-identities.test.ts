import { expect, it } from "vitest";
import { csvRowsToImport, parseBankCsv, prepareBankCsv } from "@/lib/bank-csv";
const file="Date;Amount;Currency;Description;VS\n2026-10-23;100;CZK;Synthetic work;2026001";
it("uses stable strong ids and keeps two identical purchases without collapsing them",async()=>{
 const one=await prepareBankCsv(file);const two=await prepareBankCsv(file+"\n2026-10-23;100;CZK;Synthetic work;2026001");
 expect(one.rows[0].external_id).toMatch(/^csv:v2:[a-f0-9]{64}$/);expect(two.rows.map(r=>r.external_id)).toHaveLength(2);expect(new Set(two.rows.map(r=>r.external_id)).size).toBe(2);
 expect((await prepareBankCsv(file)).rows[0].external_id).toBe(one.rows[0].external_id);expect(two.rows[0].external_id).toBe(one.rows[0].external_id);
});
it("keeps different structured symbols and long source notes distinct",async()=>{
 const symbol=(await prepareBankCsv(file.replace("2026001","2026002"))).rows[0];expect(symbol.external_id).not.toBe((await prepareBankCsv(file)).rows[0].external_id);
 const note="x".repeat(500);const a=(await prepareBankCsv(`Date;Amount;Description\n2026-10-23;1;${note}a`)).rows[0],b=(await prepareBankCsv(`Date;Amount;Description\n2026-10-23;1;${note}b`)).rows[0];
 expect(a.note).toBe(b.note);expect(a.external_id).not.toBe(b.external_id);expect(a.legacy_comparable).toBe(false);
});
it("deduplicates a verified legacy import without inserting it again",async()=>{
 const parsed=await prepareBankCsv(file);const legacy=parseBankCsv(file).rows[0];expect(csvRowsToImport(parsed.rows,[legacy])).toEqual([]);
 const lower=file.replace("CZK","czk");expect((await prepareBankCsv(lower)).rows[0].legacy_external_id).toBe(parseBankCsv(lower).rows[0].external_id);
});
it("refuses a conflicting legacy record and keeps later edits to strong identities",async()=>{
 const parsed=await prepareBankCsv(file),legacy=parseBankCsv(file).rows[0];expect(()=>csvRowsToImport(parsed.rows,[{...legacy,amount:200}])).toThrow("csv-legacy-conflict");
 expect(()=>csvRowsToImport(parsed.rows,[{...legacy,variable_symbol:"2026002"}])).toThrow("csv-legacy-conflict");
 expect(csvRowsToImport(parsed.rows,[{...parsed.rows[0],note:"Later owner edit"}])).toEqual([]);
});
