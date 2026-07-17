import { describe, expect, it } from "vitest";
import { parseBankCsv } from "../../src/lib/bank-csv";

describe("parseBankCsv", () => {
  it("parses a Raiffeisen-style Czech CSV (semicolons, comma decimals, dd.mm.yyyy)", () => {
    const csv = [
      "Datum zúčtování;Částka;Měna;Název protiúčtu",
      "17.07.2026;-1 234,56;CZK;Albert",
      "01.07.2026;48 000,00;CZK;Mzda",
    ].join("\n");

    const { rows, errors, columns } = parseBankCsv(csv);
    expect(errors).toEqual([]);
    expect(columns.date).toBe("Datum zúčtování");
    expect(columns.amount).toBe("Částka");
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      occurred_on: "2026-07-17",
      kind: "expense",
      amount: 1234.56,
      currency: "CZK",
      note: "Albert",
    });
    expect(rows[1]).toMatchObject({
      occurred_on: "2026-07-01",
      kind: "income",
      amount: 48000,
      currency: "CZK",
      note: "Mzda",
    });
  });

  it("parses a generic comma CSV with ISO dates and dot decimals", () => {
    const csv = [
      "Date,Amount,Currency,Description",
      "2026-07-15,-89.00,EUR,Spotify",
    ].join("\n");
    const { rows, errors } = parseBankCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      occurred_on: "2026-07-15",
      kind: "expense",
      amount: 89,
      currency: "EUR",
      note: "Spotify",
    });
  });

  it("handles both thousands and decimal separators (1.234,56)", () => {
    const csv = "Datum;Částka\n17.07.2026;1.234,56";
    const { rows } = parseBankCsv(csv);
    expect(rows[0].amount).toBe(1234.56);
    expect(rows[0].kind).toBe("income");
  });

  it("produces a stable external_id for identical rows (dedupe key)", () => {
    const csv = "Datum,Částka,Měna,Popis\n17.07.2026,-10,CZK,Kafe";
    const a = parseBankCsv(csv).rows[0].external_id;
    const b = parseBankCsv(csv).rows[0].external_id;
    expect(a).toBe(b);
    expect(a.startsWith("csv:")).toBe(true);
  });

  it("differentiates external_id when a field changes", () => {
    const one = parseBankCsv("Datum,Částka,Popis\n17.07.2026,-10,Kafe").rows[0];
    const two = parseBankCsv("Datum,Částka,Popis\n17.07.2026,-11,Kafe").rows[0];
    expect(one.external_id).not.toBe(two.external_id);
  });

  it("falls back to the given currency when there is no currency column", () => {
    const { rows } = parseBankCsv("Datum,Částka\n17.07.2026,-10", "USD");
    expect(rows[0].currency).toBe("USD");
  });

  it("skips unreadable rows but keeps the good ones", () => {
    const csv = [
      "Datum,Částka",
      "not-a-date,-10",
      "17.07.2026,-20",
    ].join("\n");
    const { rows, errors } = parseBankCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(20);
    expect(errors.length).toBe(1);
  });

  it("errors clearly when required columns are missing", () => {
    const { rows, errors } = parseBankCsv("Foo,Bar\n1,2");
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/date and amount/i);
  });

  it("tolerates a BOM and CRLF line endings", () => {
    const csv = "﻿Datum;Částka\r\n17.07.2026;-5\r\n";
    const { rows, errors } = parseBankCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(5);
  });
});
