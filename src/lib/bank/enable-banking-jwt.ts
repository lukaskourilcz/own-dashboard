import { createSign } from "node:crypto";

/**
 * Enable Banking authenticates every call with a JWT the caller signs itself:
 * RS256, `kid` set to the application id issued when the RSA public key was
 * uploaded, and a short-lived `iat`/`exp` pair. No secret is exchanged, which is
 * why the private key never leaves the server and no token is cached anywhere.
 *
 * The signing itself is standard and testable with a throwaway key pair, so it
 * lives apart from the adapter and is covered by unit tests. What cannot be
 * built here is the application registration: it needs an account, an uploaded
 * public key and an issued application id, all of which are owner actions.
 */

export type EnableBankingJwtInput = {
  applicationId: string;
  privateKeyPem: string;
  /** Seconds the assertion stays valid. Enable Banking allows up to an hour. */
  ttlSeconds?: number;
  /** Injected so the encoding is deterministic under test. */
  issuedAt?: number;
};

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function signEnableBankingJwt(input: EnableBankingJwtInput): string {
  const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? 3600;
  const header = base64Url(
    JSON.stringify({ typ: "JWT", alg: "RS256", kid: input.applicationId }),
  );
  const payload = base64Url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: issuedAt,
      exp: issuedAt + ttl,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${base64Url(signer.sign(input.privateKeyPem))}`;
}

/** The claims half of a signed assertion, for tests and diagnostics. Never
 *  verifies the signature — it is not a token this app consumes. */
export function decodeJwtSegments(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const decode = (segment: string) =>
      JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<
        string,
        unknown
      >;
    return { header: decode(parts[0]), payload: decode(parts[1]) };
  } catch {
    return null;
  }
}
