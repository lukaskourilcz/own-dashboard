import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteProviderSecret,
  hasProviderSecret,
  readProviderSecret,
} from "@/lib/bank/credentials";
import {
  fioWindow,
  parseFioStatement,
  type FioStatement,
} from "@/lib/bank/fio-statement";
import {
  BankProviderNotConfiguredError,
  type BankProvider,
  type ProviderAccount,
  type ProviderConsent,
  type ProviderTransaction,
} from "@/lib/bank/provider";
import type { BankConnection } from "@/lib/types";

/**
 * Fio banka's REST API behind the provider interface.
 *
 * Fio is the opposite of GoCardless in every way that matters here: the owner
 * generates a read-only token per account inside internet banking, there is no
 * redirect, no institution picker and no consent that lapses — so nothing about
 * this provider can go dark on a 90-day timer. The cost is a hard rate limit
 * (Fio rejects a second call on the same token within 30 seconds), which is why
 * one statement is fetched per sync and reused by all three interface methods.
 *
 * The token itself is user data: it is read from `bank_provider_credentials`
 * with the service role, kept in a request-scoped variable, and never logged or
 * returned. Fio puts it in the URL path, so no error message built here may
 * contain a request URL.
 */

const BASE = "https://fioapi.fio.cz/v1/rest";
const REQUEST_TIMEOUT_MS = 12_000;
/** A statement is reused for this long so one sync makes one Fio call. */
const CACHE_TTL_MS = 60_000;
export class FioApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Fio API returned ${status}`);
    this.name = "FioApiError";
    this.status = status;
  }
}

type CacheEntry = { at: number; statement: FioStatement | null };
const cache = new Map<string, CacheEntry>();

async function requestStatement(
  token: string,
  from: string,
  to: string,
): Promise<FioStatement | null> {
  const url = `${BASE}/periods/${encodeURIComponent(token)}/${from}/${to}/transactions.json`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new FioApiError(response.status);
  const payload: unknown = await response.json();
  return parseFioStatement(payload);
}

/** One statement per connection per minute, so `getConsent`, `listAccounts` and
 *  `fetchTransactions` inside one sync cost a single upstream call. */
async function statementFor(
  conn: BankConnection,
  cursor: string | null,
): Promise<FioStatement | null> {
  const window = fioWindow(cursor, new Date());
  const key = `${conn.id}:${window.from}:${window.to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.statement;

  const admin = createAdminClient();
  const token = await readProviderSecret(admin, conn.user_id, "fio");
  if (!token) throw new BankProviderNotConfiguredError("fio");

  const statement = await requestStatement(token, window.from, window.to);
  cache.set(key, { at: Date.now(), statement });
  return statement;
}

/** Test seam: drop the memoised statements. */
export function clearFioStatementCache(): void {
  cache.clear();
}

export const fioProvider: BankProvider = {
  id: "fio",
  label: "Fio banka",
  supportsInstitutionPicker: false,

  async isConfigured(userId?: string): Promise<boolean> {
    if (!userId) return false;
    try {
      return await hasProviderSecret(createAdminClient(), userId, "fio");
    } catch {
      // No service-role key in this environment: report unconfigured rather
      // than pretending the provider is usable.
      return false;
    }
  },

  async getConsent(conn: BankConnection): Promise<ProviderConsent> {
    try {
      await statementFor(conn, conn.sync_cursor);
      // A token has no expiry — as long as Fio answers, the link is live.
      return { status: "linked", expiresAt: null, error: null };
    } catch (error) {
      if (error instanceof BankProviderNotConfiguredError) {
        return { status: "error", expiresAt: null, error: "missing-token" };
      }
      if (error instanceof FioApiError) {
        const revoked = error.status === 401 || error.status === 404;
        return {
          status: revoked ? "expired" : "error",
          expiresAt: null,
          error: revoked ? "token-rejected" : `fio-${error.status}`,
        };
      }
      return { status: "error", expiresAt: null, error: "unreachable" };
    }
  },

  async listAccounts(conn: BankConnection): Promise<ProviderAccount[]> {
    const statement = await statementFor(conn, conn.sync_cursor);
    if (!statement) return [];
    return [
      {
        ...statement.account,
        name: conn.institution_name ?? statement.account.name,
      },
    ];
  },

  async fetchTransactions(
    conn: BankConnection,
    accountRef: string,
    since: string | null,
  ): Promise<ProviderTransaction[]> {
    const statement = await statementFor(conn, since ?? conn.sync_cursor);
    if (!statement || statement.account.accountRef !== accountRef) return [];
    return statement.transactions;
  },

  async revoke(conn: BankConnection): Promise<void> {
    // Fio tokens are revoked by the owner inside internet banking; what this
    // app can do is forget the one it holds.
    await deleteProviderSecret(createAdminClient(), conn.user_id, "fio");
  },
};
