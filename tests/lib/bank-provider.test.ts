import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BANK_PROVIDER_IDS,
  BankProviderNotConfiguredError,
  UnknownBankProviderError,
  bindTransaction,
  isBankProviderId,
  type ProviderTransaction,
} from "../../src/lib/bank/provider";
import {
  mapRequisitionStatus,
  pickBalance,
} from "../../src/lib/bank/gocardless-mapping";
import {
  decodeJwtSegments,
  signEnableBankingJwt,
} from "../../src/lib/bank/enable-banking-jwt";

describe("bank provider registry guard", () => {
  it("knows exactly the three registered providers", () => {
    expect([...BANK_PROVIDER_IDS]).toEqual([
      "gocardless",
      "fio",
      "enable-banking",
    ]);
  });

  it("accepts a registered id and rejects anything else", () => {
    for (const id of BANK_PROVIDER_IDS) expect(isBankProviderId(id)).toBe(true);
    expect(isBankProviderId("nordigen")).toBe(false);
    expect(isBankProviderId("GoCardless")).toBe(false);
    expect(isBankProviderId("")).toBe(false);
  });

  it("names the offending value on the unknown-provider error", () => {
    const error = new UnknownBankProviderError("nordigen");
    expect(error.provider).toBe("nordigen");
    expect(error.name).toBe("UnknownBankProviderError");
    expect(error.message).toContain("nordigen");
  });

  it("carries the provider on the not-configured error", () => {
    const error = new BankProviderNotConfiguredError("fio");
    expect(error.provider).toBe("fio");
    expect(error.message).toContain("fio");
  });
});

describe("bindTransaction", () => {
  const tx: ProviderTransaction = {
    kind: "expense",
    amount: 120.5,
    currency: "CZK",
    category: null,
    note: "ALBERT",
    occurred_on: "2026-09-01",
    external_id: "fio:1",
    variable_symbol: null,
  };

  it("adds exactly the ownership columns an adapter may not decide", () => {
    const row = bindTransaction(tx, "user-1", "account-1");
    expect(row.user_id).toBe("user-1");
    expect(row.account_id).toBe("account-1");
    expect(row.amount).toBe(120.5);
    expect(row.external_id).toBe("fio:1");
  });

  it("keeps a null account when no local row exists yet", () => {
    expect(bindTransaction(tx, "user-1", null).account_id).toBeNull();
  });
});

describe("mapRequisitionStatus", () => {
  it("maps the linked code", () => {
    expect(mapRequisitionStatus("LN")).toBe("linked");
  });

  it("maps both lapse codes to expired — the 90-day consent case", () => {
    expect(mapRequisitionStatus("EX")).toBe("expired");
    expect(mapRequisitionStatus("SU")).toBe("expired");
  });

  it("maps every pre-consent code to created", () => {
    for (const code of ["CR", "GC", "UA", "GA", "SA"]) {
      expect(mapRequisitionStatus(code)).toBe("created");
    }
  });

  it("treats an unrecognised code as an error rather than guessing", () => {
    expect(mapRequisitionStatus("RJ")).toBe("error");
    expect(mapRequisitionStatus("")).toBe("error");
  });
});

describe("pickBalance", () => {
  it("prefers closingBooked over the other types", () => {
    expect(
      pickBalance([
        { balanceAmount: { amount: "10", currency: "CZK" }, balanceType: "expected" },
        { balanceAmount: { amount: "42.5", currency: "CZK" }, balanceType: "closingBooked" },
      ]),
    ).toEqual({ amount: 42.5, currency: "CZK" });
  });

  it("falls back to the first entry when no known type is present", () => {
    expect(
      pickBalance([{ balanceAmount: { amount: "7", currency: "EUR" } }]),
    ).toEqual({ amount: 7, currency: "EUR" });
  });

  it("returns null for an empty list or an unparseable amount", () => {
    expect(pickBalance([])).toBeNull();
    expect(pickBalance(null)).toBeNull();
    expect(
      pickBalance([{ balanceAmount: { amount: "n/a", currency: "CZK" } }]),
    ).toBeNull();
  });
});

describe("Enable Banking assertion", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("signs an RS256 JWT whose kid is the application id", () => {
    const token = signEnableBankingJwt({
      applicationId: "app-123",
      privateKeyPem,
      issuedAt: 1_700_000_000,
      ttlSeconds: 600,
    });
    const decoded = decodeJwtSegments(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.header).toMatchObject({ typ: "JWT", alg: "RS256", kid: "app-123" });
    expect(decoded?.payload).toMatchObject({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: 1_700_000_000,
      exp: 1_700_000_600,
    });
  });

  it("produces three base64url segments with no padding", () => {
    const token = signEnableBankingJwt({
      applicationId: "app-123",
      privateKeyPem,
      issuedAt: 1,
    });
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns null for anything that is not a three-part token", () => {
    expect(decodeJwtSegments("nope")).toBeNull();
    expect(decodeJwtSegments("a.b")).toBeNull();
  });
});
