// Heuristic parser for Czech invoice PDFs. Takes the plain text extracted from
// a PDF (see src/lib/pdf-extract.ts) and best-effort pulls out the fields we
// can use to prefill a new invoice. Everything here is pure and unit-tested;
// the extraction (pdf.js) lives separately because it needs the browser.

export type ParsedParty = {
  name?: string;
  ico?: string;
  dic?: string;
};

export type ParsedInvoice = {
  number?: string;
  variableSymbol?: string;
  issueDate?: string; // yyyy-MM-dd
  dueDate?: string;
  taxableSupplyDate?: string;
  currency?: string;
  total?: number;
  vatBase?: number;
  vatTotal?: number;
  hasVat: boolean;
  buyer?: ParsedParty;
  iban?: string;
  bankAccount?: string;
};

// Non-newline whitespace pdf.js may emit between digits: regular space plus
// no-break (U+00A0), narrow no-break (U+202F) and thin (U+2009) spaces.
const WS = " \\u00a0\\u202f\\u2009";
const AMOUNT_THOUSANDS = new RegExp(`[${WS}]`, "g");
const AMOUNT_TOKEN = new RegExp(`-?\\d[\\d${WS}.,]*\\d|\\d`);

/** Parse a Czech-formatted amount ("65 962,00 Kč", "1.234,56") to a number. */
export function parseCzAmount(raw: string): number | undefined {
  const m = raw.match(AMOUNT_TOKEN);
  if (!m) return undefined;
  let s = m[0].replace(AMOUNT_THOUSANDS, "");
  if (s.includes(",") && s.includes(".")) {
    // "1.234,56" → dot = thousands, comma = decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  } else if (s.includes(".")) {
    const parts = s.split(".");
    // "65.962" or "1.234.567" → dots are thousands separators
    if (parts.length > 2 || parts[parts.length - 1].length === 3) {
      s = parts.join("");
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse a Czech date ("1. 6. 2026", "01.06.2026") or ISO date to yyyy-MM-dd. */
export function parseCzDate(raw: string): string | undefined {
  let m = raw.match(/(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return undefined;
}

const LINES = (text: string) => text.split(/\r?\n/);

/** Value following a label — on the same line, else the next non-empty line. */
function findLabeled(text: string, label: RegExp): string | undefined {
  const lines = LINES(text);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) continue;
    const after = lines[i]
      .slice((m.index ?? 0) + m[0].length)
      .replace(/^[:\-–\s]+/, "")
      .trim();
    if (after) return after;
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      if (lines[j].trim()) return lines[j].trim();
    }
  }
  return undefined;
}

function firstDigits(s: string | undefined, max = 10): string | undefined {
  const m = s?.match(/\d{1,12}/);
  return m ? m[0].slice(0, max) : undefined;
}

/** First token containing at least one digit (an invoice-number-ish token). */
function tokenWithDigit(s: string | undefined): string | undefined {
  return s?.match(/([A-Za-z0-9][\w./-]*\d[\w./-]*)/)?.[1];
}

/** Last amount on a line — e.g. "DPH 21 % 2 100,00" → 2100, not the rate 21. */
function lastCzAmount(raw: string): number | undefined {
  const re = new RegExp(AMOUNT_TOKEN.source, "g");
  let m: RegExpExecArray | null;
  let last: string | undefined;
  while ((m = re.exec(raw)) !== null) last = m[0];
  return last !== undefined ? parseCzAmount(last) : undefined;
}

function detectCurrency(text: string): string | undefined {
  if (/(€|\bEUR\b)/i.test(text)) return "EUR";
  if (/(£|\bGBP\b)/i.test(text)) return "GBP";
  if (/(\$|\bUSD\b)/i.test(text)) return "USD";
  if (/(kč|czk|korun)/i.test(text)) return "CZK";
  return undefined;
}

function extractParty(block: string): ParsedParty {
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let name: string | undefined;
  for (const line of lines) {
    const labelMatch = line.match(/^(odb[ěe]ratel|dodavatel)\s*:?\s*/i);
    if (labelMatch) {
      const rest = line.slice(labelMatch[0].length).trim();
      if (rest) {
        name = rest;
        break;
      }
      continue;
    }
    if (/(I[ČC]O|DI[ČC])/i.test(line)) continue;
    name = line;
    break;
  }
  const ico = block.match(/I[ČC]O?\s*:?\s*(\d{6,8})/i)?.[1];
  const dic = block.match(/DI[ČC]\s*:?\s*([A-Z]{2}\d{8,10})/i)?.[1];
  return { name, ico, dic };
}

function extractBuyer(text: string): ParsedParty | undefined {
  const idx = text.search(/odb[ěe]ratel/i);
  if (idx === -1) return undefined;
  // Take the block from "Odběratel" forward, stopping before a later
  // "Dodavatel" if the supplier happens to come second.
  let block = text.slice(idx, idx + 320);
  const dod = block.slice(12).search(/dodavatel/i);
  if (dod !== -1) block = block.slice(0, dod + 12);
  const party = extractParty(block);
  return party.name || party.ico || party.dic ? party : undefined;
}

export function parseInvoiceText(text: string): ParsedInvoice {
  // Prefer an explicit "Číslo faktury/dokladu" label; fall back to a
  // "Faktura <number>" title line. Only accept a token that has a digit, so
  // the document title ("Faktura — daňový doklad") never wins.
  let number = tokenWithDigit(
    findLabeled(
      text,
      /číslo\s+(?:faktury|dokladu)|da[ňn]ový doklad\s+č\.?|faktura\s+č\.?|invoice\s+(?:no\.?|number)/i,
    ),
  );
  if (!number) {
    number = text.match(
      /faktura\s*(?:č\.?|číslo)?\s*:?\s*([A-Za-z0-9][\w./-]*\d[\w./-]*)/i,
    )?.[1];
  }

  const variableSymbol =
    firstDigits(findLabeled(text, /variabiln[íi]\s*symbol/i)) ??
    text.match(/variabiln[íi]\s*symbol\D{0,6}(\d{1,10})/i)?.[1] ??
    text.match(/\bVS\s*[:.]?\s*(\d{4,10})/)?.[1];

  const issueDate = parseCzDate(
    findLabeled(text, /datum\s+(?:vystaven|vyhotoven)|vystaveno/i) ?? "",
  );
  const dueDate = parseCzDate(
    findLabeled(text, /datum\s+splatnosti|splatnost|splatno/i) ?? "",
  );
  const taxableSupplyDate = parseCzDate(
    findLabeled(
      text,
      /datum\s+(?:uskuteč|zdaniteln)|duzp|datum\s+plnění/i,
    ) ?? "",
  );

  const total =
    lastCzAmount(
      findLabeled(
        text,
        /celkem\s+k\s+úhrad|k\s+úhrad|total(?:\s+due)?/i,
      ) ?? "",
    ) ?? lastCzAmount(findLabeled(text, /celkem|úhrada/i) ?? "");
  const vatBase = lastCzAmount(
    findLabeled(text, /základ\s+daně|základ\b/i) ?? "",
  );
  const vatTotal = lastCzAmount(
    findLabeled(text, /daň\s+celkem|dph\s+celkem|^dph\b|výše\s+daně/i) ??
      "",
  );

  const ibanRaw = text.match(/\bCZ\d{2}[\dA-Z ]{16,30}\b/i)?.[0];
  const iban = ibanRaw ? ibanRaw.replace(/\s+/g, "").toUpperCase() : undefined;
  const bankAccount = text.match(/(?:\d{1,6}-)?\d{2,10}\/\d{4}\b/)?.[0];

  const hasVat = vatTotal !== undefined && vatTotal > 0;

  return {
    number,
    variableSymbol,
    issueDate,
    dueDate,
    taxableSupplyDate,
    currency: detectCurrency(text),
    total,
    vatBase,
    vatTotal,
    hasVat,
    buyer: extractBuyer(text),
    iban,
    bankAccount,
  };
}
