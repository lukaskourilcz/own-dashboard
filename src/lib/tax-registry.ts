/**
 * Czech and EU tax-registry helpers for organizations.
 *
 * Deliberately pure and network-free. The two API routes
 * (`src/app/api/registry/ares`, `src/app/api/registry/vies`) own the outbound
 * fetch and the browser mutation owns the Supabase write, so own-only RLS is
 * untouched and no service-role client is involved. This module is imported by
 * both the routes and client components, so it must never import
 * `server-only`.
 *
 * Both registries are credential-free public services: no account, no API key
 * and no environment variable.
 */

/** Cached verdict of the last VIES check stored on `public.organizations`. */
export type VatVerificationStatus = "unchecked" | "valid" | "invalid" | "unavailable";

/** ARES economic-subject lookup by IČO. */
export const ARES_SUBJECT_ENDPOINT =
  "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty";

/** VIES REST check for EU VAT numbers. */
export const VIES_CHECK_ENDPOINT =
  "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

/** How long a recorded VIES verdict is reused before the UI offers a re-check. */
export const VAT_CHECK_FRESH_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * EU VAT country codes VIES answers for. Greece files under `EL`, not `GR`;
 * Northern Ireland keeps `XI` after Brexit; `GB` is deliberately absent because
 * VIES no longer covers it.
 */
export const EU_VAT_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR",
  "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI",
  "SK", "XI",
]);

/* -- shared defensive readers ---------------------------------------------- */

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

/** Registry payloads mix strings and numbers (`psc`, `cisloDomovni`). */
function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/* -- IČO ------------------------------------------------------------------- */

/** Digits only, left-padded to the canonical eight characters. */
export function normalizeIco(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length < 8 ? digits.padStart(8, "0") : digits;
}

/** Eight digits plus the standard mod-11 weighted checksum. */
export function isValidIco(raw: string | null | undefined): boolean {
  const ico = normalizeIco(raw);
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let index = 0; index < 7; index += 1) {
    sum += (ico.charCodeAt(index) - 48) * (8 - index);
  }
  const remainder = sum % 11;
  const check = remainder === 0 ? 1 : remainder === 1 ? 0 : 11 - remainder;
  return check === ico.charCodeAt(7) - 48;
}

/* -- VAT id ---------------------------------------------------------------- */

export type ParsedVatId = { countryCode: string; number: string };

/** `CZ 270-743 58` → `{ countryCode: "CZ", number: "27074358" }`. */
export function parseVatId(raw: string | null | undefined): ParsedVatId | null {
  const value = (raw ?? "").replace(/[^0-9a-z]/gi, "").toUpperCase();
  const match = /^([A-Z]{2})([0-9A-Z]{2,12})$/.exec(value);
  if (!match) return null;
  const [, countryCode = "", number = ""] = match;
  if (!countryCode || !number) return null;
  return { countryCode, number };
}

/** Canonical `CC123456789` form, or `""` when the input is not a VAT id. */
export function normalizeVatId(raw: string | null | undefined): string {
  const parsed = parseVatId(raw);
  return parsed ? `${parsed.countryCode}${parsed.number}` : "";
}

/** True when VIES can be asked about this number at all. */
export function isEuVatId(raw: string | null | undefined): boolean {
  const parsed = parseVatId(raw);
  return parsed !== null && EU_VAT_COUNTRIES.has(parsed.countryCode);
}

/* -- ARES ------------------------------------------------------------------ */

export type AresSubject = {
  ico: string;
  name: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  vatId: string;
};

function czechZip(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 5 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : raw.trim();
}

/** `Budějovická 778/3a` from the structured seat, or the first textual line. */
function aresStreet(seat: UnknownRecord): string {
  const street = asText(seat.nazevUlice) || asText(seat.nazevCastiObce);
  const house = asText(seat.cisloDomovni);
  const orientation = `${asText(seat.cisloOrientacni)}${asText(seat.cisloOrientacniPismeno)}`;
  const numbers = [house, orientation].filter(Boolean).join("/");
  const composed = [street, numbers].filter(Boolean).join(" ").trim();
  if (composed) return composed;
  return asText(seat.textovaAdresa).split(",")[0]?.trim() ?? "";
}

/**
 * Map one ARES economic subject onto the organization fields the dashboard
 * stores. Every field is optional upstream, so this never throws and returns
 * null only when the payload identifies no subject at all.
 */
export function mapAresSubject(raw: unknown): AresSubject | null {
  const subject = asRecord(raw);
  if (!subject) return null;
  const name = asText(subject.obchodniJmeno);
  const ico = normalizeIco(asText(subject.ico));
  if (!name && !ico) return null;
  const seat = asRecord(subject.sidlo) ?? {};
  return {
    ico,
    name,
    address: aresStreet(seat),
    city: asText(seat.nazevObce),
    zip: czechZip(asText(seat.psc)),
    country: asText(seat.nazevStatu),
    vatId: normalizeVatId(asText(subject.dic)),
  };
}

/** The organization fields an ARES fill can write. */
export type OrganizationRegistryFields = {
  name: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  vatId: string;
};

