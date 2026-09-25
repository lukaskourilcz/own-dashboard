import { describe, expect, it } from "vitest";
import {
  FIO_PREFIX,
  fioAccountRef,
  fioExternalId,
  fioWindow,
  parseFioStatement,
  parseFioTransaction,
} from "../../src/lib/bank/fio-statement";

/** Shaped like Fio's documented `transactions.json`, with invented values. No
 *  real account number, token or movement id appears in this file. */
function column(value: unknown) {
  return { value };
}

const statement = {
  accountStatement: {
    info: {
      accountId: "2900000001",
      bankId: "2010",
      currency: "CZK",
      closingBalance: 12_345.67,
      idTo: 990,
    },
    transactionList: {
      transaction: [
        {
          column22: column(1001),
          column0: column("2026-09-01+0200"),
          column1: column(-1234.5),
          column14: column("CZK"),
          column5: column("20260007"),
          column16: column("Platba za hosting"),
          column10: column("Vercel Inc."),
        },
        {
          column22: column(1002),
          column0: column("2026-09-02+0200"),
          column1: column(48_400),
          column14: column("CZK"),
          column16: column("Faktura 2026007"),
        },
        // Missing both a movement id and a date: dropped, never guessed.
        { column1: column(10) },
      ],
    },
  },
};

describe("parseFioStatement", () => {
  it("reads the account and its closing balance", () => {
    const parsed = parseFioStatement(statement);
    expect(parsed?.account).toMatchObject({
      accountRef: "fio:2900000001",
      currency: "CZK",
      balance: 12_345.67,
    });
    expect(parsed?.lastId).toBe("990");
  });

  it("turns a negative amount into an expense with a positive amount", () => {
    const [first] = parseFioStatement(statement)!.transactions;
    expect(first.kind).toBe("expense");
    expect(first.amount).toBe(1234.5);
    expect(first.occurred_on).toBe("2026-09-01");
    expect(first.currency).toBe("CZK");
  });

  it("reads an incoming payment as income", () => {
    const [, second] = parseFioStatement(statement)!.transactions;
    expect(second.kind).toBe("income");
    expect(second.amount).toBe(48_400);
  });

  it("namespaces every key so Fio cannot collide with GoCardless rows", () => {
    const parsed = parseFioStatement(statement)!;
    expect(parsed.account.accountRef.startsWith(FIO_PREFIX)).toBe(true);
    for (const tx of parsed.transactions) {
      expect(tx.external_id.startsWith(FIO_PREFIX)).toBe(true);
    }
    expect(fioAccountRef("1")).toBe("fio:1");
    expect(fioExternalId("1")).toBe("fio:1");
  });

  it("drops a malformed entry instead of throwing", () => {
    const parsed = parseFioStatement(statement)!;
    expect(parsed.transactions).toHaveLength(2);
  });

  it("takes the variable symbol from the dedicated column", () => {
    const [first] = parseFioStatement(statement)!.transactions;
    expect(first.variable_symbol).toBe("20260007");
  });

  it("falls back to scanning the message when no symbol column is filled", () => {
    const tx = parseFioTransaction(
      {
        column22: column("77"),
        column0: column("2026-09-03+0200"),
        column1: column(100),
        column16: column("platba VS 12345"),
      },
      "CZK",
    );
    expect(tx?.variable_symbol).toBe("12345");
  });

  it("builds a note out of the fields Fio actually filled", () => {
    const [first] = parseFioStatement(statement)!.transactions;
    expect(first.note).toBe("Platba za hosting · Vercel Inc.");
  });

  it("uses the statement currency when a row omits its own", () => {
    const tx = parseFioTransaction(
      { column22: column("5"), column0: column("2026-09-03"), column1: column(1) },
      "EUR",
    );
    expect(tx?.currency).toBe("EUR");
  });

  it("parses a Czech-formatted string amount", () => {
    const tx = parseFioTransaction(
      {
        column22: column("6"),
        column0: column("2026-09-03"),
        column1: column("1 234,56"),
      },
      "CZK",
    );
    expect(tx?.amount).toBe(1234.56);
  });

  it("returns null for a payload that is not a Fio statement", () => {
    expect(parseFioStatement(null)).toBeNull();
    expect(parseFioStatement({})).toBeNull();
    expect(parseFioStatement({ accountStatement: { info: {} } })).toBeNull();
  });

  it("accepts a statement with no transactions at all", () => {
    const parsed = parseFioStatement({
      accountStatement: { info: { accountId: "1", currency: "CZK" }, transactionList: null },
    });
    expect(parsed?.transactions).toEqual([]);
    expect(parsed?.account.balance).toBeNull();
  });
});

describe("fioWindow", () => {
  const today = new Date("2026-09-16T08:00:00Z");

  it("reaches back 90 days when nothing has been synced yet", () => {
    expect(fioWindow(null, today)).toEqual({
      from: "2026-06-18",
      to: "2026-09-16",
    });
  });

  it("re-reads a week before the cursor so a late booking is still caught", () => {
    expect(fioWindow("2026-09-10", today)).toEqual({
      from: "2026-09-03",
      to: "2026-09-16",
    });
  });

  it("ignores a cursor that is not a date", () => {
    expect(fioWindow("not-a-date", today).from).toBe("2026-06-18");
  });
});
