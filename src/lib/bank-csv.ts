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

export type ParsedTxRow = {
  occurred_on: string; // yyyy-MM-dd
  kind: "income" | "expense";
  amount: number; // absolute value, always >= 0
  currency: string;
  note: string | null;
  external_id: string; // "csv:<hash>" — deterministic, for dedupe
};

export type ParseResult = {
  rows: ParsedTxRow[];
  errors: string[];
  /** Which header cells were matched, for a friendlier "we read X as date" UI. */
  columns: { date: string | null; amount: string | null; currency: string | null; note: string | null };
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
    n: headerLine.split(d).length,
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
  return Number(s);
}

/** Normalise a date cell to yyyy-MM-dd. Accepts ISO, dd.mm.yyyy, dd/mm/yyyy. */
function parseDate(raw: string): string | null {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/.exec(s);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${m}-${d}`;
  }
  return null;
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
  // Tolerate BOM + CRLF; drop blank lines.
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return {
      rows: [],
      errors: ["The file has no data rows."],
      columns: { date: null, amount: null, currency: null, note: null },
    };
  }

  const delim = sniffDelimiter(lines[0]);
  const header = splitLine(lines[0], delim);
  const iDate = findColumn(header, HEADERS.date);
  const iAmount = findColumn(header, HEADERS.amount);
  const iCurrency = findColumn(header, HEADERS.currency);
  const iNote = findColumn(header, HEADERS.note);

  const columns = {
    date: iDate >= 0 ? header[iDate] : null,
    amount: iAmount >= 0 ? header[iAmount] : null,
    currency: iCurrency >= 0 ? header[iCurrency] : null,
    note: iNote >= 0 ? header[iNote] : null,
  };

  if (iDate < 0 || iAmount < 0) {
    errors.push(
      "Couldn't find a date and amount column. Expected headers like “Datum” and “Částka”.",
    );
    return { rows: [], errors, columns };
  }

  const rows: ParsedTxRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const dateRaw = cells[iDate] ?? "";
    const amountRaw = cells[iAmount] ?? "";
    const occurred_on = parseDate(dateRaw);
    const amount = parseAmount(amountRaw);
    if (!occurred_on || !Number.isFinite(amount)) {
      errors.push(`Row ${i + 1}: skipped (couldn't read date or amount).`);
      continue;
    }
    const currency = (iCurrency >= 0 ? cells[iCurrency] : "")?.trim() || fallbackCurrency;
    const note = iNote >= 0 ? (cells[iNote] ?? "").trim() || null : null;
    const external_id = `csv:${hash(
      `${occurred_on}|${amount.toFixed(2)}|${currency}|${note ?? ""}`,
    )}`;
    rows.push({
      occurred_on,
      kind: amount < 0 ? "expense" : "income",
      amount: Math.abs(amount),
      currency: currency.toUpperCase().slice(0, 3),
      note: note ? note.slice(0, 500) : null,
      external_id,
    });
  }

  return { rows, errors, columns };
}