/**
 * Merge an ARES subject into a part-typed form. Empty fields are filled; typed
 * ones are kept. The legal name is the exception and is refreshed from the
 * register, because matching the registered name is the point of the lookup.
 */
export function applyAresSubject(
  current: OrganizationRegistryFields,
  subject: AresSubject,
): OrganizationRegistryFields {
  return {
    name: subject.name || current.name,
    address: current.address.trim() || subject.address,
    city: current.city.trim() || subject.city,
    zip: current.zip.trim() || subject.zip,
    country: current.country.trim() || subject.country,
    vatId: current.vatId.trim() || subject.vatId,
  };
}

/* -- VIES ------------------------------------------------------------------ */

export type ViesResult = {
  status: Exclude<VatVerificationStatus, "unchecked">;
  name: string;
  address: string;
};

const VIES_UNAVAILABLE: ViesResult = { status: "unavailable", name: "", address: "" };

/** VIES fills unknown fields with three dashes rather than omitting them. */
function viesField(value: unknown): string {
  const text = asText(value);
  if (!text || text === "---") return "";
  return text.replace(/\s*\n\s*/g, ", ").trim();
}

/**
 * Read one VIES answer. A member-state outage (`MS_UNAVAILABLE`, `TIMEOUT`,
 * `SERVICE_UNAVAILABLE`, …) is an unavailable check, not an invalid VAT id —
 * conflating the two would accuse a real customer of a bad number.
 */
export function mapViesResult(raw: unknown): ViesResult {
  const result = asRecord(raw);
  if (!result) return VIES_UNAVAILABLE;
  const userError = asText(result.userError).toUpperCase();
  if (userError && userError !== "VALID" && userError !== "INVALID") return VIES_UNAVAILABLE;
  if (typeof result.valid !== "boolean") return VIES_UNAVAILABLE;
  return {
    status: result.valid ? "valid" : "invalid",
    name: viesField(result.name),
    address: viesField(result.address),
  };
}

/* -- stored verdict -------------------------------------------------------- */

/** The organization columns the VIES cache lives in. */
export type VatVerificationRecord = {
  vat_id: string | null;
  vat_verification_status: VatVerificationStatus;
  vat_verified_at: string | null;
  vat_verified_id: string | null;
};

type PartialVerification = Partial<VatVerificationRecord> | null | undefined;

/**
 * The stored status, narrowed. Rows read before the migration is applied carry
 * no column at all, so anything unrecognized reads as never checked.
 */
export function vatStatusOf(organization: PartialVerification): VatVerificationStatus {
  const value = organization?.vat_verification_status;
  return value === "valid" || value === "invalid" || value === "unavailable" ? value : "unchecked";
}

/**
 * True when a recorded verdict still stands: it is a real answer, it belongs to
 * the VAT id the organization carries now, and it is inside the window. Editing
 * the VAT id therefore invalidates the cache without any extra bookkeeping.
 */
export function vatCheckIsFresh(
  organization: PartialVerification,
  now: Date,
  days: number = VAT_CHECK_FRESH_DAYS,
): boolean {
  const status = vatStatusOf(organization);
  if (status !== "valid" && status !== "invalid") return false;
  const current = normalizeVatId(organization?.vat_id);
  if (!current || current !== normalizeVatId(organization?.vat_verified_id)) return false;
  const checkedAt = Date.parse(organization?.vat_verified_at ?? "");
  if (Number.isNaN(checkedAt)) return false;
  return now.getTime() - checkedAt <= days * DAY_MS;
}

export type VatVerificationPatch = {
  vat_verification_status: VatVerificationStatus;
  vat_verified_at: string;
  vat_verified_id: string;
  vat_verified_name: string | null;
  vat_verified_address: string | null;
};

/**
 * What to store after a VIES answer, or null when nothing should be written.
 *
 * An outage is reported to the reader but never erases an existing verdict for
 * the same VAT id: losing a recorded "valid" because Brussels timed out would
 * make the invoice block less trustworthy, not more. With no verdict to keep,
 * the outage itself is recorded so the state is visible rather than silent.
 */
export function vatVerificationPatch(
  organization: PartialVerification,
  result: ViesResult,
  checkedAt: string,
): VatVerificationPatch | null {
  const vatId = normalizeVatId(organization?.vat_id);
  if (!vatId) return null;
  if (result.status === "unavailable") {
    const recorded = vatStatusOf(organization);
    const sameId = normalizeVatId(organization?.vat_verified_id) === vatId;
    if (sameId && (recorded === "valid" || recorded === "invalid")) return null;
  }
  return {
    vat_verification_status: result.status,
    vat_verified_at: checkedAt,
    vat_verified_id: vatId,
    vat_verified_name: result.name || null,
    vat_verified_address: result.address || null,
  };
}

/**
 * True when VIES returned a name that is not the one on the record. Compared
 * case- and whitespace-insensitively so ordinary formatting is not a mismatch.
 */
export function vatNameMismatch(
  recordedName: string | null | undefined,
  storedName: string | null | undefined,
): boolean {
  const left = (recordedName ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const right = (storedName ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  if (!left || !right) return false;
  return left !== right;
}
