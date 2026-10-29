import { SUPPORTED_CURRENCIES } from "@/lib/fx";

/**
 * Bank statement CSV → transaction rows. The manual fallback for when a live
 * GoCardless link isn't set up: export a CSV from internet banking
 * (Raiffeisenbank and most Czech banks offer this) and import it here.
 *
 * Framework-free and pure so it can be unit-tested and run either client- or
 * server-side. Tolerant by design — it sniffs the delimiter, matches columns
 * by fuzzy (accent-insensitive) header names, and understands Czech number and
 * date formats ("1 234,56", "17.07.2026").
 */

type ParsedTxRow = {
  occurred_on: string; // yyyy-MM-dd
  kind: "income" | "expense";
  amount: number; // absolute value, always >= 0
  currency: string;
  note: string | null;
  external_id: string; // legacy key here; prepareBankCsv upgrades it to csv:v2 SHA-256
  // Czech payment reference (variabilní symbol), digits only, when the
  // statement carries a column for it. Null otherwise — the payment matcher
  // then falls back to reading the note.
  variable_symbol: string | null;
  /** Client-only source identity; never spread into a database write. */
  source_identity: string;
  source_row: number;
  legacy_comparable: boolean;
  legacy_external_id?: string;
};

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;
export type CsvIssueCode = "empty" | "headers" | "format" | "limit" | "row" | "currency" | "symbol";
export type ParseResult = {
  issues: { code: CsvIssueCode; row?: number }[];
  rows: ParsedTxRow[];
  errors: string[];
  /** Which header cells were matched, for a friendlier "we read X as date" UI. */
  columns: {
    date: string | null;
    amount: string | null;
    currency: string | null;
    note: string | null;
    variableSymbol: string | null;
  };
};

/** Strip diacritics + lowercase, so "Částka" and "castka" both match. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

// Header aliases, most-specific first. All compared after `norm`.
const HEADERS = {
  date: [
    "datum zauctovani",
    "datum provedeni",
    "datum transakce",
    "booking date",
    "value date",
    "datum",
    "date",
  ],
  amount: [
    "castka",
    "amount",
    "objem",
    "castka transakce",
    "suma",
    "value",
  ],
  currency: ["mena", "currency", "ccy"],
  variableSymbol: [
    "variabilni symbol",
    "vs prijemce",
    "variable symbol",
    "vs",
  ],
  note: [
    "nazev protiuctu",
    "zprava pro prijemce",
    "poznamka",
    "popis",
    "protistrana",
    "counterparty",
    "merchant",
    "description",
    "note",
    "message",
    "detail",
  ],
} as const;

/** Split one CSV line on `delim`, honouring double-quoted fields. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Guess the delimiter from the header row: ; , or tab, whichever splits most. */
function sniffDelimiter(headerLine: string): string {
  const counts = [";", ",", "\t"].map((d) => ({
    d,
    n: splitLine(headerLine, d).length,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 1 ? counts[0].d : ",";
}

/** "1 234,56" / "1.234,56" / "-89.00" → number. Returns NaN if unparseable. */
function parseAmount(raw: string): number {
  let s = raw.replace(/\s| /g, "").trim();
  if (!s) return NaN;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Whichever comes last is the decimal separator; the other groups thousands.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  return /^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(s) && Math.abs(Number(s)) <= 999999999999.99 ? Number(s) : NaN;
}

/** Normalise a date cell to yyyy-MM-dd. Accepts ISO, dd.mm.yyyy, dd/mm/yyyy. */
function parseDate(raw: string): string | null {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  const dmy = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(s);
  const key = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : null;
  if (!key || key.startsWith("0000-")) return null;
  const time = /[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (time && (Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] ?? 0) > 59)) return null;
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : null;
}

/** Stable FNV-1a hash → hex, so the same statement row always yields the same id. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Digits only, capped at the ten a Czech variable symbol may carry. */
function symbolDigits(raw: string): string | null {
  const digits = raw.replace(/\s/g, "");
  return /^\d{1,10}$/.test(digits) ? digits : null;
}

/** Logical records preserve quoted newlines and escaped quotes. */
function records(text: string): string[] | null {
  const result: string[] = [];
  let quoted = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (text[i] === "\n" && !quoted) {
      if (text.slice(start, i).trim()) result.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (quoted) return null;
  if (text.slice(start).trim()) result.push(text.slice(start));
  return result;
}

function findColumn(header: string[], aliases: readonly string[]): number {
  const normed = header.map(norm);
  for (const alias of aliases) {
    const exact = normed.indexOf(alias);
    if (exact >= 0) return exact;
  }
  // Fall back to a contains-match for banks that prefix/suffix labels.
  for (const alias of aliases) {
    const idx = normed.findIndex((h) => h.includes(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseBankCsv(
  text: string,
  fallbackCurrency = "CZK",
): ParseResult {
  const errors: string[] = [];
  const issues: ParseResult["issues"] = [];
  const blank = { date: null, amount: null, currency: null, note: null, variableSymbol: null };
  if (text.length > MAX_CSV_BYTES || new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) return { rows: [], errors: ["The CSV exceeds the import bound."], issues: [{ code: "limit" }], columns: blank };
  const lines = records(text.replace(/^﻿/, "").replace(/\r\n?/g, "\n"));
  if (lines === null) return { rows: [], errors: ["A quoted field is not closed."], issues: [{ code: "format" }], columns: blank };
  if (lines.length < 2) return { rows: [], errors: ["The file has no data rows."], issues: [{ code: "empty" }], columns: blank };
  if (lines.length > MAX_CSV_ROWS + 1) return { rows: [], errors: ["The CSV exceeds the import bound."], issues: [{ code: "limit" }], columns: blank };

  const delim = sniffDelimiter(lines[0]);
  const header = splitLine(lines[0], delim);
  const iDate = findColumn(header, HEADERS.date);
  const iAmount = findColumn(header, HEADERS.amount);
  const iCurrency = findColumn(header, HEADERS.currency);
  const iNote = findColumn(header, HEADERS.note);
  const iVs = findColumn(header, HEADERS.variableSymbol);

  const columns = {
    date: iDate >= 0 ? header[iDate] : null,
    amount: iAmount >= 0 ? header[iAmount] : null,
    currency: iCurrency >= 0 ? header[iCurrency] : null,
    note: iNote >= 0 ? header[iNote] : null,
    variableSymbol: iVs >= 0 ? header[iVs] : null,
  };

  if (iDate < 0 || iAmount < 0) {
    errors.push(
      "Couldn't find a date and amount column. Expected headers like “Datum” and “Částka”.",
    );
    return { rows: [], errors, issues: [{ code: "headers" }], columns };
  }

  const rows: ParsedTxRow[] = [];
  const occurrences = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const dateRaw = cells[iDate] ?? "";
    const amountRaw = cells[iAmount] ?? "";
    const occurred_on = parseDate(dateRaw);
    const amount = parseAmount(amountRaw);
    if (!occurred_on || !Number.isFinite(amount)) {
      errors.push(`Row ${i + 1}: skipped (couldn't read date or amount).`);
      issues.push({ code: "row", row: i + 1 });
      continue;
    }
    const legacyCurrency = (iCurrency >= 0 ? cells[iCurrency] : "")?.trim() || fallbackCurrency;
    const currency = legacyCurrency.toUpperCase();
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
      errors.push(`Row ${i + 1}: unsupported currency.`); issues.push({ code: "currency", row: i + 1 }); continue;
    }
    const rawSymbol = iVs >= 0 ? (cells[iVs] ?? "").trim() : "";
    const variable_symbol = symbolDigits(rawSymbol);
    if (rawSymbol && !variable_symbol) { errors.push(`Row ${i + 1}: invalid payment reference.`); issues.push({ code: "symbol", row: i + 1 }); continue; }
    const note = iNote >= 0 ? (cells[iNote] ?? "").trim() || null : null;
    const base = `csv:${hash(`${occurred_on}|${amount.toFixed(2)}|${legacyCurrency}|${note ?? ""}`)}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1; occurrences.set(base, occurrence);
    const external_id = occurrence === 1 ? base : `${base}:${occurrence}`;
    rows.push({
      occurred_on,
      kind: amount < 0 ? "expense" : "income",
      amount: Math.abs(amount),
      currency,
      note: note ? note.slice(0, 500).replace(/[\uD800-\uDBFF]$/, "") : null,
      external_id,
      variable_symbol,
      source_row: i + 1,
      source_identity: JSON.stringify([occurred_on, amount.toFixed(2), currency, note ?? "", variable_symbol ?? ""]),
      legacy_comparable: (note?.length ?? 0) <= 500,
    });
  }

  return { rows, errors, issues, columns };
}

/** Strong identities for new imports; keep the old key only for verified legacy
 * deduplication. Occurrences preserve two identical purchases in one statement.
 * Without a bank-provided id, overlap between partial identical-row exports
 * remains ambiguous; never claim these fingerprints prove bank identity.
 */
export async function prepareBankCsv(text: string, fallbackCurrency = "CZK"): Promise<ParseResult> {
  const parsed = parseBankCsv(text, fallbackCurrency);
  const occurrences = new Map<string, number>();
  const identities = parsed.rows.map(row => {
    const n = (occurrences.get(row.source_identity) ?? 0) + 1;
    occurrences.set(row.source_identity, n);
    return JSON.stringify([row.source_identity, n]);
  });
  const rows: ParsedTxRow[] = [];
  for (let offset = 0; offset < parsed.rows.length; offset += 64) {
    rows.push(...await Promise.all(parsed.rows.slice(offset, offset + 64).map(async (row, index) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identities[offset + index]));
      const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      return { ...row, legacy_external_id: row.external_id, external_id: `csv:v2:${hex}` };
    })));
  }
  return { ...parsed, rows };
}

export class CsvLegacyConflict extends Error {
  constructor(readonly row: number) { super("csv-legacy-conflict"); this.name = "CsvLegacyConflict"; }
}

/** Existing v2 keys retain later owner edits. Legacy hashes are accepted only
 * when the retained payment fields still verify the source; otherwise require
 * review instead of silently skipping a conflicting financial record.
 */
export function csvRowsToImport(rows: ParseResult["rows"], existing: readonly {
  external_id: string | null; kind: string; amount: number; currency: string;
  occurred_on: string; note: string | null; variable_symbol?: string | null;
}[]): ParseResult["rows"] {
  const byId = new Map(existing.filter(row => row.external_id).map(row => [row.external_id!, row]));
  return rows.filter(row => {
    if (!/^csv:v2:[a-f0-9]{64}$/.test(row.external_id)) throw new Error("CSV identities not prepared");
    if (byId.has(row.external_id)) return false;
    const legacy = row.legacy_external_id ? byId.get(row.legacy_external_id) : undefined;
    if (!legacy) return true;
    if (!row.legacy_comparable || legacy.kind !== row.kind || Number(legacy.amount) !== row.amount
      || legacy.currency.toUpperCase() !== row.currency || legacy.occurred_on !== row.occurred_on
      || (legacy.note ?? "").trim() !== (row.note ?? "").trim()
      || (legacy.variable_symbol ?? null) !== row.variable_symbol) throw new CsvLegacyConflict(row.source_row);
    return false;
  });
}
